import { collator, dateTimeFormat, numberFormat, t, type MessageKey } from "./i18n/index.js";
/**
 * Formula language of database columns, close to Notion's:
 *   prop("Price") * 1.2
 *   if(prop("Paid"), "Paid", "To pay")
 *   dateBetween(now(), prop("Due"), "days")
 * It also accepts Notion 2's syntax: lists [1, 2], method calls prop("Name").upper(),
 * variables with let() / lets(), and map() / filter() / find()… with `current` and `index`.
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

const OPERATORS = ["==", "!=", ">=", "<=", "&&", "||", "+", "-", "*", "/", "%", "^", ">", "<", "!", "(", ")", ",", "?", ":", "=", ".", "[", "]"];

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
      // "1.5" and "1." are numbers, but in "1.format()" the dot starts a method call.
      const m = /^(\d+\.\d+|\d+\.(?![A-Za-z_À-ÿ])|\d+|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i))!;
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
  /** A column of the row, or with `of` a column of related pages: current.prop("Price"). */
  | { type: "prop"; name: string; of?: FormulaNode }
  | { type: "var"; name: string }
  | { type: "list"; items: FormulaNode[] }
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
    const base = postfix();
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

  // Variables visible where the parser is: those of let() / lets(), and current / index inside map()…
  const scopes: Set<string>[] = [];
  const inScope = (name: string) => scopes.some((s) => s.has(name));

  /** Arguments of a call, the opening parenthesis already read. `offset` is 1 for a method call (the receiver is the first argument). */
  const callArgs = (fn: string, offset: number): FormulaNode[] => {
    const args: FormulaNode[] = [];
    const isLet = fn === "let" || fn === "lets";
    const lambda = LAMBDA_FUNCTIONS.has(fn);
    const scope = new Set<string>();
    scopes.push(scope);
    try {
      if (!isOp(")")) {
        for (;;) {
          const index = args.length + offset;
          const tok = peek();
          const next = tokens[pos + 1];
          // let(name, value, expression): the name is a bare word, followed by a comma.
          if (isLet && index % 2 === 0 && tok.t === "id" && next?.t === "op" && next.v === ",") {
            if (fn === "let" && index > 0) throw new FormulaError(t("formula.error.unexpected", { token: tok.v }), tok.p);
            pos++;
            args.push({ type: "str", value: tok.v });
          } else {
            if (lambda && index === 1) scope.add("current").add("index");
            args.push(ternary());
            // A variable is visible from the argument after its value.
            if (isLet && index % 2 === 1) scope.add((args[args.length - 2] as { value: string }).value);
          }
          if (!isOp(",")) break;
          pos++;
        }
      }
      expect(")");
    } finally {
      scopes.pop();
    }
    if (isLet) {
      const total = args.length + offset;
      if (total < 3 || total % 2 === 0 || args.slice(0, -1).some((a, i) => i % 2 === 0 && a.type !== "str")) {
        throw new FormulaError(t("formula.error.letArguments"), peek().p);
      }
    }
    return args;
  };

  /** Builds a call to a function (or prop()), checking its name and number of arguments. */
  const makeCall = (name: string, p: number, args: FormulaNode[]): FormulaNode => {
    const word = name.toLowerCase();
    if (word === "prop") {
      const nameArg = args[args.length - 1];
      if ((args.length !== 1 && args.length !== 2) || nameArg?.type !== "str") throw new FormulaError(t("formula.error.propArgument"), p);
      return args.length === 2 ? { type: "prop", name: nameArg.value, of: args[0] } : { type: "prop", name: nameArg.value };
    }
    const fn = resolveFunction(name);
    const spec = fn ? FUNCTIONS[fn] : undefined;
    if (!fn || !spec) throw new FormulaError(t("formula.error.unknownFunction", { name }), p);
    if (args.length < spec.min || args.length > spec.max) {
      throw new FormulaError(
        t("formula.error.argumentCount", { fn, count: spec.min === spec.max ? spec.min : t("formula.error.argumentRange", { min: spec.min, max: spec.max === Infinity ? "n" : spec.max }) }),
        p,
      );
    }
    return { type: "call", name: fn, args, p };
  };

  // Notion 2's method calls: prop("Name").upper(), prop("Tags").map(current + "!"), current.prop("Price").
  const postfix = (): FormulaNode => {
    let node = primary();
    while (isOp(".")) {
      pos++;
      const tok = peek();
      if (tok.t !== "id") throw new FormulaError(t("formula.error.expectedFunction"), tok.p);
      pos++;
      let args: FormulaNode[] = [];
      if (isOp("(")) {
        pos++;
        args = callArgs(resolveFunction(tok.v) ?? tok.v.toLowerCase(), 1);
      }
      node = makeCall(tok.v, tok.p, [node, ...args]);
    }
    return node;
  };

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
    if (tok.t === "op" && tok.v === "[") {
      pos++;
      const items: FormulaNode[] = [];
      if (!isOp("]")) {
        items.push(ternary());
        while (isOp(",")) {
          pos++;
          items.push(ternary());
        }
      }
      expect("]");
      return { type: "list", items };
    }
    if (tok.t === "id") {
      pos++;
      if (!isOp("(")) {
        if (inScope(tok.v)) return { type: "var", name: tok.v };
        const word = tok.v.toLowerCase();
        if (word === "true" || word === "vrai") return { type: "bool", value: true };
        if (word === "false" || word === "faux") return { type: "bool", value: false };
        if (tok.v === "pi") return { type: "num", value: Math.PI };
        if (tok.v === "e") return { type: "num", value: Math.E };
        if (tok.v === "current" || tok.v === "index") throw new FormulaError(t("formula.error.currentOutside", { name: tok.v }), tok.p);
        throw new FormulaError(t("formula.error.unknownName", { name: tok.v }), tok.p);
      }
      pos++;
      return makeCall(tok.v, tok.p, callArgs(resolveFunction(tok.v) ?? tok.v.toLowerCase(), 0));
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
    // current.prop("Price") reads a column of the related database, not of this one.
    if (n.type === "prop") {
      if (n.of) walk(n.of);
      else out.add(n.name);
    } else if (n.type === "call") n.args.forEach(walk);
    else if (n.type === "list") n.items.forEach(walk);
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
  return src.replace(new RegExp(`(?<!\\.\\s*)prop\\(\\s*(["'])${escaped}\\1\\s*\\)`, "g"), `prop("${newName.replace(/"/g, '\\"')}")`);
}

