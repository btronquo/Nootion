import { intlLocale, t, type MessageKey } from "./i18n/index.js";
/**
 * Formula language of database columns, close to Notion's:
 *   prop("Price") * 1.2
 *   if(prop("Paid"), "Paid", "To pay")
 *   dateBetween(now(), prop("Due"), "days")
 * Parsed and evaluated here so that the server (which computes values) and the editor
 * (which checks what is typed) share the same rules.
 */

export class FormulaError extends Error {
  constructor(
    message: string,
    /** Character offset in the expression, for syntax errors. */
    readonly position?: number,
  ) {
    super(message);
  }
}

// --- Syntax ---------------------------------------------------------------------------------

type Token =
  | { t: "num"; v: number; p: number }
  | { t: "str"; v: string; p: number }
  | { t: "id"; v: string; p: number }
  | { t: "op"; v: string; p: number }
  | { t: "end"; p: number };

const OPERATORS = ["==", "!=", ">=", "<=", "&&", "||", "+", "-", "*", "/", "%", "^", ">", "<", "!", "(", ")", ",", "?", ":", "="];

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i))!;
      out.push({ t: "num", v: Number(m[0]), p: i });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'" || c === "“" || c === "«") {
      const close = c === "“" ? "”" : c === "«" ? "»" : c;
      let j = i + 1;
      let v = "";
      while (j < src.length && src[j] !== close) {
        if (src[j] === "\\" && j + 1 < src.length) {
          const n = src[j + 1]!;
          v += n === "n" ? "\n" : n === "t" ? "\t" : n;
          j += 2;
        } else v += src[j++];
      }
      if (j >= src.length) throw new FormulaError(t("formula.error.unclosedText"), i);
      out.push({ t: "str", v: close === "»" ? v.trim() : v, p: i });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_À-ÿ]/.test(c)) {
      const m = /^[A-Za-z_À-ÿ][A-Za-z0-9_À-ÿ]*/.exec(src.slice(i))!;
      out.push({ t: "id", v: m[0], p: i });
      i += m[0].length;
      continue;
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (!op) throw new FormulaError(t("formula.error.unexpectedChar", { char: c }), i);
    out.push({ t: "op", v: op, p: i });
    i += op.length;
  }
  out.push({ t: "end", p: src.length });
  return out;
}

export type FormulaNode =
  | { type: "num"; value: number }
  | { type: "str"; value: string }
  | { type: "bool"; value: boolean }
  | { type: "prop"; name: string }
  | { type: "call"; name: string; args: FormulaNode[]; p: number }
  | { type: "unary"; op: string; arg: FormulaNode }
  | { type: "binary"; op: string; left: FormulaNode; right: FormulaNode; p: number }
  | { type: "cond"; test: FormulaNode; then: FormulaNode; else: FormulaNode };

