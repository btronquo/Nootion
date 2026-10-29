import { describe, expect, it } from "vitest";
import { calcFunctionsFor, computeCalc, rollupCalcInput } from "@nootion/shared";

describe("column calculations", () => {
  it("numbers", () => {
    const v = [10, null, 2.5, 7.5, 0.1, 0.2];
    expect(computeCalc("sum", v, "number")).toEqual({ kind: "number", value: 20.3 });
    expect(computeCalc("average", [1, 2, null], "number")).toEqual({ kind: "number", value: 1.5 });
    expect(computeCalc("median", [5, 1, 3, 100], "number")).toEqual({ kind: "number", value: 4 });
    expect(computeCalc("range", [5, -1], "number")).toEqual({ kind: "number", value: 6 });
    expect(computeCalc("min", [null], "number")).toBeNull();
    expect(computeCalc("sum", [], "number")).toEqual({ kind: "number", value: 0 });
  });

  it("counts and percentages", () => {
    const v = [["a", "b"], null, ["a"], []];
    expect(computeCalc("count_all", v, "multi_select")).toEqual({ kind: "count", value: 4 });
    expect(computeCalc("count_values", v, "multi_select")).toEqual({ kind: "count", value: 3 });
    expect(computeCalc("count_unique", v, "multi_select")).toEqual({ kind: "count", value: 2 });
    expect(computeCalc("percent_empty", v, "multi_select")).toEqual({ kind: "percent", value: 50 });
    expect(computeCalc("percent_checked", [true, false, null, true], "checkbox")).toEqual({ kind: "percent", value: 50 });
  });

  it("dates", () => {
    const v = [{ start: "2026-03-15" }, { start: "2026-01-01" }, null];
    expect(computeCalc("earliest", v, "date")).toEqual({ kind: "date", value: "2026-01-01" });
    expect(computeCalc("latest", v, "date")).toEqual({ kind: "date", value: "2026-03-15" });
    expect(computeCalc("date_range", v, "date")).toEqual({ kind: "days", value: 73 });
  });

  it("offered functions and rollup columns", () => {
    expect(calcFunctionsFor("checkbox")).toContain("percent_checked");
    expect(calcFunctionsFor("text")).not.toContain("sum");
    const input = rollupCalcInput([{ kind: "number", value: 60 }, null, { kind: "number", value: 84.5 }], null);
    expect(input.type).toBe("number");
    expect(computeCalc("sum", input.values, input.type)).toEqual({ kind: "number", value: 144.5 });
  });
});
