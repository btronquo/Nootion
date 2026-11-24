import { Extension } from "@tiptap/core";
import { NodeRangeSelection } from "@tiptap/extension-node-range";
import { Fragment, type Node, type ResolvedPos } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, SelectionRange, TextSelection, type EditorState, type Selection, type Transaction } from "@tiptap/pm/state";
import type { Mappable, Mapping } from "@tiptap/pm/transform";
import { dropPoint, insertPoint } from "@tiptap/pm/transform";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

/**
 * Several blocks selected at once, as in Notion: a rectangle drawn from the margin, Shift+click, Escape, Shift+↑/↓
 * or Ctrl+A twice. They are copied, cut, pasted over, deleted, duplicated and moved (Ctrl+Shift+↑/↓, or dragged by the
 * handle of any of them) together.
 *
 * The selection is a NodeRangeSelection (tiptap): whole blocks side by side in the same parent (blocks of the page,
 * or items of one list). ProseMirror copies, cuts and deletes it as it does any selection; this extension draws it,
 * makes it, and moves it.
 */

/**
 * tiptap's NodeRangeSelection, but exactly the blocks between its ends: tiptap's also takes an image, a divider or any
 * block without text that touches either end. Collaboration and undo know it as a NodeRangeSelection.
 */
export class BlockRangeSelection extends NodeRangeSelection {
  constructor($anchor: ResolvedPos, $head: ResolvedPos, depth?: number, bias = 1) {
    super($anchor, $head, depth, bias);
    const $lo = $anchor.min($head);
    const $hi = $anchor.max($head);
    if ($lo.pos === $hi.pos || !$lo.sameParent($hi) || (depth !== undefined && $lo.depth !== depth)) return;
    const doc = $lo.doc;
    const ranges: SelectionRange[] = [];
    $lo.parent.forEach((node, offset) => {
      const from = $lo.start() + offset;
      if (from >= $lo.pos && from + node.nodeSize <= $hi.pos) ranges.push(new SelectionRange(doc.resolve(from), doc.resolve(from + node.nodeSize)));
    });
    if (!ranges.length) return;
    const self = this as unknown as { ranges: SelectionRange[]; $anchor: ResolvedPos; $head: ResolvedPos };
    self.ranges = ranges;
    const forwards = $head.pos >= $anchor.pos;
    self.$anchor = forwards ? ranges[0].$from : ranges[ranges.length - 1].$to;
    self.$head = forwards ? ranges[ranges.length - 1].$to : ranges[0].$from;
  }

  map(doc: Node, mapping: Mapping): BlockRangeSelection {
    return new BlockRangeSelection(doc.resolve(mapping.map(this.anchor)), doc.resolve(mapping.map(this.head)), this.depth);
  }

  getBookmark(): ReturnType<NodeRangeSelection["getBookmark"]> {
    return new BlockRangeBookmark(this.anchor, this.head, this.depth) as unknown as ReturnType<NodeRangeSelection["getBookmark"]>;
  }
}

class BlockRangeBookmark {
  constructor(
    readonly anchor: number,
    readonly head: number,
    readonly depth: number | undefined,
  ) {}
  map(mapping: Mappable): BlockRangeBookmark {
    return new BlockRangeBookmark(mapping.map(this.anchor), mapping.map(this.head), this.depth);
  }
  resolve(doc: Node): BlockRangeSelection {
    return new BlockRangeSelection(doc.resolve(this.anchor), doc.resolve(this.head), this.depth);
  }
}

/** Selected blocks: sibling nodes, from the start of the first to the end of the last. */
export interface BlockRange {
  from: number;
  to: number;
  /** Depth of their parent (0: blocks of the page). */
  depth: number;
}

/** The blocks of the selection, when it is a block selection (several blocks, or one picked by Escape). */
export function blockRange(sel: Selection): BlockRange | null {
  if (sel instanceof NodeRangeSelection) return { from: sel.from, to: sel.to, depth: sel.$from.depth };
  return null;
}