/** Parses an expression; throws FormulaError with the position of the problem. */
export function parseFormula(src: string): FormulaNode {
  if (!src.trim()) throw new FormulaError(t("formula.error.empty"), 0);
  const tokens = tokenize(src);
  let pos = 0;
  const peek = () => tokens[pos]!;
  const isOp = (v: string) => peek().t === "op" && (peek() as { v: string }).v === v;
  const isWord = (v: string) => peek().t === "id" && (peek() as { v: string }).v.toLowerCase() === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new FormulaError(t("formula.error.expected", { token: v }), peek().p);
    pos++;
  };

  const ternary = (): FormulaNode => {
    const test = or();
    if (!isOp("?")) return test;
    pos++;
    const then = ternary();
    expect(":");
    return { type: "cond", test, then, else: ternary() };
  };
  const binaryLevel = (next: () => FormulaNode, ops: string[], words: Record<string, string> = {}) => (): FormulaNode => {
    let left = next();
    for (;;) {
      const tok = peek();
      let op: string | undefined;
      if (tok.t === "op" && ops.includes(tok.v)) op = tok.v;
      else if (tok.t === "id" && words[tok.v.toLowerCase()]) op = words[tok.v.toLowerCase()];
      if (!op) return left;
      pos++;
      left = { type: "binary", op: op === "=" ? "==" : op, left, right: next(), p: tok.p };
    }
  };
  const unary = (): FormulaNode => {
    if (isOp("-") || isOp("!") || isOp("+")) {
      const op = (tokens[pos++] as { v: string }).v;
      return op === "+" ? unary() : { type: "unary", op, arg: unary() };
    }
    if (isWord("not")) {
      pos++;
      return { type: "unary", op: "!", arg: unary() };
    }
    return power();
  };
  const power = (): FormulaNode => {
    const base = primary();
    if (!isOp("^")) return base;
    const p = peek().p;
    pos++;
    return { type: "binary", op: "^", left: base, right: unary(), p };
  };
  const multiplicative = binaryLevel(unary, ["*", "/", "%"]);
  const additive = binaryLevel(multiplicative, ["+", "-"]);
  const comparison = binaryLevel(additive, [">", "<", ">=", "<="]);
  const equality = binaryLevel(comparison, ["==", "!=", "="]);
  const and = binaryLevel(equality, ["&&"], { and: "&&" });
  const or = binaryLevel(and, ["||"], { or: "||" });

  function primary(): FormulaNode {
    const tok = peek();
    if (tok.t === "num") {
      pos++;
      return { type: "num", value: tok.v };
    }
    if (tok.t === "str") {
      pos++;
      return { type: "str", value: tok.v };
    }
    if (tok.t === "op" && tok.v === "(") {
      pos++;
      const e = ternary();
      expect(")");
      return e;
    }
    if (tok.t === "id") {
      pos++;
      const word = tok.v.toLowerCase();
      if (word === "true" || word === "vrai") return { type: "bool", value: true };
      if (word === "false" || word === "faux") return { type: "bool", value: false };
      if (!isOp("(")) throw new FormulaError(t("formula.error.unknownName", { name: tok.v }), tok.p);
      pos++;
      const args: FormulaNode[] = [];
      if (!isOp(")")) {
        args.push(ternary());
        while (isOp(",")) {
          pos++;
          args.push(ternary());
        }
      }
      expect(")");
      if (word === "prop") {
        if (args.length !== 1 || args[0]!.type !== "str") throw new FormulaError(t("formula.error.propArgument"), tok.p);
        return { type: "prop", name: (args[0] as { value: string }).value };
      }
      const fn = Object.hasOwn(FUNCTION_ALIASES, word) ? FUNCTION_ALIASES[word]! : word;
      const spec = Object.hasOwn(FUNCTIONS, fn) ? FUNCTIONS[fn] : undefined;
      if (!spec) throw new FormulaError(t("formula.error.unknownFunction", { name: tok.v }), tok.p);
      if (args.length < spec.min || args.length > spec.max) {
        throw new FormulaError(
          t("formula.error.argumentCount", { fn, count: spec.min === spec.max ? spec.min : t("formula.error.argumentRange", { min: spec.min, max: spec.max === Infinity ? "n" : spec.max }) }),
          tok.p,
        );
      }
      return { type: "call", name: fn, args, p: tok.p };
    }
    if (tok.t === "end") throw new FormulaError(t("formula.error.earlyEnd"), tok.p);
    throw new FormulaError(t("formula.error.unexpected", { token: tok.v }), tok.p);
  }

  const node = ternary();
  if (peek().t !== "end") throw new FormulaError(t("formula.error.unexpected", { token: (peek() as { v: string }).v }), peek().p);
  return node;
}

