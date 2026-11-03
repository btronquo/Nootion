import { Extension, getChangedRanges, getExtensionField, type NodeConfig, type Editor } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { OPTION_COLORS, type OptionColor } from "@nootion/shared";
import { randomId } from "../lib/browser";

/** A block's color, as in Notion: its text ("red") or its background ("red-bg"). */
export type BlockColor = OptionColor | `${OptionColor}-bg`;
export const BLOCK_COLORS: readonly BlockColor[] = [...OPTION_COLORS, ...OPTION_COLORS.map((c) => `${c}-bg` as const)];

/** Blocks that take a color. */
const COLORED = ["paragraph", "heading", "listItem", "taskItem", "blockquote", "callout", "details"];
/** Blocks of text, which remember who last changed them and when. */
const TRACKED = ["paragraph", "heading", "codeBlock"];

/** Transactions that change a block's attributes without being an edit of it (a link made to it). */
const NOT_AN_EDIT = "nootionNotAnEdit";

/**
 * Attributes kept on blocks: their color, the id a link to the block points at (made on demand, by "Copy link"), and
 * who last edited them. Only the color is in the HTML: copying a block somewhere else doesn't carry its id or author.
 */
export const BlockAttributes = Extension.create({
  name: "blockAttributes",
  addGlobalAttributes() {
    // Every block can be linked to, widgets and databases included.
    const blocks = this.extensions
      .filter(
        (e) =>
          e.type === "node" &&
          !["doc", "text"].includes(e.name) &&
          !getExtensionField<NodeConfig["inline"]>(e, "inline", { name: e.name, options: e.options, storage: e.storage }),
      )
      .map((e) => e.name);
    const hidden = { default: null, rendered: false, keepOnSplit: false, parseHTML: () => null };
    return [
      {
        types: COLORED,
        attributes: {
          color: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el) => {
              const c = el.getAttribute("data-color");
              return c && (BLOCK_COLORS as readonly string[]).includes(c) ? c : null;
            },
            renderHTML: (attrs) => (attrs.color ? { "data-color": attrs.color } : {}),
          },
        },
      },
      { types: blocks, attributes: { blockId: hidden } },
      { types: TRACKED, attributes: { editedBy: hidden, editedByName: hidden, editedAt: hidden } },
    ];
  },
});

/** Whether blocks of this kind have the attribute. */
export const hasAttr = (node: Node, name: string) => name in (node.type.spec.attrs ?? {});
export const canColor = (node: Node) => hasAttr(node, "color");

export function setBlockColor(editor: Editor, pos: number, color: BlockColor | null) {
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      const node = tr.doc.nodeAt(pos);
      if (!node || !canColor(node)) return false;
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, color });
      return true;
    })
    .run();
}

/** The block's id for links, made now if it has none. */
export function ensureBlockId(editor: Editor, pos: number): string | null {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || !hasAttr(node, "blockId")) return null;
  if (node.attrs.blockId) return node.attrs.blockId as string;
  const id = randomId();
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: id }).setMeta(NOT_AN_EDIT, true));
  return id;
}

export function findBlockById(doc: Node, id: string): number | null {
  let found: number | null = null;
  doc.descendants((n, pos) => {
    if (found !== null) return false;
    if (n.attrs.blockId === id) found = pos;
  });
  return found;
}

/** Who last edited the block (or the text inside it, for lists and callouts), and when. */
export function lastEdit(node: Node): { by: string | null; name: string; at: number } | null {
  let best: { by: string | null; name: string; at: number } | null = null;
  const look = (n: Node) => {
    const at = Number(n.attrs.editedAt) || 0;
    if (at && (!best || at > best.at)) best = { by: (n.attrs.editedBy as string) ?? null, name: String(n.attrs.editedByName ?? ""), at };
  };
  look(node);
  node.descendants((n) => {
    look(n);
  });
  return best;
}

/** Changes to a block by the same person within a minute aren't written again. */
const QUIET = 60_000;

const trackKey = new PluginKey<number[]>("editTracking");