/** Selects the blocks from `from` to `to` (both at block boundaries in the same parent). */
export function selectBlocks(tr: Transaction, from: number, to: number): Transaction {
  const $from = tr.doc.resolve(from);
  return tr.setSelection(BlockRangeSelection.create(tr.doc, from, to, $from.depth));
}

/** The children of the range's parent it covers. */
function rangeIndexes(doc: Node, r: BlockRange): { $from: ResolvedPos; parent: Node; start: number; end: number } {
  const $from = doc.resolve(r.from);
  const parent = $from.parent;
  const start = $from.index();
  let end = start;
  for (let pos = r.from; end < parent.childCount && pos < r.to; end++) pos += parent.child(end).nodeSize;
  return { $from, parent, start, end };
}

/** The blocks of the range, where each starts. */
export function blocksIn(doc: Node, r: BlockRange): { node: Node; pos: number }[] {
  const out: { node: Node; pos: number }[] = [];
  doc.nodesBetween(r.from, r.to, (node, pos) => {
    if (pos >= r.from && pos + node.nodeSize <= r.to && doc.resolve(pos).depth === r.depth) out.push({ node, pos });
    return doc.resolve(pos).depth < r.depth;
  });
  return out;
}

/** Moves the blocks above the one before them (-1) or below the one after (1). Null when there is none. */
export function moveRange(state: EditorState, r: BlockRange, dir: -1 | 1): Transaction | null {
  const { parent, start, end } = rangeIndexes(state.doc, r);
  const other = dir === -1 ? (start > 0 ? parent.child(start - 1) : null) : end < parent.childCount ? parent.child(end) : null;
  if (!other) return null;
  const tr = state.tr;
  const slice = state.doc.slice(r.from, r.to);
  if (dir === -1) {
    const at = r.from - other.nodeSize;
    tr.delete(r.from, r.to).insert(at, slice.content);
    return selectBlocks(tr, at, at + (r.to - r.from));
  }
  tr.delete(r.to, r.to + other.nodeSize).insert(r.from, other);
  const at = r.from + other.nodeSize;
  return selectBlocks(tr, at, at + (r.to - r.from));
}

/** A copy of a block that links don't point at, and that nobody has edited yet. */
export function withoutIds(node: Node): Node {
  const attrs = { ...node.attrs };
  for (const k of ["blockId", "editedBy", "editedByName", "editedAt"]) if (k in attrs) attrs[k] = null;
  const content: Node[] = [];
  node.content.forEach((c) => content.push(c.isText ? c : withoutIds(c)));
  return node.type.create(attrs, content, node.marks);
}

/** Puts a copy of the blocks below them, and selects the copy. */
export function duplicateRange(state: EditorState, r: BlockRange): Transaction {
  const copies = blocksIn(state.doc, r).map((b) => withoutIds(b.node));
  const tr = state.tr.insert(r.to, copies);
  return selectBlocks(tr, r.to, r.to + (r.to - r.from));
}

/** Deletes the blocks, the caret where they were. */
export function deleteRange(state: EditorState, r: BlockRange): Transaction {
  // Every item of a list: the list goes too (an empty one can't stay).
  let { from, to } = r;
  for (let $from = state.doc.resolve(from); $from.depth > 0 && from === $from.start() && to === $from.end(); $from = state.doc.resolve(from)) {
    from = $from.before();
    to = $from.after();
  }
  const tr = state.tr.delete(from, to);
  const $at = tr.doc.resolve(Math.min(tr.mapping.map(from), tr.doc.content.size));
  return tr.setSelection(TextSelection.near($at, 1)).scrollIntoView();
}

/** The block (list item in a list) the caret or the selection's start is in. */
function blockAround($pos: ResolvedPos): { pos: number; node: Node } | null {
  for (let d = $pos.depth; d > 0; d--) {
    const n = $pos.node(d);
    if (n.type.name === "listItem" || n.type.name === "taskItem" || d === 1) return { pos: $pos.before(d), node: n };
  }
  return null;
}