// --- Values ---------------------------------------------------------------------------------

/** A date, with the end of the range when the column has one. `time` is false for date-only values. */
export interface FDate {
  date: Date;
  end: Date | null;
  time: boolean;
}
/** A related page (from a relation column). It reads as its title; current.prop("Price") reads its columns. */
export interface FPage {
  page: string;
  title: string;
  prop: (name: string) => FValue;
}
export type FValue = number | string | boolean | FDate | FPage | FValue[] | null;

const isDate = (v: FValue): v is FDate => typeof v === "object" && v !== null && !Array.isArray(v) && "date" in v;
const isPage = (v: FValue): v is FPage => typeof v === "object" && v !== null && !Array.isArray(v) && "page" in v;

export function makeDate(iso: string, end?: string | null): FDate | null {
  const parse = (s: string) => (s.length <= 10 ? new Date(`${s}T00:00:00`) : new Date(s));
  const d = parse(iso);
  if (Number.isNaN(d.getTime())) return null;
  return { date: d, end: end ? parse(end) : null, time: iso.length > 10 };
}

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const DATE_TEXT: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric" };
const DATE_TIME_TEXT: Intl.DateTimeFormatOptions = { ...DATE_TEXT, hour: "2-digit", minute: "2-digit", hour12: false };

function toText(v: FValue): string {
  if (v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return numberFormat({ maximumFractionDigits: 10, useGrouping: false }).format(v);
  if (typeof v === "boolean") return v ? t("formula.true") : t("formula.false");
  if (Array.isArray(v)) return v.map(toText).join(", ");
  if (isPage(v)) return v.title;
  const d = v.date;
  return dateTimeFormat(v.time ? DATE_TIME_TEXT : DATE_TEXT)
    .format(d)
    .replace(",", "");
}

const typeName = (v: FValue) =>
  t(v === null ? "formula.type.empty" : Array.isArray(v) ? "formula.type.list" : isDate(v) ? "formula.type.date" : isPage(v) ? "formula.type.page" : typeof v === "number" ? "formula.type.number" : typeof v === "string" ? "formula.type.text" : "formula.type.boolean");

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
function page(v: FValue, fn: string): FPage {
  if (isPage(v)) return v;
  throw new FormulaError(t("formula.error.expectsPage", { fn, type: typeName(v) }));
}
function int(v: FValue, fn: string): number {
  return Math.trunc(num(v, fn));
}
/** Pages become their titles, for plugins' functions. */
const plain = (v: FValue): FValue => (Array.isArray(v) ? v.map(plain) : isPage(v) ? v.title : v);

// Limits, so that one formula can't hang the server.
const MAX_TEXT = 100_000;
const MAX_REGEX_INPUT = 5_000;
function checkLength(s: string, fn: string): string {
  if (s.length > MAX_TEXT) throw new FormulaError(t("formula.error.tooLong", { fn }));
  return s;
}
/**
 * A regular expression from a formula. Patterns are kept short and nested repetitions such as (a+)+
 * are refused: they can take exponential time on some texts.
 */
function regex(pattern: FValue, text: FValue, fn: string, flags = ""): { re: RegExp; text: string } {
  const src = toText(pattern);
  const input = toText(text);
  // Nested or alternated repetitions, (a+)+ or (a|aa)*, and many unbounded repetitions in a row.
  const nested = /\((?:[^()\\]|\\.)*[*+}|](?:[^()\\]|\\.)*\)\s*[*+{]/.test(src);
  const unbounded = (src.match(/(?<!\\)(?:[*+]|\{\d+,\})/g) ?? []).length;
  if (src.length > 200 || nested || unbounded > 4) throw new FormulaError(t("formula.error.regexTooComplex", { fn }));
  if (input.length > MAX_REGEX_INPUT) throw new FormulaError(t("formula.error.tooLong", { fn }));
  try {
    return { re: new RegExp(src, flags), text: input };
  } catch {
    throw new FormulaError(t("formula.error.badRegex", { fn, pattern: src }));
  }
}
const truthy = (v: FValue): boolean => (Array.isArray(v) ? v.length > 0 : v !== null && v !== false && v !== 0 && v !== "");
const empty = (v: FValue) => v === null || v === "" || (Array.isArray(v) && v.length === 0);

function equals(a: FValue, b: FValue): boolean {
  if (isDate(a) && isDate(b)) return a.date.getTime() === b.date.getTime();
  if (isPage(a) && isPage(b)) return a.page === b.page;
  // A related page equals its title.
  if (isPage(a) && typeof b === "string") return a.title === b;
  if (isPage(b) && typeof a === "string") return b.title === a;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equals(v, b[i]!));
  if (empty(a) && empty(b)) return true;
  return a === b;
}