/** Names of the columns an expression reads. */
export function formulaReferences(node: FormulaNode): string[] {
  const out = new Set<string>();
  const walk = (n: FormulaNode) => {
    if (n.type === "prop") out.add(n.name);
    else if (n.type === "call") n.args.forEach(walk);
    else if (n.type === "unary") walk(n.arg);
    else if (n.type === "binary") {
      walk(n.left);
      walk(n.right);
    } else if (n.type === "cond") {
      walk(n.test);
      walk(n.then);
      walk(n.else);
    }
  };
  walk(node);
  return [...out];
}

/** Rewrites prop("old") into prop("new") after a column is renamed. */
export function renameFormulaReference(src: string, oldName: string, newName: string): string {
  const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return src.replace(new RegExp(`prop\\(\\s*(["'])${escaped}\\1\\s*\\)`, "g"), `prop("${newName.replace(/"/g, '\\"')}")`);
}

// --- Values ---------------------------------------------------------------------------------

/** A date, with the end of the range when the column has one. `time` is false for date-only values. */
export interface FDate {
  date: Date;
  end: Date | null;
  time: boolean;
}
export type FValue = number | string | boolean | FDate | FValue[] | null;

const isDate = (v: FValue): v is FDate => typeof v === "object" && v !== null && !Array.isArray(v) && "date" in v;

export function makeDate(iso: string, end?: string | null): FDate | null {
  const parse = (s: string) => (s.length <= 10 ? new Date(`${s}T00:00:00`) : new Date(s));
  const d = parse(iso);
  if (Number.isNaN(d.getTime())) return null;
  return { date: d, end: end ? parse(end) : null, time: iso.length > 10 };
}

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function toText(v: FValue): string {
  if (v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 10, useGrouping: false }).format(v);
  if (typeof v === "boolean") return v ? t("formula.true") : t("formula.false");
  if (Array.isArray(v)) return v.map(toText).join(", ");
  const d = v.date;
  return new Intl.DateTimeFormat(intlLocale(), { day: "2-digit", month: "2-digit", year: "numeric", ...(v.time ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}) })
    .format(d)
    .replace(",", "");
}

const typeName = (v: FValue) =>
  t(v === null ? "formula.type.empty" : Array.isArray(v) ? "formula.type.list" : isDate(v) ? "formula.type.date" : typeof v === "number" ? "formula.type.number" : typeof v === "string" ? "formula.type.text" : "formula.type.boolean");

