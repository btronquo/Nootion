import { Extension, type ChainedCommands, type Editor } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";

/** A block of the page, where it starts. */
export interface Block {
  node: Node;
  pos: number;
}

/** What a block can be turned into, from the menu of its handle. */
export const TURN_INTO = ["paragraph", "h1", "h2", "h3", "bulletList", "orderedList", "taskList", "blockquote", "callout", "codeBlock"] as const;
export type TurnInto = (typeof TURN_INTO)[number];

/** Still the same block at the same place (the page may have changed under an open menu)? */
export function stillThere(editor: Editor, b: Block): boolean {
  return editor.state.doc.nodeAt(b.pos) === b.node;
}

/** Blocks made of text (or of lists and quotes of text) can be turned into another kind. */
export function canTurnInto(b: Block): boolean {
  if (b.node.isTextblock) return true;
  if (["bulletList", "orderedList", "taskList", "listItem", "taskItem", "blockquote", "callout"].includes(b.node.type.name)) {
    let onlyText = true;
    b.node.descendants((n) => {
      if (n.isBlock && !n.isTextblock && !["bulletList", "orderedList", "taskList", "listItem", "taskItem", "blockquote", "callout"].includes(n.type.name))
        onlyText = false;
      return onlyText;
    });
    return onlyText;
  }
  return false;
}

/** What the block is now, to tick it in "Turn into". */
export function currentKind(b: Block): TurnInto | null {
  const n = b.node;
  if (n.type.name === "heading") return `h${n.attrs.level}` as TurnInto;
  if (n.type.name === "listItem" || n.type.name === "taskItem") return null;
  return (TURN_INTO as readonly string[]).includes(n.type.name) ? (n.type.name as TurnInto) : null;
}

const MAKE: Record<TurnInto, (c: ChainedCommands) => ChainedCommands> = {
  paragraph: (c) => c,
  h1: (c) => c.setHeading({ level: 1 }),
  h2: (c) => c.setHeading({ level: 2 }),
  h3: (c) => c.setHeading({ level: 3 }),
  bulletList: (c) => c.toggleBulletList(),
  orderedList: (c) => c.toggleOrderedList(),
  taskList: (c) => c.toggleTaskList(),
  blockquote: (c) => c.setBlockquote(),
  callout: (c) => c.setCallout(),
  codeBlock: (c) => c.setCodeBlock(),
};

export function turnInto(editor: Editor, b: Block, kind: TurnInto) {
  const { pos, node } = b;
  // The whole text of the block selected, out of its lists and quotes, then made into the new kind.
  const select = () =>
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.setSelection(TextSelection.between(tr.doc.resolve(pos + 1), tr.doc.resolve(pos + node.nodeSize - 1)));
        return true;
      });
  const plain = select().clearNodes();
  const made = MAKE[kind](plain);
  // The caret at the end of the text, not all of it selected: the formatting toolbar would show over it.
  return made
    .command(({ tr }) => {
      tr.setSelection(TextSelection.create(tr.doc, tr.selection.to));
      return true;
    })
    .run();
}

export function duplicateBlock(editor: Editor, b: Block) {
  const after = b.pos + b.node.nodeSize;
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.insert(after, b.node.copy(b.node.content));
      tr.setSelection(NodeSelection.create(tr.doc, after));
      return true;
    })
    .run();
}

export function deleteBlock(editor: Editor, b: Block) {
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.delete(b.pos, b.pos + b.node.nodeSize);
      return true;
    })
    .run();
}

/** Swaps the block with the one before (-1) or after (1) it, in the same parent. False when there is none. */
export function moveBlock(editor: Editor, b: Block, dir: -1 | 1): boolean {
  const $pos = editor.state.doc.resolve(b.pos);
  const index = $pos.index();
  const parent = $pos.parent;
  const other = dir === -1 ? (index > 0 ? parent.child(index - 1) : null) : index < parent.childCount - 1 ? parent.child(index + 1) : null;
  if (!other) return false;
  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      if (dir === -1) {
        const start = b.pos - other.nodeSize;
        tr.delete(b.pos, b.pos + b.node.nodeSize).insert(start, b.node);
        tr.setSelection(NodeSelection.create(tr.doc, start));
      } else {
        const end = b.pos + b.node.nodeSize;
        tr.delete(end, end + other.nodeSize).insert(b.pos, other);
        tr.setSelection(NodeSelection.create(tr.doc, b.pos + other.nodeSize));
      }
      return true;
    })
    .run();
}

/** The block the selection is in (or the selected block): the top-level one, or the list item in a list. */
export function blockAtSelection(editor: Editor): Block | null {
  const sel = editor.state.selection;
  if (sel instanceof NodeSelection) return { node: sel.node, pos: sel.from };
  const $from = sel.$from;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === "listItem" || n.type.name === "taskItem" || d === 1) return { node: n, pos: $from.before(d) };
  }
  return null;
}

/** Ctrl+D duplicates the block, Ctrl+Shift+↑/↓ moves it, as in Notion. */
export const BlockShortcuts = Extension.create({
  name: "blockShortcuts",
  addKeyboardShortcuts() {
    const run = (fn: (b: Block) => boolean | void) => () => {
      const b = blockAtSelection(this.editor);
      if (!b) return false;
      return fn(b) !== false;
    };
    return {
      "Mod-d": run((b) => duplicateBlock(this.editor, b)),
      "Mod-Shift-ArrowUp": run((b) => moveBlock(this.editor, b, -1)),
      "Mod-Shift-ArrowDown": run((b) => moveBlock(this.editor, b, 1)),
    };
  },
});