/** Order of two values for sort(): empty values last, then numbers, texts, dates… */
function order(a: FValue, b: FValue): number {
  if (empty(a) || empty(b)) return empty(a) ? (empty(b) ? 0 : 1) : -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  if (isDate(a) && isDate(b)) return a.date.getTime() - b.date.getTime();
  return collator({ numeric: true }).compare(toText(a), toText(b));
}

/** ISO 8601 week number (weeks start on Monday, week 1 holds the first Thursday). */
function isoWeek(d: Date): number {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  x.setUTCDate(x.getUTCDate() + 4 - (x.getUTCDay() || 7));
  return Math.ceil(((x.getTime() - Date.UTC(x.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7);
}

function compare(a: FValue, b: FValue, op: string): boolean {
  let x: number | string;
  let y: number | string;
  if (isDate(a) && isDate(b)) [x, y] = [a.date.getTime(), b.date.getTime()];
  else if ((typeof a === "string" || isPage(a)) && (typeof b === "string" || isPage(b))) [x, y] = [collator().compare(toText(a), toText(b)), 0];
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
      case "MMMM": return dateTimeFormat({ month: "long" }).format(x);
      case "MM": return pad(x.getMonth() + 1);
      case "M": return String(x.getMonth() + 1);
      case "DDDD": return dateTimeFormat({ weekday: "long" }).format(x);
      case "DD": return pad(x.getDate());
      case "D": return String(x.getDate());
      case "HH": return pad(x.getHours());
      case "mm": return pad(x.getMinutes());
      default: return pad(x.getSeconds());
    }
  });
}

/** What a function knows about the formula being computed. */
export interface FormulaContext {
  /** Id of the row (page) whose formula is computed, for id(). */
  rowId?: string;
}

export interface FunctionSpec {
  min: number;
  max: number;
  /**
   * Arguments are evaluated lazily for if / ifs / and / or, let() and the functions that take an
   * expression (map, filter…): `vars` gives values to variables such as current and index.
   */
  lazy?: boolean;
  run: (args: FValue[], lazyArgs: ((vars?: Record<string, FValue>) => FValue)[], ctx: FormulaContext) => FValue;
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

  // Notion 2: variables.
  let: { min: 3, max: 3, lazy: true, run: (_, l) => l[2]!({ [toText(l[0]!())]: l[1]!() }) },
  lets: {
    min: 3,
    max: Infinity,
    lazy: true,
    run: (_, l) => {
      const vars: Record<string, FValue> = {};
      for (let i = 0; i + 1 < l.length; i += 2) vars[toText(l[i]!())] = l[i + 1]!({ ...vars });
      return l[l.length - 1]!(vars);
    },
  },

