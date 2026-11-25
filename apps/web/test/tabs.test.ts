import { describe, expect, it } from "vitest";
import { activate, close, EMPTY, follow, insertNear, move, open, othersOf, rightOf, togglePin, type TabsState } from "../src/lib/tabs";

const paths = (s: TabsState) => s.tabs.map((t) => `${t.pinned ? "📌" : ""}${t.path}`);
const activePath = (s: TabsState) => s.tabs.find((t) => t.id === s.active)?.path;
const idOf = (s: TabsState, path: string) => s.tabs.find((t) => t.path === path)!.id;

/** Three tabs a, b, c, with b shown. */
function three() {
  let s = follow({ ...EMPTY, enabled: true }, "/page/a");
  s = open(s, "/page/b");
  s = open(s, "/page/c");
  return activate(s, idOf(s, "/page/b"));
}

describe("tabs of open pages", () => {
  it("opens a first tab on the place shown, which then follows the links", () => {
    let s = follow(EMPTY, "/");
    expect(paths(s)).toEqual(["/"]);
    s = follow(s, "/page/a");
    expect(paths(s)).toEqual(["/page/a"]);
    expect(activePath(s)).toBe("/page/a");
  });

  it("opens new tabs after the current one, those opened in the background in order", () => {
    let s = three();
    s = open(s, "/page/x", { background: true });
    s = open(s, "/page/y", { background: true });
    expect(paths(s)).toEqual(["/page/a", "/page/b", "/page/x", "/page/y", "/page/c"]);
    expect(activePath(s)).toBe("/page/b");
    s = open(s, "/page/z");
    expect(activePath(s)).toBe("/page/z");
  });

  it("keeps the place on screen when the first tab is opened in the background", () => {
    const s = open(EMPTY, "/page/x", { background: true, current: "/page/a" });
    expect(paths(s)).toEqual(["/page/a", "/page/x"]);
    expect(activePath(s)).toBe("/page/a");
  });

  it("shows the next tab on the right when the current one closes, else the left one", () => {
    let s = three();
    s = close(s, [idOf(s, "/page/b")]);
    expect(activePath(s)).toBe("/page/c");
    s = close(s, [idOf(s, "/page/c")]);
    expect(activePath(s)).toBe("/page/a");
    s = close(s, [idOf(s, "/page/a")]);
    expect(s.tabs).toEqual([]);
    expect(s.active).toBeNull();
  });

  it("closes the others or those on the right, sparing pinned tabs", () => {
    let s = three();
    s = togglePin(s, idOf(s, "/page/c"));
    expect(paths(s)).toEqual(["📌/page/c", "/page/a", "/page/b"]);
    expect(othersOf(s, idOf(s, "/page/a"))).toEqual([idOf(s, "/page/b")]);
    expect(rightOf(s, idOf(s, "/page/c"))).toEqual([idOf(s, "/page/a"), idOf(s, "/page/b")]);
  });

  it("keeps a pinned tab on its page: links followed from it open in another tab", () => {
    let s = three();
    s = togglePin(s, idOf(s, "/page/b"));
    s = follow(s, "/page/d");
    expect(paths(s)).toEqual(["📌/page/b", "/page/d", "/page/a", "/page/c"]);
    expect(activePath(s)).toBe("/page/d");
    // Back to a place already open: its tab is shown.
    s = activate(s, idOf(s, "/page/b"));
    s = follow(s, "/page/c");
    expect(paths(s)).toHaveLength(4);
    expect(activePath(s)).toBe("/page/c");
  });

  it("unpins a tab to the start of the others", () => {
    let s = three();
    s = togglePin(s, idOf(s, "/page/b"));
    s = togglePin(s, idOf(s, "/page/c"));
    s = togglePin(s, idOf(s, "/page/b"));
    expect(paths(s)).toEqual(["📌/page/c", "/page/b", "/page/a"]);
  });

  it("moves a tab before or after another, pinning it among the pinned ones", () => {
    let s = three();
    s = move(s, idOf(s, "/page/a"), idOf(s, "/page/c"), true);
    expect(paths(s)).toEqual(["/page/b", "/page/c", "/page/a"]);
    s = move(s, idOf(s, "/page/a"), idOf(s, "/page/b"), false);
    expect(paths(s)).toEqual(["/page/a", "/page/b", "/page/c"]);
    s = togglePin(s, idOf(s, "/page/a"));
    s = move(s, idOf(s, "/page/c"), idOf(s, "/page/a"), true);
    expect(paths(s)).toEqual(["📌/page/a", "📌/page/c", "/page/b"]);
    // Dropped after the last tab: unpinned.
    s = move(s, idOf(s, "/page/a"), null, true);
    expect(paths(s)).toEqual(["📌/page/c", "/page/b", "/page/a"]);
  });

  it("opens a page dropped on the tabs where it lands", () => {
    let s = three();
    s = insertNear(s, "/page/x", idOf(s, "/page/a"), false);
    expect(paths(s)).toEqual(["/page/x", "/page/a", "/page/b", "/page/c"]);
    expect(activePath(s)).toBe("/page/x");
  });
});