/** The block selection reaching from the selected blocks to the block at `pos` (Shift+click). */
export function extendTo(doc: Node, sel: Selection, pos: number): BlockRangeSelection | null {
  const r = blockRange(sel) ?? (sel instanceof NodeSelection ? { from: sel.from, to: sel.to, depth: sel.$from.depth } : null);
  if (!r) return null;
  // The deepest parent both are in, no deeper than the selection's: blocks of the page, or items of the same list.
  const depth = Math.min(r.depth, doc.resolve(r.from).sharedDepth(pos));
  const $lo = doc.resolve(Math.min(r.from, pos));
  const $hi = doc.resolve(Math.max(r.to, pos));
  const from = depth < $lo.depth ? $lo.before(depth + 1) : $lo.pos;
  const to = depth < $hi.depth ? $hi.after(depth + 1) : $hi.pos;
  if (to <= from) return null;
  return BlockRangeSelection.create(doc, pos < r.from ? to : from, pos < r.from ? from : to, depth);
}

/**
 * The blocks a rectangle (in the window's coordinates) touches: those of the page, or the items of a list when it only
 * touches one list.
 */
export function blocksInRect(view: EditorView, rect: { left: number; top: number; right: number; bottom: number }): BlockRange | null {
  const touches = (pos: number) => {
    const dom = view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) return false;
    const r = dom.getBoundingClientRect();
    return r.bottom > rect.top && r.top < rect.bottom && r.right > rect.left && r.left < rect.right && r.height > 0;
  };
  let parent = view.state.doc;
  let base = 0;
  let depth = 0;
  for (;;) {
    const hits: { pos: number; node: Node }[] = [];
    parent.forEach((node, offset) => {
      const pos = base + offset;
      if (touches(pos)) hits.push({ pos, node });
    });
    if (!hits.length) return null;
    const one = hits.length === 1 ? hits[0] : null;
    // A single list touched: its items.
    if (one && ["bulletList", "orderedList", "taskList"].includes(one.node.type.name) && one.node.childCount > 1) {
      parent = one.node;
      base = one.pos + 1;
      depth++;
      continue;
    }
    const last = hits[hits.length - 1];
    return { from: hits[0].pos, to: last.pos + last.node.nodeSize, depth };
  }
}

interface DragGroup {
  from: number;
  to: number;
}

interface PluginState {
  /** The selected blocks being dragged by the handle of one of them. */
  drag: DragGroup | null;
}

export const blockSelectionKey = new PluginKey<PluginState>("blockSelection");

/** A key that types a character. */
const typesText = (e: KeyboardEvent) => e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;