function num(v: FValue, fn: string): number {
  if (v === null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  throw new FormulaError(t("formula.error.expectsNumber", { fn, type: typeName(v) }));
}
function date(v: FValue, fn: string): FDate {
  if (isDate(v)) return v;
  throw new FormulaError(v === null ? t("formula.error.expectsDateEmpty", { fn }) : t("formula.error.expectsDate", { fn, type: typeName(v) }));
}
function list(v: FValue): FValue[] {
  return Array.isArray(v) ? v : v === null ? [] : [v];
}
const truthy = (v: FValue): boolean => (Array.isArray(v) ? v.length > 0 : v !== null && v !== false && v !== 0 && v !== "");
const empty = (v: FValue) => v === null || v === "" || (Array.isArray(v) && v.length === 0);

function equals(a: FValue, b: FValue): boolean {
  if (isDate(a) && isDate(b)) return a.date.getTime() === b.date.getTime();
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
  if (empty(a) && empty(b)) return true;
  return a === b;
}

function compare(a: FValue, b: FValue, op: string): boolean {
  let x: number | string;
  let y: number | string;
  if (isDate(a) && isDate(b)) [x, y] = [a.date.getTime(), b.date.getTime()];
  else if (typeof a === "string" && typeof b === "string") [x, y] = [a.localeCompare(b, intlLocale()), 0];
  else [x, y] = [num(a, op), num(b, op)];
  return op === ">" ? x > y : op === "<" ? x < y : op === ">=" ? x >= y : x <= y;
}

const UNITS: Record<string, string> = {
  year: "years", years: "years", an: "years", ans: "years", année: "years", années: "years",
  quarter: "quarters", quarters: "quarters", trimestre: "quarters", trimestres: "quarters",
  month: "months", months: "months", mois: "months",
  week: "weeks", weeks: "weeks", semaine: "weeks", semaines: "weeks",
  day: "days", days: "days", jour: "days", jours: "days",
  hour: "hours", hours: "hours", heure: "hours", heures: "hours",
  minute: "minutes", minutes: "minutes",
};
function unit(v: FValue, fn: string): string {
  const u = UNITS[String(v).toLowerCase()];
  if (!u) throw new FormulaError(t("formula.error.unknownUnit", { fn, unit: toText(v) }));
  return u;
}
function addTo(d: FDate, n: number, u: string): FDate {
  const r = new Date(d.date);
  const months = u === "years" ? 12 * n : u === "quarters" ? 3 * n : u === "months" ? n : 0;
  if (months) {
    // 31 January + 1 month = 28 (or 29) February, not 3 March.
    const day = r.getDate();
    r.setDate(1);
    r.setMonth(r.getMonth() + months);
    r.setDate(Math.min(day, new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate()));
  } else if (u === "weeks") r.setDate(r.getDate() + 7 * n);
  else if (u === "days") r.setDate(r.getDate() + n);
  else if (u === "hours") r.setHours(r.getHours() + n);
  else r.setMinutes(r.getMinutes() + n);
  return { date: r, end: null, time: d.time || u === "hours" || u === "minutes" };
}
function monthsBetween(a: Date, b: Date) {
  let m = (a.getFullYear() - b.getFullYear()) * 12 + (a.getMonth() - b.getMonth());
  // Only count whole months.
  if (m > 0 && a.getDate() < b.getDate()) m--;
  if (m < 0 && a.getDate() > b.getDate()) m++;
  return m;
}

function formatDate(d: FDate, pattern: string): string {
  const x = d.date;
  return pattern.replace(/YYYY|YY|MMMM|MM|M|DDDD|DD|D|HH|mm|ss/g, (tok) => {
    switch (tok) {
      case "YYYY": return String(x.getFullYear());
      case "YY": return String(x.getFullYear()).slice(-2);
      case "MMMM": return x.toLocaleString(intlLocale(), { month: "long" });
      case "MM": return pad(x.getMonth() + 1);
      case "M": return String(x.getMonth() + 1);
      case "DDDD": return x.toLocaleString(intlLocale(), { weekday: "long" });
      case "DD": return pad(x.getDate());
      case "D": return String(x.getDate());
      case "HH": return pad(x.getHours());
      case "mm": return pad(x.getMinutes());
      default: return pad(x.getSeconds());
    }
  });
}

export interface FunctionSpec {
  min: number;
  max: number;
  /** Arguments are evaluated lazily for if / ifs / and / or. */
  lazy?: boolean;
  run: (args: FValue[], lazyArgs: (() => FValue)[]) => FValue;
  /** Shown in the editor's help. */
  help: string;
}

const numeric = (fn: (x: number) => number, name: string): FunctionSpec["run"] => (a) => fn(num(a[0]!, `${name}()`));
const flatNumbers = (a: FValue[], fn: string) => a.flatMap(list).filter((v) => v !== null).map((v) => num(v, fn));

const BUILTINS: Record<string, Omit<FunctionSpec, "help">> = {
  if: { min: 3, max: 3, lazy: true, run: (_, l) => (truthy(l[0]!()) ? l[1]!() : l[2]!()) },
  ifs: {
    min: 2,
    max: Infinity,
    lazy: true,
    run: (_, l) => {
      for (let i = 0; i + 1 < l.length; i += 2) if (truthy(l[i]!())) return l[i + 1]!();
      return l.length % 2 ? l[l.length - 1]!() : null;
    },
  },
  and: { min: 1, max: Infinity, lazy: true, run: (_, l) => l.every((f) => truthy(f())) },
  or: { min: 1, max: Infinity, lazy: true, run: (_, l) => l.some((f) => truthy(f())) },
  not: { min: 1, max: 1, run: (a) => !truthy(a[0]!) },
  empty: { min: 1, max: 1, run: (a) => empty(a[0]!) },

  length: { min: 1, max: 1, run: (a) => (Array.isArray(a[0]) ? a[0].length : toText(a[0]!).length) },
  concat: {
    min: 1,
    max: Infinity,
    run: (a) => (a.some(Array.isArray) ? a.flatMap(list) : a.map(toText).join("")),
  },
  join: { min: 1, max: 2, run: (a) => list(a[0]!).map(toText).join(a[1] === undefined ? ", " : toText(a[1]!)) },
  contains: {
    min: 2,
    max: 2,
    run: (a) => (Array.isArray(a[0]) ? a[0].some((v) => equals(v, a[1]!)) : toText(a[0]!).toLowerCase().includes(toText(a[1]!).toLowerCase())),
  },
  lower: { min: 1, max: 1, run: (a) => toText(a[0]!).toLowerCase() },
  upper: { min: 1, max: 1, run: (a) => toText(a[0]!).toUpperCase() },
  trim: { min: 1, max: 1, run: (a) => toText(a[0]!).trim() },
  replace: { min: 3, max: 3, run: (a) => toText(a[0]!).replace(toText(a[1]!), toText(a[2]!)) },
  replaceAll: { min: 3, max: 3, run: (a) => toText(a[0]!).split(toText(a[1]!)).join(toText(a[2]!)) },
  slice: {
    min: 2,
    max: 3,
    run: (a) => (Array.isArray(a[0]) ? a[0].slice(num(a[1]!, "slice()"), a[2] === undefined ? undefined : num(a[2], "slice()")) : toText(a[0]!).slice(num(a[1]!, "slice()"), a[2] === undefined ? undefined : num(a[2], "slice()"))),
  },
  format: { min: 1, max: 1, run: (a) => toText(a[0]!) },
  toNumber: {
    min: 1,
    max: 1,
    run: (a) => {
      const v = a[0]!;
      if (isDate(v)) return v.date.getTime();
      if (typeof v === "boolean") return v ? 1 : 0;
      if (typeof v === "number") return v;
      const n = Number(toText(v).replace(/\s/g, "").replace(",", "."));
      return Number.isFinite(n) && toText(v).trim() !== "" ? n : null;
    },
  },

  abs: { min: 1, max: 1, run: numeric(Math.abs, "abs") },
  round: {
    min: 1,
    max: 2,
    run: (a) => {
      const f = 10 ** (a[1] === undefined ? 0 : num(a[1], "round()"));
      return Math.round(num(a[0]!, "round()") * f) / f;
    },
  },
  floor: { min: 1, max: 1, run: numeric(Math.floor, "floor") },
  ceil: { min: 1, max: 1, run: numeric(Math.ceil, "ceil") },
  sqrt: { min: 1, max: 1, run: numeric(Math.sqrt, "sqrt") },
  pow: { min: 2, max: 2, run: (a) => num(a[0]!, "pow()") ** num(a[1]!, "pow()") },
  min: { min: 1, max: Infinity, run: (a) => { const n = flatNumbers(a, "min()"); return n.length ? Math.min(...n) : null; } },
  max: { min: 1, max: Infinity, run: (a) => { const n = flatNumbers(a, "max()"); return n.length ? Math.max(...n) : null; } },
  sum: { min: 1, max: Infinity, run: (a) => flatNumbers(a, "sum()").reduce((x, y) => x + y, 0) },
  average: {
    min: 1,
    max: Infinity,
    run: (a) => { const n = flatNumbers(a, "average()"); return n.length ? n.reduce((x, y) => x + y, 0) / n.length : null; },
  },

  now: { min: 0, max: 0, run: () => ({ date: new Date(), end: null, time: true }) },
  today: { min: 0, max: 0, run: () => makeDate(isoDay(new Date())) },
  dateAdd: { min: 3, max: 3, run: (a) => addTo(date(a[0]!, "dateAdd()"), num(a[1]!, "dateAdd()"), unit(a[2]!, "dateAdd()")) },
  dateSubtract: { min: 3, max: 3, run: (a) => addTo(date(a[0]!, "dateSubtract()"), -num(a[1]!, "dateSubtract()"), unit(a[2]!, "dateSubtract()")) },
  dateBetween: {
    min: 3,
    max: 3,
    run: (a) => {
      const x = date(a[0]!, "dateBetween()").date;
      const y = date(a[1]!, "dateBetween()").date;
      const u = unit(a[2]!, "dateBetween()");
      if (u === "years") return Math.trunc(monthsBetween(x, y) / 12);
      if (u === "quarters") return Math.trunc(monthsBetween(x, y) / 3);
      if (u === "months") return monthsBetween(x, y);
      const ms = x.getTime() - y.getTime();
      const per = { weeks: 604_800_000, days: 86_400_000, hours: 3_600_000, minutes: 60_000 }[u]!;
      // Days are counted on the calendar, so a change of summer time doesn't shift them.
      if (u === "days" || u === "weeks") {
        const days = Math.round((Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()) - Date.UTC(y.getFullYear(), y.getMonth(), y.getDate())) / 86_400_000);
        return u === "days" ? days : Math.trunc(days / 7);
      }
      return Math.trunc(ms / per);
    },
  },
  dateStart: { min: 1, max: 1, run: (a) => ({ ...date(a[0]!, "dateStart()"), end: null }) },
  dateEnd: {
    min: 1,
    max: 1,
    run: (a) => {
      const d = date(a[0]!, "dateEnd()");
      return { date: d.end ?? d.date, end: null, time: d.time };
    },
  },
  formatDate: { min: 2, max: 2, run: (a) => formatDate(date(a[0]!, "formatDate()"), toText(a[1]!)) },
  year: { min: 1, max: 1, run: (a) => date(a[0]!, "year()").date.getFullYear() },
  month: { min: 1, max: 1, run: (a) => date(a[0]!, "month()").date.getMonth() + 1 },
  date: { min: 1, max: 1, run: (a) => date(a[0]!, "date()").date.getDate() },
  day: { min: 1, max: 1, run: (a) => date(a[0]!, "day()").date.getDay() },
  hour: { min: 1, max: 1, run: (a) => date(a[0]!, "hour()").date.getHours() },
  minute: { min: 1, max: 1, run: (a) => date(a[0]!, "minute()").date.getMinutes() },
  timestamp: { min: 1, max: 1, run: (a) => date(a[0]!, "timestamp()").date.getTime() },
  parseDate: {
    min: 1,
    max: 1,
    run: (a) => {
      const s = toText(a[0]!).trim();
      const fr = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
      return makeDate(fr ? `${fr[3]}-${fr[2]!.padStart(2, "0")}-${fr[1]!.padStart(2, "0")}` : s);
    },
  },
};

