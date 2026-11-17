import { mergeAttributes, Node, type Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import type { Node as PmNode } from "@tiptap/pm/model";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { t, type SyncedBlockInfo } from "@nootion/shared";
import { api } from "../lib/api";
import { SyncedBlockView } from "./SyncedBlockView";
import type { Block } from "./blockActions";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    syncedBlock: { insertSyncedBlock: (sourceId?: string | null) => ReturnType };
  }
}

export interface SyncedBlockOptions {
  /** The page being edited (where new synced blocks are made); null in read-only views. */
  pageId: string | null;
  /** Synced blocks this editor is inside of, outermost first: one of them can't be shown again inside. */
  ancestors: string[];
}

/**
 * A synced block: the same blocks shown in several pages. Its content lives in a hidden page of its own (`sourceId`),
 * edited in place by a small editor of its own (SyncedBlockView); every page showing it shows the same content.
 * Without a `sourceId` yet, the block offers to make a new one or to show an existing one.
 * Copied and pasted (the HTML keeps the id), it shows the same content in the other page.
 */
export const SyncedBlock = Node.create<SyncedBlockOptions>({
  name: "syncedBlock",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addOptions() {
    return { pageId: null, ancestors: [] };
  },
  addAttributes() {
    return { sourceId: { default: null, parseHTML: (el) => (el as HTMLElement).dataset.syncedBlock || null, renderHTML: () => ({}) } };
  },
  parseHTML() {
    return [{ tag: "div[data-synced-block]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-synced-block": node.attrs.sourceId ?? "" }), t("synced.name")];
  },
  addNodeView() {
    return ReactNodeViewRenderer(SyncedBlockView, {
      // Everything inside the block's own editor is its business; around it, the outer page selects and drags the block.
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest?.("[data-synced-inner]")) return true;
        return !(event.type.startsWith("drag") || event.type === "drop" || event.type === "mousedown");
      },
    });
  },
  addCommands() {
    return {
      insertSyncedBlock:
        (sourceId = null) =>
        ({ commands }) =>
          commands.insertContent([{ type: this.name, attrs: { sourceId } }, { type: "paragraph" }]),
    };
  },
});

/** The block "Turn into synced block" works on: a list item stands for its whole list. */
export function syncedTarget(editor: Editor, b: Block): Block {
  if (b.node.type.name !== "listItem" && b.node.type.name !== "taskItem") return b;
  const $pos = editor.state.doc.resolve(b.pos);
  return { node: $pos.parent, pos: $pos.before() };
}

/** Whether a block can become a synced block (not one already, and not in a table). */
export function canTurnIntoSynced(editor: Editor, b: Block): boolean {
  const target = syncedTarget(editor, b);
  if (target.node.type.name === "syncedBlock") return false;
  const $pos = editor.state.doc.resolve(target.pos);
  for (let d = $pos.depth; d > 0; d--) if (["table", "tableCell", "tableHeader", "detailsSummary"].includes($pos.node(d).type.name)) return false;
  return !!editor.schema.nodes.syncedBlock;
}

/** Moves the block's content into a new synced block, shown in its place. */
export async function turnIntoSynced(editor: Editor, pageId: string, b: Block): Promise<boolean> {
  const target = syncedTarget(editor, b);
  const content = [target.node.toJSON() as Record<string, unknown>];
  const { id } = await api<{ id: string }>(`/pages/${pageId}/synced-blocks`, { method: "POST", body: { content } });
  // The page may have changed while the block was made: it is found again.
  let at: number | null = null;
  editor.state.doc.descendants((n: PmNode, pos) => {
    if (at === null && n === target.node) at = pos;
    return at === null;
  });
  const pos = at ?? (editor.state.doc.nodeAt(target.pos) === target.node ? target.pos : null);
  if (pos === null) return false;
  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.replaceWith(pos, pos + target.node.nodeSize, editor.schema.nodes.syncedBlock!.create({ sourceId: id }));
      tr.setSelection(NodeSelection.create(tr.doc, pos));
      return true;
    })
    .run();
}

/** Copies the synced block, to paste in another page (where it shows the same content). */
export function copySyncedBlock(editor: Editor, pos: number): boolean {
  editor.chain().focus().setNodeSelection(pos).run();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  }
}

/** Replaces this copy of the synced block by its content, as ordinary blocks: the other copies stay synced. */
export async function unsyncBlock(editor: Editor, node: PmNode, getPos: () => number | undefined): Promise<boolean> {
  const id = node.attrs.sourceId as string | null;
  const content = id ? ((await api<{ block: SyncedBlockInfo }>(`/synced-blocks/${id}`)).block.content as { content?: unknown[] }).content : [];
  const pos = getPos();
  if (pos === undefined || editor.state.doc.nodeAt(pos) !== node) return false;
  const nodes = (content ?? []).flatMap((json) => {
    try {
      return [editor.schema.nodeFromJSON(json)];
    } catch {
      return [];
    }
  });
  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.replaceWith(pos, pos + node.nodeSize, nodes.length ? nodes : [editor.schema.nodes.paragraph!.create()]);
      return true;
    })
    .run();
}