export const BlockSelection = Extension.create({
  name: "blockSelection",
  // Before the editor's own keys (Backspace, Enter, the arrows…), which only act on selected blocks here.
  priority: 1000,

  addKeyboardShortcuts() {
    const ed = () => this.editor;
    const range = () => blockRange(ed().state.selection);
    const dispatch = (tr: Transaction | null) => {
      if (!tr) return true;
      ed().view.dispatch(tr.scrollIntoView());
      return true;
    };
    /** The block next to the range (-1: before, 1: after), selected alone; or the range grown or shrunk by one. */
    const step = (dir: -1 | 1, grow: boolean) => {
      const sel = ed().state.selection;
      const r = range();
      if (!r || !(sel instanceof NodeRangeSelection)) return false;
      const { doc } = ed().state;
      const { parent, start, end, $from } = rangeIndexes(doc, r);
      const posOf = (i: number) => $from.posAtIndex(i);
      if (!grow) {
        const i = dir === -1 ? start - 1 : end;
        if (i < 0 || i >= parent.childCount) return true;
        return dispatch(selectBlocks(ed().state.tr, posOf(i), posOf(i) + parent.child(i).nodeSize));
      }
      // Grows on the side of the head, or shrinks back towards the anchor.
      const forwards = sel.head >= sel.anchor;
      let a = start;
      let b = end;
      if (dir === 1) {
        if (!forwards && b - a > 1) a++;
        else if (b < parent.childCount) b++;
        else return true;
      } else {
        if (forwards && b - a > 1) b--;
        else if (a > 0) a--;
        else return true;
      }
      const from = posOf(a);
      const to = posOf(b);
      // The head stays on the side that moves.
      const shrinking = (dir === 1 && !forwards) || (dir === -1 && forwards);
      const headFirst = shrinking ? !forwards : dir === -1;
      return dispatch(ed().state.tr.setSelection(BlockRangeSelection.create(doc, headFirst ? to : from, headFirst ? from : to, $from.depth)));
    };

    return {
      // Back to typing, at the end of the last block.
      Enter: () => {
        const r = range();
        if (!r) return false;
        const { state } = ed();
        return dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(r.to), -1)));
      },
      ArrowUp: () => step(-1, false),
      ArrowDown: () => step(1, false),
      "Shift-ArrowUp": () => (range() ? step(-1, true) : false),
      "Shift-ArrowDown": () => (range() ? step(1, true) : false),
      // Moves or duplicates all the selected blocks (one block: BlockShortcuts).
      "Mod-Shift-ArrowUp": () => {
        const r = range();
        return r ? dispatch(moveRange(ed().state, r, -1)) : false;
      },
      "Mod-Shift-ArrowDown": () => {
        const r = range();
        return r ? dispatch(moveRange(ed().state, r, 1)) : false;
      },
      "Mod-d": () => {
        const r = range();
        return r ? dispatch(duplicateRange(ed().state, r)) : false;
      },
      // Once the text of a block is all selected (or it has none): every block of the page.
      "Mod-a": () => {
        const { state } = ed();
        const sel = state.selection;
        if (range() || sel instanceof NodeSelection) return dispatch(selectBlocks(state.tr, 0, state.doc.content.size));
        const { $from, $to } = sel;
        if (!$from.sameParent($to) || !$from.parent.isTextblock || $from.parent.type.spec.code) return false;
        const whole = $from.parentOffset === 0 && $to.parentOffset === $to.parent.content.size;
        if (!whole) {
          return dispatch(state.tr.setSelection(TextSelection.create(state.doc, $from.start(), $from.end())));
        }
        return dispatch(selectBlocks(state.tr, 0, state.doc.content.size));
      },
      Backspace: () => {
        const r = range();
        return r ? dispatch(deleteRange(ed().state, r)) : false;
      },
      Delete: () => {
        const r = range();
        return r ? dispatch(deleteRange(ed().state, r)) : false;
      },
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin<PluginState>({
        key: blockSelectionKey,
        state: {
          init: () => ({ drag: null }),
          apply(tr, value) {
            const meta = tr.getMeta(blockSelectionKey) as Partial<PluginState> | undefined;
            let drag = meta && "drag" in meta ? (meta.drag ?? null) : value.drag;
            if (drag && tr.docChanged) {
              const from = tr.mapping.mapResult(drag.from, 1);
              const to = tr.mapping.mapResult(drag.to, -1);
              drag = from.deleted || to.deleted || to.pos <= from.pos ? null : { from: from.pos, to: to.pos };
            }
            return drag === value.drag ? value : { drag };
          },
        },
        props: {
          decorations(state) {
            const r = blockRange(state.selection);
            if (!r) return null;
            const decos = blocksIn(state.doc, r).map((b) => Decoration.node(b.pos, b.pos + b.node.nodeSize, { class: "nt-block-selected" }));
            return DecorationSet.create(state.doc, decos);
          },
          attributes: (state): Record<string, string> => (blockRange(state.selection) ? { class: "nt-blocks-selected" } : {}),
          // Typing doesn't replace the selected blocks (as in Notion): only Delete, Backspace, cut or paste do.
          handleKeyDown(view, event) {
            return !!blockRange(view.state.selection) && typesText(event);
          },
          handleTextInput(view) {
            return !!blockRange(view.state.selection);
          },
          handleDOMEvents: {
            // Shift+click on a block, while blocks are selected: the selection reaches it.
            mousedown(view, event) {
              if (!event.shiftKey || event.button !== 0 || !view.editable) return false;
              const sel = view.state.selection;
              if (!blockRange(sel) && !(sel instanceof NodeSelection)) return false;
              const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
              if (!at) return false;
              const next = extendTo(view.state.doc, sel, at.inside >= 0 ? at.inside : at.pos);
              if (!next) return false;
              event.preventDefault();
              view.dispatch(view.state.tr.setSelection(next));
              view.focus();
              return true;
            },
          },
          // The group dropped somewhere else on the page: moved there, still selected.
          handleDrop(view, event, slice, moved) {
            const drag = blockSelectionKey.getState(view.state)?.drag;
            if (!drag || !moved) return false;
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
            const tr = view.state.tr.setMeta(blockSelectionKey, { drag: null });
            if (!at) return (view.dispatch(tr), true);
            const target = dropPoint(view.state.doc, at.pos, slice) ?? at.pos;
            // Onto itself: nothing moves.
            if (target >= drag.from && target <= drag.to) return (view.dispatch(tr), true);
            dropGroup(tr, drag, target);
            view.focus();
            view.dispatch(tr.setMeta("uiEvent", "drop"));
            return true;
          },
        },
        view(view) {
          /** The block selection when a drag started, before the handle's own code changes it. */
          let before: BlockRange | null = null;
          /** The block handle of this editor, when it is what is being dragged. */
          const ownHandle = (e: Event) => {
            const handle = (e.target as HTMLElement | null)?.closest?.(".drag-handle");
            return !!handle && !!view.dom.parentElement?.contains(handle);
          };
          const onDragStartCapture = (e: DragEvent) => {
            before = ownHandle(e) ? blockRange(view.state.selection) : null;
            // The handle's own code sees no selection, and drags only its block: the selected ones are taken below.
            // (Seeing them, it would also put its own selection back after the drop.)
            if (before) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(before.from))).setMeta("addToHistory", false));
          };
          // After the handle's own code (on its element): when the block it drags is one of the selected ones, all
          // of them go.
          const onDragStart = (e: DragEvent) => {
            const r = before;
            before = null;
            if (!r || !ownHandle(e) || !e.dataTransfer || !view.editable) return;
            const picked = view.state.selection;
            if (picked.from < r.from || picked.to > r.to) return;
            const { doc } = view.state;
            const tr = view.state.tr.setMeta(blockSelectionKey, { drag: { from: r.from, to: r.to } }).setMeta("addToHistory", false);
            selectBlocks(tr, r.from, r.to);
            view.dispatch(tr);
            view.dragging = { slice: doc.slice(r.from, r.to), move: true } as typeof view.dragging;
            setDragImage(view, e.dataTransfer, blocksIn(doc, r));
          };
          const onDragEnd = () => {
            if (blockSelectionKey.getState(view.state)?.drag)
              view.dispatch(view.state.tr.setMeta(blockSelectionKey, { drag: null }).setMeta("addToHistory", false));
          };
          const stopMarquee = startMarquee(view, () => editor.isEditable);
          document.addEventListener("dragstart", onDragStartCapture, true);
          window.addEventListener("dragstart", onDragStart);
          document.addEventListener("dragend", onDragEnd);
          return {
            destroy() {
              stopMarquee();
              document.removeEventListener("dragstart", onDragStartCapture, true);
              window.removeEventListener("dragstart", onDragStart);
              document.removeEventListener("dragend", onDragEnd);
            },
          };
        },
      }),
    ];
  },
});