// Built-in functions take their help from the message catalogue, in the current language.
export const FUNCTIONS: Record<string, FunctionSpec> = Object.fromEntries(
  Object.entries(BUILTINS).map(([name, spec]) => [
    name,
    Object.defineProperty({ ...spec, help: "" }, "help", { get: () => t(`formula.help.${name}` as MessageKey), enumerable: true }),
  ]),
);

const FUNCTION_ALIASES: Record<string, string> = Object.fromEntries(Object.keys(FUNCTIONS).map((k) => [k.toLowerCase(), k]));
const BUILTIN_FUNCTIONS = new Set(Object.keys(FUNCTIONS));

/** Adds a function from a plugin. Built-in functions can't be replaced. Returns a function that removes it. */
export function registerFormulaFunction(name: string, spec: Omit<FunctionSpec, "lazy">): () => void {
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(name)) throw new Error(`Invalid function name: ${name}`);
  const key = name.toLowerCase();
  if (BUILTIN_FUNCTIONS.has(name) || Object.hasOwn(FUNCTION_ALIASES, key)) throw new Error(`The function ${name}() already exists.`);
  FUNCTIONS[name] = { ...spec, lazy: false };
  FUNCTION_ALIASES[key] = name;
  return () => {
    if (FUNCTIONS[name]?.run !== spec.run) return;
    delete FUNCTIONS[name];
    delete FUNCTION_ALIASES[key];
  };
}