  // Lists. The expression of map, filter… sees each item as `current`, and its position (from 0) as `index`.
  map: { min: 2, max: 2, lazy: true, run: (_, l) => list(l[0]!()).map((current, index) => l[1]!({ current, index })) },
  filter: { min: 2, max: 2, lazy: true, run: (_, l) => list(l[0]!()).filter((current, index) => truthy(l[1]!({ current, index }))) },
  find: { min: 2, max: 2, lazy: true, run: (_, l) => list(l[0]!()).find((current, index) => truthy(l[1]!({ current, index }))) ?? null },
  findIndex: { min: 2, max: 2, lazy: true, run: (_, l) => list(l[0]!()).findIndex((current, index) => truthy(l[1]!({ current, index }))) },
  some: { min: 2, max: 2, lazy: true, run: (_, l) => list(l[0]!()).some((current, index) => truthy(l[1]!({ current, index }))) },
  every: { min: 2, max: 2, lazy: true, run: (_, l) => list(l[0]!()).every((current, index) => truthy(l[1]!({ current, index }))) },
  sort: {
    min: 1,
    max: 2,
    lazy: true,
    run: (_, l) => {
      const items = list(l[0]!());
      // sort(list, current.prop("Price")): sorted by an expression of each item.
      const keys = l[1] ? items.map((current, index) => l[1]!({ current, index })) : items;
      return items
        .map((v, i) => i)
        .sort((x, y) => order(keys[x]!, keys[y]!))
        .map((i) => items[i]!);
    },
  },
  reverse: { min: 1, max: 1, run: (a) => [...list(a[0]!)].reverse() },
  unique: { min: 1, max: 1, run: (a) => list(a[0]!).filter((v, i, all) => all.findIndex((w) => equals(v, w)) === i) },
  flat: { min: 1, max: 1, run: (a) => list(a[0]!).flatMap(list) },
  at: {
    min: 2,
    max: 2,
    run: (a) => (Array.isArray(a[0]) || isPage(a[0]!) ? (list(a[0]!).at(int(a[1]!, "at()")) ?? null) : toText(a[0]!).at(int(a[1]!, "at()")) ?? null),
  },
  first: { min: 1, max: 1, run: (a) => list(a[0]!)[0] ?? null },
  last: { min: 1, max: 1, run: (a) => list(a[0]!).at(-1) ?? null },
  includes: {
    min: 2,
    max: 2,
    run: (a) => (Array.isArray(a[0]) ? a[0].some((v) => equals(v, a[1]!)) : toText(a[0]!).includes(toText(a[1]!))),
  },
  split: { min: 1, max: 2, run: (a) => checkLength(toText(a[0]!), "split()").split(a[1] === undefined ? "," : toText(a[1]!)) },
  median: {
    min: 1,
    max: Infinity,
    run: (a) => {
      const n = flatNumbers(a, "median()").sort((x, y) => x - y);
      if (!n.length) return null;
      const m = n.length >> 1;
      return n.length % 2 ? n[m]! : (n[m - 1]! + n[m]!) / 2;
    },
  },

  // Texts.
  test: { min: 2, max: 2, run: (a) => { const r = regex(a[1]!, a[0]!, "test()"); return r.re.test(r.text); } },
  match: { min: 2, max: 2, run: (a) => { const r = regex(a[1]!, a[0]!, "match()", "g"); return r.text.match(r.re) ?? []; } },
  replaceRegex: { min: 3, max: 3, run: (a) => { const r = regex(a[1]!, a[0]!, "replaceRegex()"); return r.text.replace(r.re, toText(a[2]!)); } },
  replaceAllRegex: { min: 3, max: 3, run: (a) => { const r = regex(a[1]!, a[0]!, "replaceAllRegex()", "g"); return r.text.replace(r.re, toText(a[2]!)); } },
  repeat: {
    min: 2,
    max: 2,
    run: (a) => {
      const s = toText(a[0]!);
      const n = Math.max(0, int(a[1]!, "repeat()"));
      return checkLength(s.length * n > MAX_TEXT ? "x".repeat(MAX_TEXT + 1) : s.repeat(n), "repeat()");
    },
  },
  padStart: { min: 2, max: 3, run: (a) => toText(a[0]!).padStart(Math.min(int(a[1]!, "padStart()"), MAX_TEXT), a[2] === undefined ? " " : toText(a[2]!)) },
  padEnd: { min: 2, max: 3, run: (a) => toText(a[0]!).padEnd(Math.min(int(a[1]!, "padEnd()"), MAX_TEXT), a[2] === undefined ? " " : toText(a[2]!)) },
  name: { min: 1, max: 1, run: (a) => (Array.isArray(a[0]) ? a[0].map(toText) : toText(a[0]!)) },

