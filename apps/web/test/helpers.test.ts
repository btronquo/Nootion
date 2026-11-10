import { describe, expect, it } from "vitest";
import type { PageSummary } from "@nootion/shared";
import { parseNumberInput } from "../src/database/format";
import { buildTree, pageTitle } from "../src/lib/tree";

const page = (id: string, parentId: string | null, position: number) => ({ id, parentId, position, title: id }) as PageSummary;

describe("the page tree", () => {
  it("nests pages under their parent, in order", () => {
    const tree = buildTree([page("b", null, 2), page("a", null, 1), page("a2", "a", 2), page("a1", "a", 1), page("a1x", "a1", 1)]);
    expect(tree.map((n) => n.page.id)).toEqual(["a", "b"]);
    expect(tree[0]!.children.map((n) => n.page.id)).toEqual(["a1", "a2"]);
    expect(tree[0]!.children[0]!.children.map((n) => n.page.id)).toEqual(["a1x"]);
  });

  it("shows a page whose parent can't be seen at the top", () => {
    expect(buildTree([page("shared", "hidden", 1)]).map((n) => n.page.id)).toEqual(["shared"]);
  });

  it("names a page without a title", () => {
    expect(pageTitle("  Factures ")).toBe("Factures");
    expect(pageTitle("   ")).not.toBe("");
  });
});

describe("numbers typed in a cell", () => {
  it("are read with a comma or a point, spaces and units", () => {
    expect(parseNumberInput("1 234,5")).toBe(1234.5);
    expect(parseNumberInput("12.5 €")).toBe(12.5);
    expect(parseNumberInput("20 %")).toBe(20);
    expect(parseNumberInput("1 234")).toBe(1234);
  });

  it("are empty or refused otherwise", () => {
    expect(parseNumberInput("  ")).toBeNull();
    expect(parseNumberInput("douze")).toBeNaN();
  });
});
