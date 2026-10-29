import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { OPTION_COLORS, type CellValue, type DatabaseProperty, type PropertyConfig, type PropertyType, type SelectOption } from "@nootion/shared";
import { parseDate, parseNumber, TRUE_WORDS } from "./databases.js";
import type { DbLike } from "./db/index.js";
import { pages, users } from "./db/schema.js";

export const IMPORT_MAX_ROWS = 5000;

const BOOLEAN_WORDS = new Set(["oui", "non", "yes", "no", "true", "false", "vrai", "faux", "✓", "✔"]);

/** Parses CSV (RFC 4180), guessing the separator (",", ";" from French spreadsheets, or tab). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const count = (c: string) => firstLine.split(c).length;
  const sep = [",", ";", "\t"].reduce((best, c) => (count(c) > count(best) ? c : best), ",");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') ((field += '"'), i++);
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === sep) (row.push(field), (field = ""));
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      ((row = []), (field = ""));
    } else field += c;
  }
  if (field !== "" || row.length) (row.push(field), rows.push(row));
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

const IMPORTABLE = new Set([
  "title",
  "text",
  "number",
  "currency",
  "percent",
  "date",
  "select",
  "multi_select",
  "checkbox",
  "url",
  "email",
  "person",
  "relation",
]);

export interface ImportPlan {
  /** Columns to create (as text), by header index. */
  /** Columns to create, by header index, typed after their values (number, amount, date, checkbox or text). */
  newColumns: { index: number; name: string; type: PropertyType; config: PropertyConfig }[];
  ignored: string[];
  /** Options added to select columns, by property id. */
  options: Map<string, SelectOption[]>;
  rows: { title: string; values: Record<string, CellValue> }[];
}

/**
 * Turns CSV rows into row values for a database. Columns are matched by name; when no column has the
 * title column's name, the first one is the title. Unknown options are created; people and related
 * rows are found by name (unknown ones are left out).
 */