  // Numbers.
  sign: { min: 1, max: 1, run: numeric(Math.sign, "sign") },
  cbrt: { min: 1, max: 1, run: numeric(Math.cbrt, "cbrt") },
  exp: { min: 1, max: 1, run: numeric(Math.exp, "exp") },
  ln: { min: 1, max: 1, run: numeric(Math.log, "ln") },
  log10: { min: 1, max: 1, run: numeric(Math.log10, "log10") },
  log2: { min: 1, max: 1, run: numeric(Math.log2, "log2") },

  // Dates.
  week: { min: 1, max: 1, run: (a) => isoWeek(date(a[0]!, "week()").date) },
  fromTimestamp: {
    min: 1,
    max: 1,
    run: (a) => {
      const d = new Date(num(a[0]!, "fromTimestamp()"));
      return Number.isNaN(d.getTime()) ? null : { date: d, end: null, time: true };
    },
  },
  dateRange: {
    min: 2,
    max: 2,
    run: (a) => {
      const start = date(a[0]!, "dateRange()");
      const end = date(a[1]!, "dateRange()");
      return { date: start.date, end: end.date, time: start.time || end.time };
    },
  },

  // Pages.
  id: { min: 0, max: 1, run: (a, _, ctx) => (a.length ? page(a[0]!, "id()").page : (ctx.rowId ?? null)) },
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
/** Functions whose second argument is an expression of `current` and `index`. */
const LAMBDA_FUNCTIONS = new Set(["map", "filter", "find", "findIndex", "some", "every", "sort"]);

/** Canonical name of a function, whatever its case: "datebetween" → "dateBetween". */
function resolveFunction(name: string): string | undefined {
  const key = name.toLowerCase();
  const fn = Object.hasOwn(FUNCTION_ALIASES, key) ? FUNCTION_ALIASES[key] : undefined;
  return fn && Object.hasOwn(FUNCTIONS, fn) ? fn : undefined;
}

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
export function evaluateFormula(node: FormulaNode, getProp: (name: string) => FValue, ctx: FormulaContext = {}): FValue {
  type Vars = Record<string, FValue>;
  const ev = (n: FormulaNode, vars: Vars): FValue => {
    switch (n.type) {
      case "num":
      case "str":
      case "bool":
        return n.value;
      case "var":
        return Object.hasOwn(vars, n.name) ? vars[n.name]! : null;
      case "list":
        return n.items.map((i) => ev(i, vars));
      case "prop": {
        if (!n.of) return getProp(n.name);
        // current.prop("Price"), or on a list of pages, the list of their values.
        const of = ev(n.of, vars);
        const read = (v: FValue): FValue => (v === null ? null : page(v, "prop()").prop(n.name));
        return Array.isArray(of) ? of.map(read) : read(of);
      }
      case "cond":
        return truthy(ev(n.test, vars)) ? ev(n.then, vars) : ev(n.else, vars);
      case "unary": {
        const v = ev(n.arg, vars);
        return n.op === "!" ? !truthy(v) : -num(v, "« - »");
      }
      case "call": {
        // A plugin's function may have been removed since the expression was parsed.
        const spec = Object.hasOwn(FUNCTIONS, n.name) ? FUNCTIONS[n.name] : undefined;
        if (!spec) throw new FormulaError(t("formula.error.unknownFunction", { name: n.name }));
        if (spec.lazy) return spec.run([], n.args.map((a) => (extra?: Vars) => ev(a, extra ? { ...vars, ...extra } : vars)), ctx);
        const args = n.args.map((a) => ev(a, vars));
        return spec.run(BUILTIN_FUNCTIONS.has(n.name) ? args : args.map(plain), [], ctx);
      }
      case "binary": {
        if (n.op === "&&") return truthy(ev(n.left, vars)) && truthy(ev(n.right, vars));
        if (n.op === "||") return truthy(ev(n.left, vars)) || truthy(ev(n.right, vars));
        const a = ev(n.left, vars);
        const b = ev(n.right, vars);
        switch (n.op) {
          case "+":
            if (typeof a === "string" || typeof b === "string" || isPage(a) || isPage(b)) return checkLength(toText(a) + toText(b), "« + »");
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
  return ev(node, {});
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
  if (isPage(v)) return v.title ? { kind: "text", value: v.title } : null;
  const d = v.date;
  return { kind: "date", value: v.time ? d.toISOString() : isoDay(d) };
}
