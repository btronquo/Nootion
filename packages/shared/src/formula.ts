/**
 * Formula language of database columns, close to Notion's:
 *   prop("Montant HT") * 1.2
 *   if(prop("Payée"), "Payée", "À payer")
 *   dateBetween(now(), prop("Échéance"), "days")
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
      if (j >= src.length) throw new FormulaError("Texte non fermé : il manque un guillemet.", i);
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
    if (!op) throw new FormulaError(`Caractère inattendu « ${c} ».`, i);
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
  if (!src.trim()) throw new FormulaError("La formule est vide.", 0);
  const tokens = tokenize(src);
  let pos = 0;
  const peek = () => tokens[pos]!;
  const isOp = (v: string) => peek().t === "op" && (peek() as { v: string }).v === v;
  const isWord = (v: string) => peek().t === "id" && (peek() as { v: string }).v.toLowerCase() === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new FormulaError(`« ${v} » attendu.`, peek().p);
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
      const t = peek();
      let op: string | undefined;
      if (t.t === "op" && ops.includes(t.v)) op = t.v;
      else if (t.t === "id" && words[t.v.toLowerCase()]) op = words[t.v.toLowerCase()];
      if (!op) return left;
      pos++;
      left = { type: "binary", op: op === "=" ? "==" : op, left, right: next(), p: t.p };
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
    const t = peek();
    if (t.t === "num") {
      pos++;
      return { type: "num", value: t.v };
    }
    if (t.t === "str") {
      pos++;
      return { type: "str", value: t.v };
    }
    if (t.t === "op" && t.v === "(") {
      pos++;
      const e = ternary();
      expect(")");
      return e;
    }
    if (t.t === "id") {
      pos++;
      const word = t.v.toLowerCase();
      if (word === "true" || word === "vrai") return { type: "bool", value: true };
      if (word === "false" || word === "faux") return { type: "bool", value: false };
      if (!isOp("(")) throw new FormulaError(`« ${t.v} » inconnu. Pour une colonne, écrivez prop("${t.v}").`, t.p);
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
        if (args.length !== 1 || args[0]!.type !== "str") throw new FormulaError('prop() attend le nom d\'une colonne entre guillemets : prop("Montant").', t.p);
        return { type: "prop", name: (args[0] as { value: string }).value };
      }
      const fn = Object.hasOwn(FUNCTION_ALIASES, word) ? FUNCTION_ALIASES[word]! : word;
      const spec = Object.hasOwn(FUNCTIONS, fn) ? FUNCTIONS[fn] : undefined;
      if (!spec) throw new FormulaError(`Fonction inconnue « ${t.v} ».`, t.p);
      if (args.length < spec.min || args.length > spec.max) {
        throw new FormulaError(`${fn}() attend ${spec.min === spec.max ? spec.min : `${spec.min} à ${spec.max === Infinity ? "n" : spec.max}`} argument(s).`, t.p);
      }
      return { type: "call", name: fn, args, p: t.p };
    }
    if (t.t === "end") throw new FormulaError("La formule s'arrête trop tôt.", t.p);
    throw new FormulaError(`« ${t.v} » inattendu.`, t.p);
  }

  const node = ternary();
  if (peek().t !== "end") throw new FormulaError(`« ${(peek() as { v: string }).v} » inattendu.`, peek().p);
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
  if (typeof v === "number") return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 10, useGrouping: false }).format(v);
  if (typeof v === "boolean") return v ? "vrai" : "faux";
  if (Array.isArray(v)) return v.map(toText).join(", ");
  const d = v.date;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}${v.time ? ` ${pad(d.getHours())}:${pad(d.getMinutes())}` : ""}`;
}

const typeName = (v: FValue) =>
  v === null ? "vide" : Array.isArray(v) ? "liste" : isDate(v) ? "date" : typeof v === "number" ? "nombre" : typeof v === "string" ? "texte" : "booléen";

function num(v: FValue, fn: string): number {
  if (v === null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  throw new FormulaError(`${fn} attend un nombre, pas un ${typeName(v)}.`);
}
function date(v: FValue, fn: string): FDate {
  if (isDate(v)) return v;
  throw new FormulaError(`${fn} attend une date${v === null ? " (la valeur est vide)" : `, pas un ${typeName(v)}`}.`);
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
  else if (typeof a === "string" && typeof b === "string") [x, y] = [a.localeCompare(b, "fr"), 0];
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
  if (!u) throw new FormulaError(`${fn} : unité inconnue « ${toText(v)} » (years, months, weeks, days, hours, minutes…).`);
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
  const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  const x = d.date;
  return pattern.replace(/YYYY|YY|MMMM|MM|M|DDDD|DD|D|HH|mm|ss/g, (tok) => {
    switch (tok) {
      case "YYYY": return String(x.getFullYear());
      case "YY": return String(x.getFullYear()).slice(-2);
      case "MMMM": return MONTHS[x.getMonth()]!;
      case "MM": return pad(x.getMonth() + 1);
      case "M": return String(x.getMonth() + 1);
      case "DDDD": return DAYS[x.getDay()]!;
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

export const FUNCTIONS: Record<string, FunctionSpec> = {
  if: { min: 3, max: 3, lazy: true, run: (_, l) => (truthy(l[0]!()) ? l[1]!() : l[2]!()), help: 'if(condition, siVrai, siFaux) : if(prop("Payée"), "OK", "À payer")' },
  ifs: {
    min: 2,
    max: Infinity,
    lazy: true,
    run: (_, l) => {
      for (let i = 0; i + 1 < l.length; i += 2) if (truthy(l[i]!())) return l[i + 1]!();
      return l.length % 2 ? l[l.length - 1]!() : null;
    },
    help: "ifs(cond1, valeur1, cond2, valeur2, …, sinon)",
  },
  and: { min: 1, max: Infinity, lazy: true, run: (_, l) => l.every((f) => truthy(f())), help: "and(a, b, …), ou a and b" },
  or: { min: 1, max: Infinity, lazy: true, run: (_, l) => l.some((f) => truthy(f())), help: "or(a, b, …), ou a or b" },
  not: { min: 1, max: 1, run: (a) => !truthy(a[0]!), help: "not(a)" },
  empty: { min: 1, max: 1, run: (a) => empty(a[0]!), help: 'empty(prop("Date")) : vrai si la valeur est vide' },

  length: { min: 1, max: 1, run: (a) => (Array.isArray(a[0]) ? a[0].length : toText(a[0]!).length), help: "length(texte ou liste)" },
  concat: {
    min: 1,
    max: Infinity,
    run: (a) => (a.some(Array.isArray) ? a.flatMap(list) : a.map(toText).join("")),
    help: 'concat("Facture ", prop("Numéro")) : met des textes (ou des listes) bout à bout',
  },
  join: { min: 1, max: 2, run: (a) => list(a[0]!).map(toText).join(a[1] === undefined ? ", " : toText(a[1]!)), help: 'join(liste, " / ")' },
  contains: {
    min: 2,
    max: 2,
    run: (a) => (Array.isArray(a[0]) ? a[0].some((v) => equals(v, a[1]!)) : toText(a[0]!).toLowerCase().includes(toText(a[1]!).toLowerCase())),
    help: 'contains(prop("Étiquettes"), "Urgent")',
  },
  lower: { min: 1, max: 1, run: (a) => toText(a[0]!).toLowerCase(), help: "lower(texte)" },
  upper: { min: 1, max: 1, run: (a) => toText(a[0]!).toUpperCase(), help: "upper(texte)" },
  trim: { min: 1, max: 1, run: (a) => toText(a[0]!).trim(), help: "trim(texte)" },
  replace: { min: 3, max: 3, run: (a) => toText(a[0]!).replace(toText(a[1]!), toText(a[2]!)), help: "replace(texte, cherché, remplacement) : première occurrence" },
  replaceAll: { min: 3, max: 3, run: (a) => toText(a[0]!).split(toText(a[1]!)).join(toText(a[2]!)), help: "replaceAll(texte, cherché, remplacement)" },
  slice: {
    min: 2,
    max: 3,
    run: (a) => (Array.isArray(a[0]) ? a[0].slice(num(a[1]!, "slice()"), a[2] === undefined ? undefined : num(a[2], "slice()")) : toText(a[0]!).slice(num(a[1]!, "slice()"), a[2] === undefined ? undefined : num(a[2], "slice()"))),
    help: "slice(texte, début, fin) : partie d'un texte (à partir de 0)",
  },
  format: { min: 1, max: 1, run: (a) => toText(a[0]!), help: "format(valeur) : en texte" },
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
    help: 'toNumber("12,5")',
  },

  abs: { min: 1, max: 1, run: numeric(Math.abs, "abs"), help: "abs(x)" },
  round: {
    min: 1,
    max: 2,
    run: (a) => {
      const f = 10 ** (a[1] === undefined ? 0 : num(a[1], "round()"));
      return Math.round(num(a[0]!, "round()") * f) / f;
    },
    help: "round(x) ou round(x, 2) : arrondi",
  },
  floor: { min: 1, max: 1, run: numeric(Math.floor, "floor"), help: "floor(x) : arrondi inférieur" },
  ceil: { min: 1, max: 1, run: numeric(Math.ceil, "ceil"), help: "ceil(x) : arrondi supérieur" },
  sqrt: { min: 1, max: 1, run: numeric(Math.sqrt, "sqrt"), help: "sqrt(x) : racine carrée" },
  pow: { min: 2, max: 2, run: (a) => num(a[0]!, "pow()") ** num(a[1]!, "pow()"), help: "pow(x, y), ou x ^ y" },
  min: { min: 1, max: Infinity, run: (a) => { const n = flatNumbers(a, "min()"); return n.length ? Math.min(...n) : null; }, help: "min(a, b, …) ou min(liste)" },
  max: { min: 1, max: Infinity, run: (a) => { const n = flatNumbers(a, "max()"); return n.length ? Math.max(...n) : null; }, help: "max(a, b, …) ou max(liste)" },
  sum: { min: 1, max: Infinity, run: (a) => flatNumbers(a, "sum()").reduce((x, y) => x + y, 0), help: "sum(a, b, …) ou sum(liste)" },
  average: {
    min: 1,
    max: Infinity,
    run: (a) => { const n = flatNumbers(a, "average()"); return n.length ? n.reduce((x, y) => x + y, 0) / n.length : null; },
    help: "average(a, b, …) ou average(liste)",
  },

  now: { min: 0, max: 0, run: () => ({ date: new Date(), end: null, time: true }), help: "now() : maintenant" },
  today: { min: 0, max: 0, run: () => makeDate(isoDay(new Date())), help: "today() : aujourd'hui" },
  dateAdd: { min: 3, max: 3, run: (a) => addTo(date(a[0]!, "dateAdd()"), num(a[1]!, "dateAdd()"), unit(a[2]!, "dateAdd()")), help: 'dateAdd(prop("Date"), 30, "days")' },
  dateSubtract: { min: 3, max: 3, run: (a) => addTo(date(a[0]!, "dateSubtract()"), -num(a[1]!, "dateSubtract()"), unit(a[2]!, "dateSubtract()")), help: 'dateSubtract(prop("Date"), 1, "months")' },
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
    help: 'dateBetween(prop("Échéance"), today(), "days") : écart entre deux dates',
  },
  dateStart: { min: 1, max: 1, run: (a) => ({ ...date(a[0]!, "dateStart()"), end: null }), help: "dateStart(date) : début d'une plage" },
  dateEnd: {
    min: 1,
    max: 1,
    run: (a) => {
      const d = date(a[0]!, "dateEnd()");
      return { date: d.end ?? d.date, end: null, time: d.time };
    },
    help: "dateEnd(date) : fin d'une plage",
  },
  formatDate: { min: 2, max: 2, run: (a) => formatDate(date(a[0]!, "formatDate()"), toText(a[1]!)), help: 'formatDate(prop("Date"), "DD/MM/YYYY") (aussi MMMM, DDDD, HH, mm)' },
  year: { min: 1, max: 1, run: (a) => date(a[0]!, "year()").date.getFullYear(), help: "year(date)" },
  month: { min: 1, max: 1, run: (a) => date(a[0]!, "month()").date.getMonth() + 1, help: "month(date) : 1 à 12" },
  date: { min: 1, max: 1, run: (a) => date(a[0]!, "date()").date.getDate(), help: "date(date) : jour du mois" },
  day: { min: 1, max: 1, run: (a) => date(a[0]!, "day()").date.getDay(), help: "day(date) : jour de la semaine (0 = dimanche)" },
  hour: { min: 1, max: 1, run: (a) => date(a[0]!, "hour()").date.getHours(), help: "hour(date)" },
  minute: { min: 1, max: 1, run: (a) => date(a[0]!, "minute()").date.getMinutes(), help: "minute(date)" },
  timestamp: { min: 1, max: 1, run: (a) => date(a[0]!, "timestamp()").date.getTime(), help: "timestamp(date) : en millisecondes" },
  parseDate: {
    min: 1,
    max: 1,
    run: (a) => {
      const s = toText(a[0]!).trim();
      const fr = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
      return makeDate(fr ? `${fr[3]}-${fr[2]!.padStart(2, "0")}-${fr[1]!.padStart(2, "0")}` : s);
    },
    help: 'parseDate("2026-03-15") ou parseDate("15/03/2026")',
  },
};

const FUNCTION_ALIASES: Record<string, string> = Object.fromEntries(Object.keys(FUNCTIONS).map((k) => [k.toLowerCase(), k]));
const BUILTIN_FUNCTIONS = new Set(Object.keys(FUNCTIONS));

/** Adds a function from a plugin. Built-in functions can't be replaced. Returns a function that removes it. */
export function registerFormulaFunction(name: string, spec: Omit<FunctionSpec, "lazy">): () => void {
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(name)) throw new Error(`Nom de fonction invalide : ${name}`);
  const key = name.toLowerCase();
  if (BUILTIN_FUNCTIONS.has(name) || Object.hasOwn(FUNCTION_ALIASES, key)) throw new Error(`La fonction ${name}() existe déjà.`);
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
        if (!spec) throw new FormulaError(`Fonction inconnue « ${n.name} ».`);
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
            if (isDate(a) || isDate(b)) throw new FormulaError("Pour ajouter du temps à une date, utilisez dateAdd().");
            return num(a, "« + »") + num(b, "« + »");
          case "-":
            if (isDate(a) || isDate(b)) throw new FormulaError("Pour l'écart entre deux dates, utilisez dateBetween().");
            return num(a, "« - »") - num(b, "« - »");
          case "*":
            return num(a, "« * »") * num(b, "« * »");
          case "/": {
            const d = num(b, "« / »");
            if (d === 0) throw new FormulaError("Division par zéro.");
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
  if (typeof v === "number") return Number.isFinite(v) ? { kind: "number", value: Math.round(v * 1e9) / 1e9 } : { kind: "error", value: "Résultat infini." };
  if (typeof v === "string") return v === "" ? null : { kind: "text", value: v };
  if (typeof v === "boolean") return { kind: "boolean", value: v };
  if (Array.isArray(v)) return v.length ? { kind: "list", value: v.map(toText) } : null;
  const d = v.date;
  return { kind: "date", value: v.time ? d.toISOString() : isoDay(d) };
}