// --- Evaluation -----------------------------------------------------------------------------

/** Evaluates a parsed expression. `getProp` returns a column's value, or throws FormulaError. */
export function evaluateFormula(node: FormulaNode, getProp: (name: string) => FValue): FValue {
  const ev = (n: FormulaNode): FValue => {
    switch (n.type) {
      case "num":
      case "str":
      case "bool":
        return n.value;
      case "prop":
        return getProp(n.name);
      case "cond":
        return truthy(ev(n.test)) ? ev(n.then) : ev(n.else);
      case "unary": {
        const v = ev(n.arg);
        return n.op === "!" ? !truthy(v) : -num(v, "« - »");
      }
      case "call": {
        // A plugin's function may have been removed since the expression was parsed.
        const spec = Object.hasOwn(FUNCTIONS, n.name) ? FUNCTIONS[n.name] : undefined;
        if (!spec) throw new FormulaError(t("formula.error.unknownFunction", { name: n.name }));
        if (spec.lazy) return spec.run([], n.args.map((a) => () => ev(a)));
        return spec.run(n.args.map(ev), []);
      }
      case "binary": {
        if (n.op === "&&") return truthy(ev(n.left)) && truthy(ev(n.right));
        if (n.op === "||") return truthy(ev(n.left)) || truthy(ev(n.right));
        const a = ev(n.left);
        const b = ev(n.right);
        switch (n.op) {
          case "+":
            if (typeof a === "string" || typeof b === "string") return toText(a) + toText(b);
            if (isDate(a) || isDate(b)) throw new FormulaError(t("formula.error.useDateAdd"));
            return num(a, "« + »") + num(b, "« + »");
          case "-":
            if (isDate(a) || isDate(b)) throw new FormulaError(t("formula.error.useDateBetween"));
            return num(a, "« - »") - num(b, "« - »");
          case "*":
            return num(a, "« * »") * num(b, "« * »");
          case "/": {
            const d = num(b, "« / »");
            if (d === 0) throw new FormulaError(t("formula.error.divisionByZero"));
            return num(a, "« / »") / d;
          }
          case "%":
            return num(a, "« % »") % num(b, "« % »");
          case "^":
            return num(a, "« ^ »") ** num(b, "« ^ »");
          case "==":
            return equals(a, b);
          case "!=":
            return !equals(a, b);
          default:
            return compare(a, b, n.op);
        }
      }
    }
  };
  return ev(node);
}

/** Result of a formula cell, as stored in row values. */
export type FormulaResult =
  | { kind: "number"; value: number }
  | { kind: "text"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "date"; value: string }
  | { kind: "list"; value: string[] }
  | { kind: "error"; value: string };

export function toFormulaResult(v: FValue): FormulaResult | null {
  if (v === null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? { kind: "number", value: Math.round(v * 1e9) / 1e9 } : { kind: "error", value: t("formula.error.infinite") };
  if (typeof v === "string") return v === "" ? null : { kind: "text", value: v };
  if (typeof v === "boolean") return { kind: "boolean", value: v };
  if (Array.isArray(v)) return v.length ? { kind: "list", value: v.map(toText) } : null;
  const d = v.date;
  return { kind: "date", value: v.time ? d.toISOString() : isoDay(d) };
}
