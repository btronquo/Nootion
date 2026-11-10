import { describe, expect, it } from "vitest";
import {
  FormulaError,
  evaluateFormula,
  parseFormula,
  renameFormulaReference,
  toFormulaResult,
  setLocaleResolver,
  type FPage,
  type FValue,
} from "@nootion/shared";
import { FormulaTranslationError, translateFormula } from "../src/notion/formula.js";

setLocaleResolver(() => "fr");

const page = (id: string, title: string, props: Record<string, FValue>): FPage => ({ page: id, title, prop: (name) => props[name] ?? null });
const invoices = [
  page("i1", "F-1", { Total: 100, Payée: true }),
  page("i2", "F-2", { Total: 250, Payée: false }),
  page("i3", "F-3", { Total: 50, Payée: false }),
];

const run = (src: string, props: Record<string, FValue> = {}) =>
  toFormulaResult(
    evaluateFormula(
      parseFormula(src),
      (name) => {
        if (!(name in props)) throw new FormulaError(`Colonne inconnue « ${name} ».`);
        return props[name]!;
      },
      { rowId: "row-1" },
    ),
  );

describe("Notion 2 formulas", () => {
  it("lists and list functions", () => {
    expect(run("[1, 2, 3]")).toEqual({ kind: "list", value: ["1", "2", "3"] });
    expect(run("sum([1, 2, 3])")).toEqual({ kind: "number", value: 6 });
    expect(run("at([1, 2, 3], -1)")).toEqual({ kind: "number", value: 3 });
    expect(run("first([4, 5]) + last([4, 5])")).toEqual({ kind: "number", value: 9 });
    expect(run('join(sort(["b", "c", "a"]), "")')).toEqual({ kind: "text", value: "abc" });
    expect(run("reverse(unique([1, 1, 2]))")).toEqual({ kind: "list", value: ["2", "1"] });
    expect(run("flat([[1, 2], [3]])")).toEqual({ kind: "list", value: ["1", "2", "3"] });
    expect(run('includes(prop("Tags"), "pro")', { Tags: ["urgent", "pro"] })).toEqual({ kind: "boolean", value: true });
    expect(run('split("a,b,c", ",")')).toEqual({ kind: "list", value: ["a", "b", "c"] });
    expect(run("median([3, 1, 4, 2])")).toEqual({ kind: "number", value: 2.5 });
    expect(run("[1, 2] == [1, 2]")).toEqual({ kind: "boolean", value: true });
  });

  it("map, filter, find… with current and index", () => {
    expect(run("map([1, 2, 3], current * 2)")).toEqual({ kind: "list", value: ["2", "4", "6"] });
    expect(run("map([10, 20], index)")).toEqual({ kind: "list", value: ["0", "1"] });
    expect(run("filter([1, 5, 10], current > 3)")).toEqual({ kind: "list", value: ["5", "10"] });
    expect(run("find([1, 5, 10], current > 3)")).toEqual({ kind: "number", value: 5 });
    expect(run("findIndex([1, 5, 10], current > 3)")).toEqual({ kind: "number", value: 1 });
    expect(run("some([1, 5], current > 3) and not every([1, 5], current > 3)")).toEqual({ kind: "boolean", value: true });
    // Nested: the inner current hides the outer one.
    expect(run("map([[1, 2], [3]], sum(map(current, current * 10)))")).toEqual({ kind: "list", value: ["30", "30"] });
  });

  it("method calls", () => {
    expect(run('prop("Nom").upper()', { Nom: "abc" })).toEqual({ kind: "text", value: "ABC" });
    expect(run('[3, 1, 2].sort().map(current * 2).join("-")')).toEqual({ kind: "text", value: "2-4-6" });
    expect(run('prop("Tags").filter(current != "x").length()', { Tags: ["x", "y", "z"] })).toEqual({ kind: "number", value: 2 });
    expect(run('"a".length')).toEqual({ kind: "number", value: 1 });
    expect(run("1.5 * 2")).toEqual({ kind: "number", value: 3 });
  });

  it("let and lets", () => {
    expect(run('let(x, prop("HT") * 2, x + 1)', { HT: 10 })).toEqual({ kind: "number", value: 21 });
    expect(run("lets(a, 2, b, a * 3, a + b)")).toEqual({ kind: "number", value: 8 });
    expect(run("let(total, 5, map([1, 2], current * total))")).toEqual({ kind: "list", value: ["5", "10"] });
    expect(() => parseFormula("let(x, 1)")).toThrow(FormulaError);
    expect(() => parseFormula("let(1, 2, 3)")).toThrow(FormulaError);
    expect(() => parseFormula("x + 1")).toThrow(/prop\("x"\)/);
    expect(() => parseFormula("current * 2")).toThrow(/map\(\)/);
    expect(() => parseFormula("let(x, 1, x) + x")).toThrow(FormulaError);
    expect(run("pi > 3 and e < 3")).toEqual({ kind: "boolean", value: true });
  });

  it("related pages: current.prop()", () => {
    expect(run('prop("Factures").map(current.prop("Total")).sum()', { Factures: invoices })).toEqual({ kind: "number", value: 400 });
    expect(run('sum(prop("Factures").filter(not current.prop("Payée")).map(current.prop("Total")))', { Factures: invoices })).toEqual({
      kind: "number",
      value: 300,
    });
    expect(run('prop("Factures").find(current.prop("Total") > 200)', { Factures: invoices })).toEqual({ kind: "text", value: "F-2" });
    expect(run('prop("Factures").sort(current.prop("Total")).first()', { Factures: invoices })).toEqual({ kind: "text", value: "F-3" });
    // A relation still reads as its titles.
    expect(run('join(prop("Factures"), " / ")', { Factures: invoices })).toEqual({ kind: "text", value: "F-1 / F-2 / F-3" });
    expect(run('contains(prop("Factures"), "F-2")', { Factures: invoices })).toEqual({ kind: "boolean", value: true });
    expect(run('prop("Factures").prop("Total")', { Factures: invoices })).toEqual({ kind: "list", value: ["100", "250", "50"] });
    expect(run('id(first(prop("Factures")))', { Factures: invoices })).toEqual({ kind: "text", value: "i1" });
    expect(run("id()")).toEqual({ kind: "text", value: "row-1" });
    expect(() => run('map([1], current.prop("Total"))')).toThrow(/page/);
  });

  it("texts, numbers and dates", () => {
    expect(run('test("F-123", "^F-\\\\d+$")')).toEqual({ kind: "boolean", value: true });
    expect(run('match("a1b22c333", "\\\\d+")')).toEqual({ kind: "list", value: ["1", "22", "333"] });
    expect(run('replaceAllRegex("a1b2", "\\\\d", "#")')).toEqual({ kind: "text", value: "a#b#" });
    expect(run('repeat("ab", 3)')).toEqual({ kind: "text", value: "ababab" });
    expect(run('padStart("7", 3, "0")')).toEqual({ kind: "text", value: "007" });
    expect(run("sign(-4) + cbrt(27) + log10(100) + log2(8)")).toEqual({ kind: "number", value: 7 });
    expect(run('week(parseDate("2026-01-01"))')).toEqual({ kind: "number", value: 1 });
    expect(run('week(parseDate("2026-12-31"))')).toEqual({ kind: "number", value: 53 });
    expect(run('dateEnd(dateRange(parseDate("2026-01-01"), parseDate("2026-01-15")))')).toEqual({ kind: "date", value: "2026-01-15" });
  });

  it("refuses what could hang the server", () => {
    expect(() => run('test("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!", "(a+)+$")')).toThrow(/trop complexe/);
    expect(() => run('test("x", "(a|aa)*b")')).toThrow(/trop complexe/);
    expect(() => run('test("x", "(")')).toThrow(/invalide/);
    expect(() => run('repeat("abc", 1000000)')).toThrow(/trop long/);
  });

  it("rename leaves related columns alone", () => {
    expect(renameFormulaReference('prop("Total") + prop("F").map(current.prop("Total")).sum()', "Total", "Montant")).toBe(
      'prop("Montant") + prop("F").map(current.prop("Total")).sum()',
    );
  });
});

