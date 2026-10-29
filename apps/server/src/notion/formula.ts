/**
 * Translates a Notion formula (versions 1 and 2) into Nootion's formula language.
 * Method calls such as prop("Name").length() become length(prop("Name")); function names that differ are renamed.
 * Throws when the formula uses something Nootion doesn't have (lists, let, map…): the importer then keeps its values.
 */

type Node =
  | { k: "num"; v: string }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "prop"; name: string }
  | { k: "call"; name: string; args: Node[] }
  | { k: "unary"; op: string; arg: Node }
  | { k: "binary"; op: string; left: Node; right: Node }
  | { k: "cond"; test: Node; then: Node; else: Node };

type Tok = { t: "num" | "str" | "id" | "op"; v: string } | { t: "end"; v: "" };

export class FormulaTranslationError extends Error {}

const OPS = ["==", "!=", ">=", "<=", "&&", "||", "+", "-", "*", "/", "%", "^", ">", "<", "!", "(", ")", ",", "?", ":", ".", "[", "]"];

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i))!;
      out.push({ t: "num", v: m[0] });
      i += m[0].length;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let v = "";
      while (j < src.length && src[j] !== '"') {
        if (src[j] === "\\" && j + 1 < src.length) {
          const n = src[j + 1]!;
          v += n === "n" ? "\n" : n === "t" ? "\t" : n;
          j += 2;
        } else v += src[j++];
      }
      if (j >= src.length) throw new FormulaTranslationError("unclosed text");
      out.push({ t: "str", v });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ t: "id", v: m[0] });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new FormulaTranslationError(`unexpected "${c}"`);
    out.push({ t: "op", v: op });
    i += op.length;
  }
  out.push({ t: "end", v: "" });
  return out;
}

function parse(src: string): Node {
  const toks = tokenize(src);
  let pos = 0;
  const peek = () => toks[pos]!;
  const isOp = (v: string) => peek().t === "op" && peek().v === v;
  const isWord = (v: string) => peek().t === "id" && peek().v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new FormulaTranslationError(`expected "${v}"`);
    pos++;
  };
  const args = (): Node[] => {
    expect("(");
    const list: Node[] = [];
    if (!isOp(")")) {
      do list.push(ternary());
      while (isOp(",") && ++pos);
    }
    expect(")");
    return list;
  };

  const ternary = (): Node => {
    const test = or();
    if (!isOp("?")) return test;
    pos++;
    const then = ternary();
    expect(":");
    return { k: "cond", test, then, else: ternary() };
  };
  const level = (next: () => Node, ops: Record<string, string>) => (): Node => {
    let left = next();
    for (;;) {
      const tok = peek();
      const op = (tok.t === "op" || tok.t === "id") && Object.hasOwn(ops, tok.v) ? ops[tok.v]! : null;
      if (!op) return left;
      pos++;
      left = { k: "binary", op, left, right: next() };
    }
  };
  const unary = (): Node => {
    if (isOp("-") || isOp("!") || isWord("not")) {
      const op = peek().v === "-" ? "-" : "!";
      pos++;
      return { k: "unary", op, arg: unary() };
    }
    if (isOp("+")) {
      pos++;
      return unary();
    }
    return power();
  };
  const power = (): Node => {
    const base = postfix();
    if (!isOp("^")) return base;
    pos++;
    return { k: "binary", op: "^", left: base, right: unary() };
  };
  const postfix = (): Node => {
    let node = primary();
    // Notion 2's method calls: x.length(), x.format(), prop("Date").dateAdd(1, "days")
    while (isOp(".")) {
      pos++;
      const name = peek();
      if (name.t !== "id") throw new FormulaTranslationError("expected a function after '.'");
      pos++;
      node = call(name.v, [node, ...(isOp("(") ? args() : [])]);
    }
    return node;
  };
  const primary = (): Node => {
    const tok = peek();
    if (tok.t === "num") return (pos++, { k: "num", v: tok.v });
    if (tok.t === "str") return (pos++, { k: "str", v: tok.v });
    if (isOp("(")) {
      pos++;
      const inner = ternary();
      expect(")");
      return inner;
    }
    if (isOp("[")) throw new FormulaTranslationError("lists");
    if (tok.t === "id") {
      pos++;
      if (tok.v === "true" || tok.v === "false") return { k: "bool", v: tok.v === "true" };
      if (tok.v === "e" && !isOp("(")) return { k: "num", v: String(Math.E) };
      if (tok.v === "pi" && !isOp("(")) return { k: "num", v: String(Math.PI) };
      if (!isOp("(")) throw new FormulaTranslationError(`unknown name "${tok.v}"`);
      const list = args();
      if (tok.v === "prop") {
        if (list.length !== 1 || list[0]!.k !== "str") throw new FormulaTranslationError("prop() needs a column name");
        return { k: "prop", name: list[0]!.v };
      }
      return call(tok.v, list);
    }
    throw new FormulaTranslationError("unexpected end");
  };
  const multiplicative = level(unary, { "*": "*", "/": "/", "%": "%" });
  const additive = level(multiplicative, { "+": "+", "-": "-" });
  const comparison = level(additive, { ">": ">", "<": "<", ">=": ">=", "<=": "<=" });
  const equality = level(comparison, { "==": "==", "!=": "!=" });
  const and = level(equality, { and: "&&", "&&": "&&" });
  const or = level(and, { or: "||", "||": "||" });

  const node = ternary();
  if (peek().t !== "end") throw new FormulaTranslationError(`unexpected "${peek().v}"`);
  return node;
}