/** Escape, after the menus ("/", "@") and the blocks that take it first. */
export const BlockSelectionKeys = Extension.create({
  name: "blockSelectionKeys",
  priority: 50,
  addKeyboardShortcuts() {
    const ed = () => this.editor;
    const dispatch = (tr: Transaction) => (ed().view.dispatch(tr.scrollIntoView()), true);
    return {
      // In text: the block around the caret. On selected blocks: nothing selected any more.
      Escape: () => {
        const { state, view } = ed();
        const sel = state.selection;
        if (blockRange(sel) || sel instanceof NodeSelection) {
          view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(sel.from))));
          (view.dom as HTMLElement).blur();
          return true;
        }
        const block = blockAround(sel.$from);
        if (!block) return false;
        return dispatch(selectBlocks(state.tr, block.pos, block.pos + block.node.nodeSize));
      },
    };
  },
});

/** Moves the dragged group to `target` (a position of the page before the move), and selects it there. */
export function dropGroup(tr: Transaction, drag: DragGroup, target: number): Transaction {
  const $start = tr.doc.resolve(drag.from);
  const blocks = blocksIn(tr.doc, { from: drag.from, to: drag.to, depth: $start.depth });
  if (!blocks.length) return tr;
  const nodes = Fragment.from(blocks.map((b) => b.node));
  // Items of a list dropped out of any list: in a list like theirs.
  const wrapped = $start.depth > 0 ? Fragment.from($start.parent.copy(nodes)) : null;
  tr.delete(drag.from, drag.to);
  const mapped = tr.mapping.map(target);
  const fits = (pos: number, content: Fragment) => {
    const $pos = tr.doc.resolve(pos);
    return $pos.parent.canReplace($pos.index(), $pos.index(), content);
  };
  let pos: number | null = null;
  let content = nodes;
  for (const candidate of wrapped ? [nodes, wrapped] : [nodes]) {
    const at = fits(mapped, candidate) ? mapped : insertPoint(tr.doc, mapped, candidate.firstChild!.type);
    if (at !== null && fits(at, candidate)) {
      pos = at;
      content = candidate;
      break;
    }
  }
  if (pos === null) {
    // Nowhere it fits near there: back where it was.
    tr.insert(tr.mapping.map(drag.from), nodes);
    return tr;
  }
  tr.insert(pos, content);
  const inner = content === wrapped ? 1 : 0;
  return selectBlocks(tr, pos + inner, pos + content.size - inner);
}

