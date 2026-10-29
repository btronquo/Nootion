import type { CellValue, DatabaseProperty, DateValue, PropertyType, RollupValue } from "./databases.js";

/** Calculations shown under table columns and computed by rollups. */
export const CALC_FUNCTIONS = [
  "count_all",
  "count_values",
  "count_unique",
  "count_empty",
  "count_not_empty",
  "percent_empty",
  "percent_not_empty",
  "sum",
  "average",
  "median",
  "min",
  "max",
  "range",
  "earliest",
  "latest",
  "date_range",
  "checked",
  "unchecked",
  "percent_checked",
  "percent_unchecked",
] as const;
export type CalcFunction = (typeof CALC_FUNCTIONS)[number];

export const CALC_LABELS: Record<CalcFunction, string> = {
  count_all: "Tout compter",
  count_values: "Compter les valeurs",
  count_unique: "Compter les valeurs uniques",
  count_empty: "Compter les vides",
  count_not_empty: "Compter les non vides",
  percent_empty: "Pourcentage de vides",
  percent_not_empty: "Pourcentage de non vides",
  sum: "Somme",
  average: "Moyenne",
  median: "Médiane",
  min: "Minimum",
  max: "Maximum",
  range: "Écart (max − min)",
  earliest: "Date la plus ancienne",
  latest: "Date la plus récente",
  date_range: "Plage de dates (jours)",
  checked: "Cochées",
  unchecked: "Non cochées",
  percent_checked: "Pourcentage cochées",
  percent_unchecked: "Pourcentage non cochées",
};

/**
 * Result of a calculation. "number" values keep the unit of the column (currency…),
 * "count" and "days" are plain integers, "percent" goes from 0 to 100.
 */
export type CalcResult =
  | { kind: "number"; value: number }
  | { kind: "count"; value: number }
  | { kind: "percent"; value: number }
  | { kind: "days"; value: number }
  | { kind: "date"; value: string };

const NUMERIC: readonly PropertyType[] = ["number", "currency", "percent"];
const DATES: readonly PropertyType[] = ["date", "created_time", "last_edited_time"];
const GENERIC: CalcFunction[] = ["count_all", "count_values", "count_unique", "count_empty", "count_not_empty", "percent_empty", "percent_not_empty"];

/** Calculations that make sense for a column of the given type. */
export function calcFunctionsFor(type: PropertyType): CalcFunction[] {
  if (type === "checkbox") return ["count_all", "checked", "unchecked", "percent_checked", "percent_unchecked"];
  if (NUMERIC.includes(type)) return [...GENERIC, "sum", "average", "median", "min", "max", "range"];
  if (DATES.includes(type)) return [...GENERIC, "earliest", "latest", "date_range"];
  return GENERIC;
}

/**
 * Values of a rollup column turned into plain values: computed numbers stay numbers (typed as
 * "number"), lists of original values are flattened and keep the type of the property they come from.
 */
export function rollupCalcInput(values: CellValue[], target: DatabaseProperty | null): { values: CellValue[]; type: PropertyType } {
  const rollups = values as (RollupValue | null)[];
  if (rollups.some((v) => v && v.kind === "list")) {
    return { values: rollups.flatMap((v) => (v && v.kind === "list" ? v.values : [])), type: target?.type ?? "text" };
  }
  const first = rollups.find((v) => v);
  const type: PropertyType = first?.kind === "date" ? "date" : "number";
  return {
    values: rollups.map((v) => (!v || v.kind === "list" ? null : v.kind === "date" ? { start: v.value } : v.value)),
    type,
  };
}

const isEmpty = (v: CellValue) => v === null || v === undefined || v === "" || v === false || (Array.isArray(v) && v.length === 0);

function dateOf(v: CellValue): number | null {
  if (typeof v === "string") return Date.parse(v);
  if (v && typeof v === "object" && "start" in v) return Date.parse((v as DateValue).start);
  return null;
}

function numbers(values: CellValue[]) {
  return values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

/** Computes a calculation over the values of a column (or of related rows, for rollups). */
export function computeCalc(fn: CalcFunction, values: CellValue[], type: PropertyType): CalcResult | null {
  const total = values.length;
  const filled = values.filter((v) => !isEmpty(v));
  const pct = (n: number): CalcResult => ({ kind: "percent", value: total ? (n / total) * 100 : 0 });
  switch (fn) {
    case "count_all":
      return { kind: "count", value: total };
    case "count_values":
      return { kind: "count", value: filled.reduce<number>((n, v) => n + (Array.isArray(v) ? v.length : 1), 0) };
    case "count_unique": {
      const seen = new Set<string>();
      for (const v of filled) for (const item of Array.isArray(v) ? v : [v]) seen.add(JSON.stringify(item));
      return { kind: "count", value: seen.size };
    }
    case "count_empty":
      return { kind: "count", value: total - filled.length };
    case "count_not_empty":
      return { kind: "count", value: filled.length };
    case "percent_empty":
      return pct(total - filled.length);
    case "percent_not_empty":
      return pct(filled.length);
    case "checked":
      return { kind: "count", value: values.filter((v) => v === true).length };
    case "unchecked":
      return { kind: "count", value: values.filter((v) => v !== true).length };
    case "percent_checked":
      return pct(values.filter((v) => v === true).length);
    case "percent_unchecked":
      return pct(values.filter((v) => v !== true).length);
  }
  if (fn === "earliest" || fn === "latest" || fn === "date_range") {
    const times = values.map(dateOf).filter((t): t is number => t !== null && !Number.isNaN(t));
    if (!times.length) return null;
    const lo = Math.min(...times);
    const hi = Math.max(...times);
    if (fn === "date_range") return { kind: "days", value: Math.round((hi - lo) / 86_400_000) };
    // Return the original string so date-only values stay date-only.
    const pick = fn === "earliest" ? lo : hi;
    const original = values.find((v) => dateOf(v) === pick)!;
    return { kind: "date", value: typeof original === "string" ? original : (original as DateValue).start };
  }
  const nums = numbers(values);
  if (!nums.length) return fn === "sum" ? { kind: "number", value: 0 } : null;
  const sorted = [...nums].sort((a, b) => a - b);
  let value: number;
  switch (fn) {
    case "sum":
      value = nums.reduce((a, b) => a + b, 0);
      break;
    case "average":
      value = nums.reduce((a, b) => a + b, 0) / nums.length;
      break;
    case "median": {
      const mid = sorted.length >> 1;
      value = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
      break;
    }
    case "min":
      value = sorted[0]!;
      break;
    case "max":
      value = sorted[sorted.length - 1]!;
      break;
    case "range":
      value = sorted[sorted.length - 1]! - sorted[0]!;
      break;
    default:
      return null;
  }
  // Floating point noise from sums of amounts (0.1 + 0.2).
  return { kind: "number", value: Math.round(value * 1e9) / 1e9 };
}