// Notion functions written differently in Nootion.
const RENAMED: Record<string, string> = { mean: "average", substring: "slice" };
// Notion 1's operator functions.
const OPERATOR_FUNCTIONS: Record<string, string> = {
  add: "+",
  subtract: "-",
  multiply: "*",
  divide: "/",
  mod: "%",
  pow: "^",
  equal: "==",
  unequal: "!=",
  larger: ">",
  largerEq: ">=",
  smaller: "<",
  smallerEq: "<=",
};
// Functions Nootion doesn't have.
const UNSUPPORTED = new Set([
  "let",
  "lets",
  "map",
  "filter",
  "find",
  "findIndex",
  "some",
  "every",
  "sort",
  "reverse",
  "unique",
  "flat",
  "at",
  "first",
  "last",
  "split",
  "match",
  "test",
  "id",
  "link",
  "week",
  "fromTimestamp",
  "includes",
  "repeat",
  "padStart",
  "padEnd",
  "sign",
  "cbrt",
  "exp",
  "ln",
  "log10",
  "log2",
]);

function call(name: string, args: Node[]): Node {
  if (UNSUPPORTED.has(name)) throw new FormulaTranslationError(`${name}()`);
  if (name === "style" || name === "unstyle") {
    if (!args[0]) throw new FormulaTranslationError(`${name}()`);
    return args[0];
  }
  if (name === "unaryMinus" && args.length === 1) return { k: "unary", op: "-", arg: args[0]! };
  if (name === "unaryPlus" && args.length === 1) return args[0]!;
  if (name === "not" && args.length === 1) return { k: "unary", op: "!", arg: args[0]! };
  const op = OPERATOR_FUNCTIONS[name];
  if (op && args.length === 2) return { k: "binary", op, left: args[0]!, right: args[1]! };
  return { k: "call", name: RENAMED[name] ?? name, args };
}

const quote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;

function print(n: Node): string {
  switch (n.k) {
    case "num":
      return n.v;
    case "str":
      return quote(n.v);
    case "bool":
      return String(n.v);
    case "prop":
      return `prop(${quote(n.name)})`;
    case "call":
      return `${n.name}(${n.args.map(print).join(", ")})`;
    case "unary":
      return `${n.op}${wrap(n.arg)}`;
    case "binary":
      return `${wrap(n.left)} ${n.op} ${wrap(n.right)}`;
    case "cond":
      return `${wrap(n.test)} ? ${wrap(n.then)} : ${wrap(n.else)}`;
  }
}
const wrap = (n: Node) => (n.k === "binary" || n.k === "cond" ? `(${print(n)})` : print(n));

/**
 * Nootion's version of a Notion formula. `propertyName` resolves the references of Notion's API
 * ({{notion:block_property:ID:…}}) to column names.
 */
export function translateFormula(expression: string, propertyName: (notionPropertyId: string) => string | undefined): string {
  const resolved = expression.replace(/\{\{notion:block_property:([^:}]+)(:[^}]*)?\}\}/g, (_, id: string) => {
    const name = propertyName(decodeURIComponent(id));
    if (name === undefined) throw new FormulaTranslationError("unknown column");
    return `prop(${quote(name)})`;
  });
  return print(parse(resolved));
}