/** What follows the pointer while the selected blocks are dragged: all of them, faded. */
function setDragImage(view: EditorView, data: DataTransfer, blocks: { pos: number }[]) {
  const wrapper = document.createElement("div");
  wrapper.className = "nootion-content nt-drag-image";
  const first = view.nodeDOM(blocks[0]?.pos ?? 0);
  const width = first instanceof HTMLElement ? first.getBoundingClientRect().width : 600;
  wrapper.style.cssText = `position:absolute;top:-10000px;left:0;width:${width}px;pointer-events:none;`;
  for (const b of blocks) {
    const dom = view.nodeDOM(b.pos);
    if (!(dom instanceof HTMLElement)) continue;
    const copy = dom.cloneNode(true) as HTMLElement;
    copy.classList.remove("nt-block-selected");
    wrapper.append(copy);
  }
  document.body.append(wrapper);
  data.setDragImage(wrapper, 0, 0);
  const cleanup = () => {
    wrapper.remove();
    document.removeEventListener("dragend", cleanup);
    document.removeEventListener("drop", cleanup);
  };
  document.addEventListener("dragend", cleanup);
  document.addEventListener("drop", cleanup);
}

/** How far the pointer moves before a press in the margin becomes a rectangle. */
const MARQUEE_THRESHOLD = 4;
/** How close to the top or bottom of the page the pointer scrolls it while drawing. */
const SCROLL_EDGE = 48;