/**
 * Notes, on the blocks of text a local change touches, who made it and when. Changes from others and the server have theirs.
 * Written by a transaction of its own once the change is in Yjs: appended to it, it can't be synced when the block was empty.
 */
export const EditTracking = Extension.create<{ user: { id: string; name: string } | null }>({
  name: "editTracking",
  addOptions() {
    return { user: null };
  },
  addProseMirrorPlugins() {
    const user = this.options.user;
    if (!user) return [];
    const local = (tr: Transaction) => tr.docChanged && !tr.getMeta(NOT_AN_EDIT) && !tr.getMeta(ySyncPluginKey)?.isChangeOrigin;
    return [
      new Plugin<number[]>({
        key: trackKey,
        state: {
          init: () => [],
          // Where the blocks changed since the last write are.
          apply: (tr, pending, _old, state) => {
            if (tr.getMeta(trackKey) === "written") return [];
            const next = new Set(tr.docChanged ? pending.map((pos) => tr.mapping.map(pos, -1)) : pending);
            if (local(tr)) {
              const size = state.doc.content.size;
              for (const { newRange } of getChangedRanges(tr)) {
                state.doc.nodesBetween(Math.max(0, Math.min(newRange.from, size)), Math.max(0, Math.min(newRange.to, size)), (n, pos) => {
                  if (TRACKED.includes(n.type.name)) next.add(pos);
                });
              }
            }
            return next.size === pending.length && pending.every((p) => next.has(p)) ? pending : [...next];
          },
        },
        view: (view) => {
          let timer = 0;
          const write = () => {
            timer = 0;
            if (view.isDestroyed) return;
            // Not while a word is being composed (accents, phone keyboards): it would be interrupted.
            if (view.composing) return void (timer = window.setTimeout(write, 300));
            const { state } = view;
            const now = Date.now();
            const tr = state.tr;
            for (const pos of trackKey.getState(state) ?? []) {
              const n = state.doc.nodeAt(pos);
              if (!n || !TRACKED.includes(n.type.name)) continue;
              if (n.attrs.editedBy === user.id && now - (Number(n.attrs.editedAt) || 0) < QUIET) continue;
              tr.setNodeMarkup(pos, undefined, { ...n.attrs, editedBy: user.id, editedByName: user.name, editedAt: now });
            }
            view.dispatch(tr.setMeta(trackKey, "written").setMeta(NOT_AN_EDIT, true).setMeta("addToHistory", false));
          };
          return {
            update: () => {
              if (!timer && trackKey.getState(view.state)?.length) timer = window.setTimeout(write, 0);
            },
            destroy: () => window.clearTimeout(timer),
          };
        },
      }),
    ];
  },
});

const flashKey = new PluginKey<DecorationSet>("blockFlash");

/** Shows a block for a moment (reached by a link to it). A decoration: the block's element may be drawn again meanwhile. */
export const BlockFlash = Extension.create({
  name: "blockFlash",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: flashKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, set) => {
            const flash = tr.getMeta(flashKey) as { pos: number } | "off" | undefined;
            if (flash === "off") return DecorationSet.empty;
            if (flash) {
              const node = tr.doc.nodeAt(flash.pos);
              return node ? DecorationSet.create(tr.doc, [Decoration.node(flash.pos, flash.pos + node.nodeSize, { class: "nt-block-flash" })]) : set;
            }
            return set.map(tr.mapping, tr.doc);
          },
        },
        props: { decorations: (state) => flashKey.getState(state) },
      }),
    ];
  },
});

/** Scrolls to the block and shows it for a moment. */
export function flashBlock(editor: Editor, pos: number): () => void {
  const el = editor.view.nodeDOM(pos);
  if (el instanceof HTMLElement) el.scrollIntoView({ block: "center", behavior: "smooth" });
  editor.view.dispatch(editor.state.tr.setMeta(flashKey, { pos }));
  const timer = window.setTimeout(() => !editor.isDestroyed && editor.view.dispatch(editor.state.tr.setMeta(flashKey, "off")), 2600);
  return () => window.clearTimeout(timer);
}