describe("Notion formula translation", () => {
  const names: Record<string, string> = { pr: "Price", tk: "Tasks" };
  const related: Record<string, string> = { tt: "Total" };
  const tr = (src: string) => translateFormula(src, (id, rel) => (rel ? (related[id] ?? names[id]) : names[id]));

  it("keeps Notion 2's lists, variables and functions", () => {
    expect(tr('prop("Tasks").map(current.prop("Total")).sum()')).toBe('sum(map(prop("Tasks"), current.prop("Total")))');
    expect(tr('let(x, prop("Price") * 2, x + 1)')).toBe('let(x, prop("Price") * 2, x + 1)');
    expect(tr("[1, 2, 3].filter(current > 1)")).toBe("filter([1, 2, 3], current > 1)");
    expect(tr("{{notion:block_property:tk:x:y}}.map(current.{{notion:block_property:tt:x:y}})")).toBe('map(prop("Tasks"), current.prop("Total"))');
    expect(tr('replaceAll(prop("Price"), "\\\\d", "#")')).toBe('replaceAllRegex(prop("Price"), "\\\\d", "#")');
    expect(tr('replace(prop("Price"), "a", "b")')).toBe('replace(prop("Price"), "a", "b")');
    expect(tr("pi * 2")).toBe("pi * 2");
    expect(() => tr('link("x", "https://example.com")')).toThrow(FormulaTranslationError);
  });

  it("translated formulas parse and compute", () => {
    const src = tr('prop("Tasks").filter(current.prop("Total") > 60).map(current.prop("Total")).sum()');
    expect(toFormulaResult(evaluateFormula(parseFormula(src), () => invoices))).toEqual({ kind: "number", value: 350 });
  });
});