/** The element that scrolls the page. */
function scrollerOf(el: HTMLElement): HTMLElement {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if ((overflowY === "auto" || overflowY === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement as HTMLElement;
}

/** A press there may start a rectangle: the page around the text, not a block, a button, the title… */
function inMargin(view: EditorView, target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  // The editor's own element left of its text, and its parents up to the page: the margins.
  if (target === view.dom) return true;
  const scroller = scrollerOf(view.dom);
  return target.contains(view.dom) && (scroller === document.scrollingElement || scroller.contains(target));
}

/**
 * A rectangle drawn from the margin of the page selects the blocks it touches. Only when the pointer has moved a little:
 * a click in the margin stays a click.
 */
function startMarquee(view: EditorView, editable: () => boolean): () => void {
  let start: { x: number; y: number; scroll: number; scroller: HTMLElement } | null = null;
  let box: HTMLDivElement | null = null;
  let last = { x: 0, y: 0 };
  let frame = 0;

  const rectNow = () => {
    if (!start) return null;
    const dy = start.scroller.scrollTop - start.scroll;
    const top = Math.min(start.y - dy, last.y);
    const bottom = Math.max(start.y - dy, last.y);
    return { left: Math.min(start.x, last.x), right: Math.max(start.x, last.x), top, bottom };
  };

  const update = () => {
    const r = rectNow();
    if (!r || !box || !start) return;
    Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.right - r.left}px`, height: `${r.bottom - r.top}px` });
    const hit = blocksInRect(view, r);
    const { state } = view;
    let sel: Selection;
    if (hit) {
      try {
        sel = BlockRangeSelection.create(state.doc, hit.from, hit.to, hit.depth);
      } catch {
        return;
      }
    } else sel = TextSelection.near(state.doc.resolve(Math.min(state.selection.from, state.doc.content.size)));
    if (!sel.eq(state.selection)) view.dispatch(state.tr.setSelection(sel).setMeta("addToHistory", false).setMeta("hideDragHandle", true));
  };

  // Near the top or bottom of the window, the page scrolls, and the rectangle with it.
  const tick = () => {
    frame = 0;
    if (!start || !box) return;
    const { scroller } = start;
    const view_ = scroller === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect();
    const speed =
      last.y < view_.top + SCROLL_EDGE ? -(view_.top + SCROLL_EDGE - last.y) : last.y > view_.bottom - SCROLL_EDGE ? last.y - (view_.bottom - SCROLL_EDGE) : 0;
    if (speed) {
      scroller.scrollTop += Math.max(-24, Math.min(24, speed / 2));
      update();
      frame = requestAnimationFrame(tick);
    }
  };

  const onMove = (e: MouseEvent) => {
    if (!start) return;
    last = { x: e.clientX, y: e.clientY };
    if (!box) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < MARQUEE_THRESHOLD) return;
      box = document.createElement("div");
      box.className = "nt-marquee";
      box.setAttribute("aria-hidden", "true");
      document.body.append(box);
      document.body.classList.add("nt-marquee-active");
      if (!view.hasFocus()) view.focus();
    }
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    update();
    if (!frame) frame = requestAnimationFrame(tick);
  };

  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    cancelAnimationFrame(frame);
    frame = 0;
    // A click in the margin: nothing selected any more, the editor left (as before the rectangle existed).
    if (start && !box && view.hasFocus()) {
      if (blockRange(view.state.selection)) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(view.state.selection.from))));
      (view.dom as HTMLElement).blur();
    }
    if (box) {
      box.classList.add("nt-marquee-out");
      const old = box;
      window.setTimeout(() => old.remove(), 160);
      document.body.classList.remove("nt-marquee-active");
      if (blockRange(view.state.selection)) view.focus();
    }
    box = null;
    start = null;
  };

  const onDown = (e: MouseEvent) => {
    if (e.button !== 0 || !editable() || view.isDestroyed || !inMargin(view, e.target)) return;
    // Between two blocks, above the text: ProseMirror places the caret.
    if (e.target === view.dom) {
      const r = view.dom.getBoundingClientRect();
      const style = getComputedStyle(view.dom);
      if (e.clientX > r.left + parseFloat(style.paddingLeft) && e.clientX < r.right - parseFloat(style.paddingRight)) return;
    }
    const scroller = scrollerOf(view.dom);
    start = { x: e.clientX, y: e.clientY, scroll: scroller.scrollTop, scroller };
    last = { x: e.clientX, y: e.clientY };
    // No text selection from the margin.
    e.preventDefault();
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  document.addEventListener("mousedown", onDown);
  return () => {
    onUp();
    document.removeEventListener("mousedown", onDown);
  };
}
