import { describe, expect, it } from "vitest";
import { FormulaError, evaluateFormula, makeDate, parseFormula, renameFormulaReference, toFormulaResult, type FValue } from "@nootion/shared";

const run = (src: string, props: Record<string, FValue> = {}) =>
  toFormulaResult(
    evaluateFormula(parseFormula(src), (name) => {
      if (!(name in props)) throw new FormulaError(`Colonne inconnue « ${name} ».`);
      return props[name]!;
    }),
  );

describe("formules", () => {
  it("calcul et priorité des opérateurs", () => {
    expect(run('prop("HT") * 1.2', { HT: 100 })).toEqual({ kind: "number", value: 120 });
    expect(run("1 + 2 * 3 ^ 2")).toEqual({ kind: "number", value: 19 });
    expect(run("-2 ^ 2")).toEqual({ kind: "number", value: -4 });
    expect(run("(1 + 2) * 3 % 4")).toEqual({ kind: "number", value: 1 });
    expect(run("round(10 / 3, 2)")).toEqual({ kind: "number", value: 3.33 });
    expect(run("0.1 + 0.2")).toEqual({ kind: "number", value: 0.3 });
  });

  it("conditions et textes", () => {
    expect(run('if(prop("Payée"), "OK", "À payer")', { Payée: false })).toEqual({ kind: "text", value: "À payer" });
    expect(run('prop("Payée") ? "OK" : "non"', { Payée: true })).toEqual({ kind: "text", value: "OK" });
    expect(run('ifs(prop("n") > 10, "grand", prop("n") > 5, "moyen", "petit")', { n: 7 })).toEqual({ kind: "text", value: "moyen" });
    expect(run('"Facture " + prop("N") + " : " + 12.5', { N: "F-12" })).toEqual({ kind: "text", value: "Facture F-12 : 12,5" });
    expect(run('prop("a") > 1 and not empty(prop("b"))', { a: 2, b: "x" })).toEqual({ kind: "boolean", value: true });
    expect(run('contains(prop("Tags"), "urgent")', { Tags: ["urgent", "pro"] })).toEqual({ kind: "boolean", value: true });
    expect(run('upper(join(prop("Tags"), "/"))', { Tags: ["a", "b"] })).toEqual({ kind: "text", value: "A/B" });
    expect(run("length(\"héllo\") == 5")).toEqual({ kind: "boolean", value: true });
    expect(run('if(empty(prop("x")), "", "y")', { x: null })).toBeNull();
  });

  it("dates", () => {
    const d = makeDate("2026-01-31");
    expect(run('dateAdd(prop("D"), 1, "months")', { D: d })).toEqual({ kind: "date", value: "2026-02-28" });
    expect(run('dateBetween(prop("A"), prop("B"), "days")', { A: makeDate("2026-03-30"), B: makeDate("2026-03-01") })).toEqual({ kind: "number", value: 29 });
    expect(run('formatDate(prop("D"), "DD MMMM YYYY")', { D: d })).toEqual({ kind: "text", value: "31 janvier 2026" });
    expect(run('year(prop("D")) * 100 + month(prop("D"))', { D: d })).toEqual({ kind: "number", value: 202601 });
    expect(run('dateEnd(prop("D"))', { D: makeDate("2026-01-01", "2026-01-15") })).toEqual({ kind: "date", value: "2026-01-15" });
  });

  it("erreurs claires", () => {
    expect(() => parseFormula('prop("a" * 2')).toThrow(FormulaError);
    expect(() => parseFormula("Montant * 2")).toThrow(/prop\("Montant"\)/);
    expect(() => parseFormula("foo(1)")).toThrow(/Fonction inconnue/);
    expect(() => parseFormula("constructor(1)")).toThrow(/Fonction inconnue/);
    expect(() => parseFormula("round()")).toThrow(/argument/);
    expect(() => run("1 / 0")).toThrow(/Division par zéro/);
    expect(() => run('"a" * 2')).toThrow(/nombre/);
    expect(() => run('prop("Inconnue")')).toThrow(/Colonne inconnue/);
  });

  it("suit le renommage d'une colonne", () => {
    expect(renameFormulaReference('prop("HT") * prop( "HT" ) + prop("HTX")', "HT", "Montant HT")).toBe('prop("Montant HT") * prop("Montant HT") + prop("HTX")');
  });
});
