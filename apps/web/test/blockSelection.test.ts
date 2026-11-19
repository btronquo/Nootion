import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import type { Node } from "@tiptap/pm/model";
import { EditorState, NodeSelection } from "@tiptap/pm/state";
import {
  BlockRangeSelection,
  blockRange,
  blocksIn,
  deleteRange,
  dropGroup,
  duplicateRange,
  extendTo,
  moveRange,
  selectBlocks,
} from "../src/editor/blockSelection";

const schema = getSchema([StarterKit, TaskList, TaskItem]);
const p = (text: string) => schema.node("paragraph", null, text ? [schema.text(text)] : []);
const hr = () => schema.node("horizontalRule");
const li = (text: string) => schema.node("listItem", null, [p(text)]);
const ul = (...items: string[]) => schema.node("bulletList", null, items.map(li));
const doc = (...blocks: Node[]) => schema.node("doc", null, blocks);

/** Where the index-th block of the page starts. */
const at = (d: Node, index: number) => {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += d.child(i).nodeSize;
  return pos;
};
/** The text of each block of the page, "—" for a divider. */
const texts = (d: Node) => {
  const out: string[] = [];
  d.forEach((n) => out.push(n.type.name === "horizontalRule" ? "—" : n.type.name === "bulletList" ? `[${n.textContent}]` : n.textContent));
  return out;
};
const stateOf = (d: Node, from: number, to: number) => {
  const state = EditorState.create({ doc: d, schema });
  return state.apply(selectBlocks(state.tr, from, to));
};

describe("block selection", () => {
  it("takes exactly the blocks between its ends, not a divider beside them", () => {
    const d = doc(hr(), p("a"), p("b"), hr());
    const sel = BlockRangeSelection.create(d, at(d, 1), at(d, 3), 0);
    expect(sel.ranges.map((r) => d.nodeAt(r.$from.pos)?.textContent)).toEqual(["a", "b"]);
    expect(sel.content().content.childCount).toBe(2);
  });

  it("keeps its blocks when the page changes elsewhere", () => {
    const d = doc(p("a"), hr(), p("b"), p("c"), hr());
    const state = stateOf(d, at(d, 2), at(d, 4));
    const next = state.apply(state.tr.insert(0, p("new")));
    const r = blockRange(next.selection)!;
    expect(blocksIn(next.doc, r).map((b) => b.node.textContent)).toEqual(["b", "c"]);
  });

  it("moves the blocks up and down together", () => {
    const d = doc(p("a"), p("b"), p("c"), p("d"));
    const state = stateOf(d, at(d, 1), at(d, 3));
    const up = state.apply(moveRange(state, blockRange(state.selection)!, -1)!);
    expect(texts(up.doc)).toEqual(["b", "c", "a", "d"]);
    expect(blocksIn(up.doc, blockRange(up.selection)!).map((b) => b.node.textContent)).toEqual(["b", "c"]);
    const down = state.apply(moveRange(state, blockRange(state.selection)!, 1)!);
    expect(texts(down.doc)).toEqual(["a", "d", "b", "c"]);
    expect(moveRange(up, blockRange(up.selection)!, -1)).toBeNull();
  });

  it("duplicates the blocks below them and selects the copy", () => {
    const d = doc(p("a"), p("b"), p("c"));
    const state = stateOf(d, at(d, 0), at(d, 2));
    const next = state.apply(duplicateRange(state, blockRange(state.selection)!));
    expect(texts(next.doc)).toEqual(["a", "b", "a", "b", "c"]);
    expect(blockRange(next.selection)).toMatchObject({ from: at(next.doc, 2), to: at(next.doc, 4) });
  });

  it("deletes the blocks, and a list whose items are all selected", () => {
    const d = doc(p("a"), ul("x", "y"), p("b"));
    const listStart = at(d, 1);
    const list = d.child(1);
    const state = stateOf(d, listStart + 1, listStart + list.nodeSize - 1);
    const next = state.apply(deleteRange(state, blockRange(state.selection)!));
    expect(texts(next.doc)).toEqual(["a", "b"]);

    const all = stateOf(d, 0, d.content.size);
    expect(all.apply(deleteRange(all, blockRange(all.selection)!)).doc.childCount).toBe(1);
  });

  it("reaches the clicked block with Shift+click, out of a list too", () => {
    const d = doc(p("a"), ul("x", "y", "z"), p("b"));
    const listStart = at(d, 1);
    const firstItem = listStart + 1;
    const state = stateOf(d, firstItem, firstItem + d.child(1).child(0).nodeSize);
    // An item further down the same list: items of that list.
    const third = firstItem + d.child(1).child(0).nodeSize + d.child(1).child(1).nodeSize;
    const inList = extendTo(state.doc, state.selection, third + 2)!;
    expect(inList.$from.depth).toBe(1);
    expect(inList.ranges.length).toBe(3);
    // The paragraph after the list: blocks of the page.
    const out = extendTo(state.doc, state.selection, at(d, 2) + 1)!;
    expect(out.$from.depth).toBe(0);
    expect(out.ranges.map((r) => d.nodeAt(r.$from.pos)?.type.name)).toEqual(["bulletList", "paragraph"]);
    // From a block picked by its handle.
    const node = EditorState.create({ doc: d, schema, selection: NodeSelection.create(d, at(d, 2)) });
    expect(extendTo(d, node.selection, 1)!.ranges.length).toBe(3);
  });

  it("drops the dragged blocks elsewhere and keeps them selected", () => {
    const d = doc(p("a"), p("b"), p("c"), p("d"));
    const state = stateOf(d, at(d, 0), at(d, 2));
    const r = blockRange(state.selection)!;
    const tr = dropGroup(state.tr, r, at(d, 4));
    const next = state.apply(tr);
    expect(texts(next.doc)).toEqual(["c", "d", "a", "b"]);
    expect(blocksIn(next.doc, blockRange(next.selection)!).map((b) => b.node.textContent)).toEqual(["a", "b"]);
  });

  it("drops list items into another list, or as a list of their own between blocks", () => {
    const d = doc(ul("x", "y", "z"), p("a"), ul("m"));
    const items = 1;
    const two = items + d.child(0).child(0).nodeSize + d.child(0).child(1).nodeSize;
    const state = stateOf(d, items, two);
    const r = blockRange(state.selection)!;
    // Into the other list, before its item.
    const into = state.apply(dropGroup(state.tr, r, at(d, 2) + 1));
    expect(texts(into.doc)).toEqual(["[z]", "a", "[xym]"]);
    expect(blocksIn(into.doc, blockRange(into.selection)!).map((b) => b.node.textContent)).toEqual(["x", "y"]);
    // Between the paragraph and the list: a list of their own.
    const between = state.apply(dropGroup(state.tr, r, at(d, 2)));
    expect(texts(between.doc)).toEqual(["[z]", "a", "[xy]", "[m]"]);
    expect(blocksIn(between.doc, blockRange(between.selection)!).map((b) => b.node.textContent)).toEqual(["x", "y"]);
  });
});
