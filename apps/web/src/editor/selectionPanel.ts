import { Extension, type Editor, type JSONContent } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * A panel shown in the page, right under a passage that was selected (a suggestion of a plugin, to accept or discard).
 * The passage stays highlighted while the panel is open, and both follow the edits other people make meanwhile.
 */

/** What a panel's content may put in the page: plain text (paragraphs split by blank lines) or editor blocks. */
export type PanelContent = string | JSONContent[];

export interface SelectionPanel {
  /** Replaces the passage. Closes the panel. */
  replace: (content: PanelContent) => void;
  /** Adds after the passage, on its line when it is a single paragraph. Closes the panel. */
  insertAfter: (content: PanelContent) => void;
  /** Adds below the block that ends the passage. Closes the panel. */
  insertBelow: (content: PanelContent) => void;
  /** Removes the panel (the page is left as it was). */
  close: () => void;
  /** False once closed (by the plugin, Escape, another panel, or leaving the page). */
  readonly open: boolean;
}

interface PanelState {
  id: number;
  from: number;
  to: number;
  host: HTMLElement;
}

const key = new PluginKey<PanelState | null>("selectionPanel");
type Meta = { open: PanelState } | { close: number };

/** Position right after the top-level block holding `pos`. */
function blockEnd(doc: PMNode, pos: number): number {
  const $pos = doc.resolve(Math.min(pos, doc.content.size));
  return $pos.depth >= 1 ? $pos.after(1) : $pos.pos;
}

export const SelectionPanels = Extension.create({
  name: "selectionPanels",
  addProseMirrorPlugins() {
    return [
      new Plugin<PanelState | null>({
        key,
        state: {
          init: () => null,
          apply(tr, value) {
            const meta = tr.getMeta(key) as Meta | undefined;
            if (meta && "open" in meta) return meta.open;
            if (meta && "close" in meta) return value?.id === meta.close ? null : value;
            if (!value || !tr.docChanged) return value;
            const from = tr.mapping.map(value.from, 1);
            const to = Math.max(from, tr.mapping.map(value.to, -1));
            return { ...value, from, to };
          },
        },
        props: {
          decorations(state: EditorState) {
            const panel = key.getState(state);
            if (!panel) return null;
            const decos: Decoration[] = [];
            if (panel.to > panel.from) decos.push(Decoration.inline(panel.from, panel.to, { class: "selection-panel-source" }));
            decos.push(
              Decoration.widget(blockEnd(state.doc, panel.to), () => panel.host, {
                key: `selection-panel-${panel.id}`,
                side: 1,
                ignoreSelection: true,
                // Typing and clicking in the panel is the panel's business, not the editor's.
                stopEvent: () => true,
              }),
            );
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
  onDestroy() {
    current?.close();
  },
});

let nextId = 1;
let current: SelectionPanel | null = null;

/** Blocks from plain text: a paragraph per block of lines, a line break inside. */
function textBlocks(text: string): JSONContent[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({
      type: "paragraph",
      content: p.split("\n").flatMap((line, i) => [...(i ? [{ type: "hardBreak" }] : []), ...(line ? [{ type: "text", text: line }] : [])]),
    }));
}

const blocksOf = (content: PanelContent) => (typeof content === "string" ? textBlocks(content) : content);
/** A single paragraph goes in as its text, so that it can sit inside a line; anything else as blocks. */
const inlineIfOne = (blocks: JSONContent[]) => (blocks.length === 1 && blocks[0]!.type === "paragraph" ? (blocks[0]!.content ?? []) : blocks);

/**
 * Opens a panel under the current selection (closing any other), and draws `render`'s result in it. The selection is
 * then collapsed to its end, so that the selection menu goes away while the passage stays highlighted.
 */
export function openSelectionPanel(editor: Editor, render: (panel: SelectionPanel) => ReactNode, opts: { label?: string } = {}): SelectionPanel {
  current?.close();
  const { from, to } = editor.state.selection;
  const id = nextId++;
  const host = document.createElement("div");
  host.className = "selection-panel";
  host.contentEditable = "false";
  host.setAttribute("role", "region");
  if (opts.label) host.setAttribute("aria-label", opts.label);
  let root: Root | null = createRoot(host);

  const range = () => {
    const s = key.getState(editor.state);
    return s?.id === id ? { from: s.from, to: s.to } : null;
  };
  const put = (at: number | { from: number; to: number }, content: JSONContent[] | JSONContent["content"]) => {
    if (!content?.length && typeof at === "number") return;
    editor
      .chain()
      .focus()
      .insertContentAt(at, content ?? [])
      .run();
  };
  const panel: SelectionPanel = {
    get open() {
      return root !== null;
    },
    close: () => {
      if (!root) return;
      const r = root;
      root = null;
      if (current === panel) current = null;
      host.removeEventListener("keydown", onKey);
      // Focus was in the panel (a button of it): it goes back to the page, where it was before.
      const hadFocus = host.contains(document.activeElement);
      // Unmounting while React renders (a click handler of the panel) is refused: wait for the next turn.
      queueMicrotask(() => r.unmount());
      if (editor.isDestroyed) return;
      editor.view.dispatch(editor.state.tr.setMeta(key, { close: id } satisfies Meta).setMeta("addToHistory", false));
      if (hadFocus) editor.commands.focus();
    },
    replace: (content) => {
      const r = range();
      panel.close();
      if (r) put(r, inlineIfOne(blocksOf(content)));
    },
    insertAfter: (content) => {
      const r = range();
      panel.close();
      if (!r) return;
      const blocks = blocksOf(content);
      const $to = editor.state.doc.resolve(r.to);
      // On the passage's line when it is one paragraph ending there; below it otherwise.
      if (blocks.length === 1 && blocks[0]!.type === "paragraph" && $to.parent.isTextblock) {
        const before = $to.parent.textBetween(Math.max(0, $to.parentOffset - 1), $to.parentOffset);
        const inline = blocks[0]!.content ?? [];
        put(r.to, before && !/\s/.test(before) ? [{ type: "text", text: " " }, ...inline] : inline);
      } else put(blockEnd(editor.state.doc, r.to), blocks);
    },
    insertBelow: (content) => {
      const r = range();
      panel.close();
      if (r) put(blockEnd(editor.state.doc, r.to), blocksOf(content));
    },
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    panel.close();
  };
  host.addEventListener("keydown", onKey);
  current = panel;

  const tr = editor.state.tr.setMeta(key, { open: { id, from, to, host } } satisfies Meta).setMeta("addToHistory", false);
  tr.setSelection(TextSelection.create(tr.doc, to));
  editor.view.dispatch(tr);
  root.render(render(panel));
  return panel;
}

/** The selected passage as plain text, blocks separated by a blank line. */
export function selectedText(editor: Editor): string {
  const { from, to } = editor.state.selection;
  return editor.state.doc.textBetween(from, to, "\n\n", " ").trim();
}

/**
 * Puts content in the page below the block holding the cursor (at the end of the page when the cursor was never put
 * in it), and shows it.
 */
export function insertIntoPage(editor: Editor, content: PanelContent) {
  const blocks = blocksOf(content);
  if (!blocks.length || editor.isDestroyed) return;
  const { to } = editor.state.selection;
  const at = to <= 1 ? editor.state.doc.content.size : blockEnd(editor.state.doc, to);
  editor.chain().focus().insertContentAt(at, blocks).scrollIntoView().run();
}