export function planImport(
  db: DbLike,
  properties: DatabaseProperty[],
  csv: string[][],
  /** canLink: whether the user may fill a relation column (sees the other database, may edit it for two-way links). */
  opts: { createColumns: boolean; canLink: (prop: DatabaseProperty) => boolean },
): ImportPlan {
  const [header = [], ...lines] = csv;
  const byName = new Map(properties.map((p) => [p.name.trim().toLowerCase(), p]));
  const title = properties.find((p) => p.type === "title")!;
  const titleIndex = header.findIndex((h) => h.trim().toLowerCase() === title.name.trim().toLowerCase());
  const plan: ImportPlan = { newColumns: [], ignored: [], options: new Map(), rows: [] };

  const targets: (DatabaseProperty | "new" | null)[] = header.map((h, i) => {
    if (i === (titleIndex >= 0 ? titleIndex : 0)) return title;
    const name = h.trim();
    const prop = byName.get(name.toLowerCase());
    if (prop && prop.type !== "title") {
      if (IMPORTABLE.has(prop.type)) return prop;
      plan.ignored.push(prop.name);
      return null;
    }
    if (!name || !opts.createColumns || byName.has(name.toLowerCase())) {
      if (name) plan.ignored.push(name);
      return null;
    }
    plan.newColumns.push({ index: i, name: name.slice(0, 100), type: "text", config: {} });
    byName.set(name.toLowerCase(), title); // a second column with the same name is ignored
    return "new";
  });

  // People and related rows, found by name.
  let people: Map<string, string> | null = null;
  const personId = (name: string) => {
    people ??= new Map(
      db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .all()
        .flatMap((u) => [
          [u.name.toLowerCase(), u.id],
          [u.email.toLowerCase(), u.id],
        ]),
    );
    return people.get(name.toLowerCase());
  };
  const relatedRows = new Map<string, Map<string, string>>();
  const relatedId = (prop: DatabaseProperty, name: string) => {
    const dbId = prop.config.databaseId;
    if (!dbId || !opts.canLink(prop)) return undefined;
    let map = relatedRows.get(dbId);
    if (!map) {
      const rows = db
        .select({ id: pages.id, title: pages.title })
        .from(pages)
        .where(and(eq(pages.parentId, dbId), eq(pages.kind, "row"), isNull(pages.deletedAt)))
        .all();
      relatedRows.set(dbId, (map = new Map(rows.reverse().map((r) => [r.title.trim().toLowerCase(), r.id]))));
    }
    return map.get(name.toLowerCase());
  };
  const option = (prop: DatabaseProperty, name: string) => {
    let list = plan.options.get(prop.id);
    if (!list) plan.options.set(prop.id, (list = [...(prop.config.options ?? [])]));
    let o = list.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!o) list.push((o = { id: randomUUID().slice(0, 8), name: name.slice(0, 100), color: OPTION_COLORS[list.length % OPTION_COLORS.length]! }));
    return o.id;
  };
  const split = (s: string) => [
    ...new Set(
      s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ];

  for (const line of lines.slice(0, IMPORT_MAX_ROWS)) {
    const values: Record<string, CellValue> = {};
    let rowTitle = "";
    header.forEach((_, i) => {
      const target = targets[i];
      const raw = (line[i] ?? "").trim();
      if (!target || !raw) return;
      if (target === "new") {
        values[`new:${i}`] = raw.slice(0, 20000);
        return;
      }
      const value = convert(target, raw);
      if (target.type === "title") rowTitle = String(value ?? "");
      else if (value !== null) values[target.id] = value;
    });
    plan.rows.push({ title: rowTitle, values });
  }
  // New columns take the type their values share.
  for (const c of plan.newColumns) {
    const key = `new:${c.index}`;
    const raws = plan.rows.map((r) => r.values[key] as string | undefined).filter((v): v is string => !!v);
    const every = (test: (v: string) => boolean) => raws.length > 0 && raws.every(test);
    if (every((v) => parseNumber(v) !== null)) {
      Object.assign(
        c,
        raws.some((v) => /[€$£]/.test(v))
          ? {
              type: "currency",
              config: { currency: raws.some((v) => v.includes("$")) ? "USD" : raws.some((v) => v.includes("£")) ? "GBP" : "EUR", decimals: 2 },
            }
          : { type: "number" },
      );
    } else if (every((v) => BOOLEAN_WORDS.has(v.toLowerCase()))) c.type = "checkbox";
    else if (every((v) => !!parseDate(v.split(/\s*(?:→|->)\s*/)[0]!))) c.type = "date";
    if (c.type === "text") continue;
    const prop = { id: key, name: c.name, type: c.type, config: c.config, position: 0 } as DatabaseProperty;
    for (const row of plan.rows) {
      const raw = row.values[key] as string | undefined;
      if (raw) row.values[key] = convert(prop, raw);
    }
  }
  return plan;

  function convert(prop: DatabaseProperty, raw: string): CellValue {
    switch (prop.type) {
      case "title":
        return raw.slice(0, 500);
      case "text":
      case "url":
      case "email":
        return raw.slice(0, prop.type === "text" ? 20000 : 2000);
      case "number":
      case "currency":
      case "percent":
        return parseNumber(raw);
      case "checkbox":
        return TRUE_WORDS.has(raw.toLowerCase());
      case "date": {
        const [start, end] = raw.split(/\s*(?:→|->)\s*/).map(parseDate);
        return start ? { start, end: end ?? null } : null;
      }
      case "select":
        return option(prop, raw);
      case "multi_select":
        return split(raw).map((n) => option(prop, n));
      case "person": {
        const ids = split(raw)
          .map(personId)
          .filter((x): x is string => !!x);
        return ids.length ? ids : null;
      }
      case "relation": {
        const ids = split(raw)
          .map((n) => relatedId(prop, n))
          .filter((x): x is string => !!x);
        return ids.length ? ids : null;
      }
      default:
        return null;
    }
  }
}
