import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  atLeast,
  VIEW_TYPES,
  type ViewType,
  COMPUTED_TYPES,
  FormulaError,
  computeCalc,
  evaluateFormula,
  formulaCalcInput,
  formulaReferences as formulaReferencesOf,
  makeDate,
  parseFormula,
  toFormulaResult,
  type FValue,
  type FormulaNode,
  type FormulaResult,
  valueSchema,
  type CalcFunction,
  type RelatedRow,
  type RollupValue,
  type CellValue,
  type DatabaseData,
  type DatabaseProperty,
  type DatabaseRow,
  type DatabaseViewInfo,
  type PageRole,
  type PropertyConfig,
  type PropertyType,
  type SelectOption,
} from "@nootion/shared";
import type { Db, DbLike } from "./db/index.js";
import { attachments, databaseProperties, databaseViews, pages, users } from "./db/schema.js";
import { HttpError } from "./http.js";
import { getPageRole } from "./permissions.js";
import type { PageMeta } from "./pages.js";
import { t } from "@nootion/shared";

export type PropertyRow = typeof databaseProperties.$inferSelect;

export function toProperty(p: PropertyRow): DatabaseProperty {
  return { id: p.id, name: p.name, type: p.type as PropertyType, config: p.config as PropertyConfig, position: p.position };
}

export function listProperties(db: DbLike, databaseId: string): DatabaseProperty[] {
  return db
    .select()
    .from(databaseProperties)
    .where(eq(databaseProperties.databaseId, databaseId))
    .all()
    .map(toProperty)
    .sort((a, b) => a.position - b.position);
}

export function listViews(db: DbLike, databaseId: string): DatabaseViewInfo[] {
  return db
    .select()
    .from(databaseViews)
    .where(eq(databaseViews.databaseId, databaseId))
    .all()
    .map((v) => ({ id: v.id, name: v.name, type: (VIEW_TYPES as readonly string[]).includes(v.type) ? (v.type as ViewType) : "table", config: v.config, position: v.position }))
    .sort((a, b) => a.position - b.position);
}

/** Creates the page holding the database, its title column and a first table view. */
export function createDatabase(db: Db, input: { workspaceId: string; parentId: string | null; title: string; position: number; userId: string }) {
  return db.transaction((tx) => {
    const id = randomUUID();
    tx.insert(pages)
      .values({ id, kind: "database", workspaceId: input.workspaceId, parentId: input.parentId, title: input.title, position: input.position, createdBy: input.userId })
      .run();
    tx.insert(databaseProperties).values({ id: randomUUID(), databaseId: id, name: t("database.defaultTitle"), type: "title", position: 0 }).run();
    tx.insert(databaseProperties).values({ id: randomUUID(), databaseId: id, name: t("database.defaultTags"), type: "multi_select", config: { options: [] }, position: 1 }).run();
    tx.insert(databaseViews).values({ id: randomUUID(), databaseId: id, name: t("view.defaultTable"), type: "table", position: 0 }).run();
    return id;
  });
}

type RowPage = Pick<typeof pages.$inferSelect, "id" | "title" | "icon" | "props" | "createdAt" | "updatedAt" | "createdBy" | "position">;

export function listRowPages(db: DbLike, databaseId: string): RowPage[] {
  return db
    .select({ id: pages.id, title: pages.title, icon: pages.icon, props: pages.props, createdAt: pages.createdAt, updatedAt: pages.updatedAt, createdBy: pages.createdBy, position: pages.position })
    .from(pages)
    .where(and(eq(pages.parentId, databaseId), eq(pages.kind, "row"), isNull(pages.deletedAt)))
    .all()
    .sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime());
}

export function toRow(r: RowPage, properties: DatabaseProperty[]): DatabaseRow {
  const stored = (r.props ?? {}) as Record<string, CellValue>;
  const values: Record<string, CellValue> = {};
  for (const p of properties) {
    switch (p.type) {
      case "title":
        values[p.id] = r.title;
        break;
      case "created_time":
        values[p.id] = r.createdAt.toISOString();
        break;
      case "last_edited_time":
        values[p.id] = r.updatedAt.toISOString();
        break;
      case "created_by":
        values[p.id] = r.createdBy ? [r.createdBy] : [];
        break;
      default:
        values[p.id] = stored[p.id] ?? null;
    }
  }
  return { id: r.id, title: r.title, icon: r.icon, values, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), createdBy: r.createdBy };
}

/** Names of the users referenced in person and "created by" cells. */
export function collectPeople(
  db: DbLike,
  properties: DatabaseProperty[],
  rows: DatabaseRow[],
  rollupTargets: Record<string, DatabaseProperty | null> = {},
): Record<string, string> {
  const personIds = new Set<string>();
  const isPeople = (t: PropertyType | undefined) => t === "person" || t === "created_by";
  for (const p of properties) {
    if (isPeople(p.type)) {
      for (const r of rows) for (const id of (r.values[p.id] as string[] | null) ?? []) personIds.add(id);
    } else if (p.type === "rollup" && isPeople(rollupTargets[p.id]?.type)) {
      for (const r of rows) {
        const v = r.values[p.id] as RollupValue | null;
        if (v?.kind === "list") for (const ids of v.values as string[][]) for (const id of ids) personIds.add(id);
      }
    }
  }
  const people: Record<string, string> = {};
  if (personIds.size) {
    for (const u of db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...personIds])).all()) people[u.id] = u.name;
  }
  return people;
}

/** Whether the reader may see the rows of a database (used for relations and rollups). */
export type CanRead = (databaseId: string) => boolean;

export function loadDatabase(db: Db, page: PageMeta, role: PageRole, canRead: CanRead): DatabaseData {
  const properties = listProperties(db, page.id);
  const rows = listRowPages(db, page.id).map((r) => toRow(r, properties));
  const { related, rollupTargets } = enrichRows(db, properties, rows, canRead);
  const people = collectPeople(db, properties, rows, rollupTargets);
  return { id: page.id, title: page.title, icon: page.icon, role, properties, views: listViews(db, page.id), rows, people, related, rollupTargets };
}

/**
 * Fills relation and rollup cells. Relations keep only live rows of databases the reader can see;
 * rollups follow a relation and compute a property of the related rows.
 */
export function enrichRows(db: DbLike, properties: DatabaseProperty[], rows: DatabaseRow[], canRead: CanRead) {
  const related: Record<string, RelatedRow> = {};
  const rollupTargets: Record<string, DatabaseProperty | null> = {};
  const targetCache = new Map<string, { properties: DatabaseProperty[]; rows: Map<string, DatabaseRow> } | null>();
  const target = (databaseId: string) => {
    if (!targetCache.has(databaseId)) {
      const isDatabase = db.select({ id: pages.id }).from(pages).where(and(eq(pages.id, databaseId), eq(pages.kind, "database"), isNull(pages.deletedAt))).get();
      if (!isDatabase || !canRead(databaseId)) targetCache.set(databaseId, null);
      else {
        const props = listProperties(db, databaseId);
        const targetRows = listRowPages(db, databaseId).map((r) => toRow(r, props));
        // Formulas of the related rows, so rollups can use them (without their own relations).
        computeFormulas(db, props, targetRows, {}, {});
        targetCache.set(databaseId, { properties: props, rows: new Map(targetRows.map((r) => [r.id, r])) });
      }
    }
    return targetCache.get(databaseId)!;
  };

  for (const prop of properties) {
    if (prop.type !== "relation") continue;
    const t = prop.config.databaseId ? target(prop.config.databaseId) : null;
    for (const row of rows) {
      const ids = (row.values[prop.id] as string[] | null) ?? [];
      const live = t ? ids.filter((id) => t.rows.has(id)) : [];
      row.values[prop.id] = live.length ? live : null;
      for (const id of live) {
        const r = t!.rows.get(id)!;
        related[id] = { title: r.title, icon: r.icon, databaseId: prop.config.databaseId! };
      }
    }
  }

  for (const prop of properties) {
    if (prop.type !== "rollup") continue;
    const relation = properties.find((p) => p.id === prop.config.relationPropertyId && p.type === "relation");
    const t = relation?.config.databaseId ? target(relation.config.databaseId) : null;
    const targetProp = t?.properties.find((p) => p.id === prop.config.targetPropertyId && p.type !== "rollup" && p.type !== "relation") ?? null;
    const fn = prop.config.rollupFunction as CalcFunction | "show_original" | undefined;
    rollupTargets[prop.id] = targetProp;
    for (const row of rows) {
      if (!relation || !t || !targetProp || !fn) {
        row.values[prop.id] = null;
        continue;
      }
      const values = ((row.values[relation.id] as string[] | null) ?? []).map((id) => t.rows.get(id)!.values[targetProp.id] ?? null);
      let value: RollupValue | null;
      if (fn === "show_original") {
        const shown = values.filter((v) => v !== null && !(Array.isArray(v) && v.length === 0));
        value = shown.length ? { kind: "list", values: shown } : null;
      } else if (targetProp.type === "formula") {
        const input = formulaCalcInput(values);
        value = computeCalc(fn, input.values, input.type);
      } else value = computeCalc(fn, values, targetProp.type);
      row.values[prop.id] = value;
    }
  }
  computeFormulas(db, properties, rows, related, rollupTargets);
  return { related, rollupTargets };
}

interface FormulaContext {
  related: Record<string, RelatedRow>;
  rollupTargets: Record<string, DatabaseProperty | null>;
  userName: (id: string) => string;
}

/** Value of a cell as formulas see it: numbers, texts, booleans, dates, lists. */
function toFormulaValue(prop: DatabaseProperty, value: CellValue, ctx: FormulaContext): FValue {
  if (value === null || value === undefined) return prop.type === "checkbox" ? false : null;
  switch (prop.type) {
    case "number":
    case "currency":
    case "percent":
      return value as number;
    case "checkbox":
      return value === true;
    case "date": {
      const d = value as { start: string; end?: string | null };
      return makeDate(d.start, d.end);
    }
    case "created_time":
    case "last_edited_time":
      return makeDate(value as string);
    case "select":
      return prop.config.options?.find((o) => o.id === value)?.name ?? null;
    case "multi_select":
      return (value as string[]).map((id) => prop.config.options?.find((o) => o.id === id)?.name ?? "").filter(Boolean);
    case "person":
    case "created_by":
      return (value as string[]).map(ctx.userName);
    case "file":
      return (value as { name: string }[]).map((f) => f.name);
    case "relation":
      return (value as string[]).map((id) => ctx.related[id]?.title ?? "");
    case "rollup": {
      const r = value as RollupValue;
      if (r.kind === "list") {
        const target = ctx.rollupTargets[prop.id];
        return target ? r.values.map((v) => toFormulaValue(target, v, ctx)) : [];
      }
      return r.kind === "date" ? makeDate(r.value) : r.value;
    }
    case "formula": {
      const f = value as FormulaResult;
      if (f.kind === "error") throw new FormulaError(t("formula.error.columnInError", { name: prop.name }));
      if (f.kind === "date") return makeDate(f.value);
      return f.value;
    }
    default:
      return String(value);
  }
}

/** A formula column that has no expression yet: its cells stay empty. */
class EmptyFormula extends Error {}

const parsedFormulas = new Map<string, FormulaNode | FormulaError>();
function parseCached(expression: string): FormulaNode {
  let parsed = parsedFormulas.get(expression);
  if (!parsed) {
    try {
      parsed = parseFormula(expression);
    } catch (e) {
      parsed = e instanceof FormulaError ? e : new FormulaError(String(e));
    }
    if (parsedFormulas.size > 1000) parsedFormulas.clear();
    parsedFormulas.set(expression, parsed);
  }
  if (parsed instanceof FormulaError) throw parsed;
  return parsed;
}

/** Fills formula cells. Formulas may read other formulas; loops are reported as errors. */
export function computeFormulas(
  db: DbLike,
  properties: DatabaseProperty[],
  rows: DatabaseRow[],
  related: Record<string, RelatedRow>,
  rollupTargets: Record<string, DatabaseProperty | null>,
) {
  const formulas = properties.filter((p) => p.type === "formula");
  if (!formulas.length) return;
  const byName = new Map(properties.map((p) => [p.name, p]));
  let names: Map<string, string> | null = null;
  const userName = (id: string) => {
    names ??= new Map(db.select({ id: users.id, name: users.name }).from(users).all().map((u) => [u.id, u.name]));
    return names.get(id) ?? "";
  };
  const ctx: FormulaContext = { related, rollupTargets, userName };

  for (const row of rows) {
    const done = new Map<string, FormulaResult | null>();
    const visiting = new Set<string>();
    const compute = (prop: DatabaseProperty): FormulaResult | null => {
      if (done.has(prop.id)) return done.get(prop.id)!;
      if (visiting.has(prop.id)) throw new FormulaError(t("formula.error.circular"));
      visiting.add(prop.id);
      let result: FormulaResult | null = null;
      try {
        if (!prop.config.expression?.trim()) throw new EmptyFormula();
        const node = parseCached(prop.config.expression ?? "");
        result = toFormulaResult(
          evaluateFormula(node, (name) => {
            const p = byName.get(name);
            if (!p) throw new FormulaError(t("formula.error.unknownColumn", { name }));
            if (p.type === "title") return row.title || null;
            if (p.type === "formula") {
              const r = compute(p);
              return r ? toFormulaValue(p, r, ctx) : null;
            }
            return toFormulaValue(p, row.values[p.id] ?? null, ctx);
          }),
        );
      } catch (e) {
        if (e instanceof FormulaError) result = { kind: "error", value: e.message };
        else if (!(e instanceof EmptyFormula)) throw e;
      }
      visiting.delete(prop.id);
      done.set(prop.id, result);
      return result;
    };
    for (const f of formulas) row.values[f.id] = compute(f);
  }
}

/** Checks a formula when it is saved: syntax, known columns, no loop through other formulas. */
export function checkFormula(properties: DatabaseProperty[], propId: string | null, expression: string) {
  let node: FormulaNode;
  try {
    node = parseFormula(expression);
  } catch (e) {
    if (e instanceof FormulaError) throw new HttpError(400, "bad_formula", e.message);
    throw e;
  }
  const byName = new Map(properties.map((p) => [p.name, p]));
  const seen = new Set<string>();
  const visit = (n: FormulaNode, path: string[]) => {
    for (const name of formulaReferencesOf(n)) {
      const p = byName.get(name);
      if (!p) throw new HttpError(400, "bad_formula", t("formula.error.unknownColumn", { name }));
      if (p.type !== "formula") continue;
      if (p.id === propId || path.includes(p.id)) {
        throw new HttpError(400, "bad_formula", t("formula.error.selfReference"));
      }
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      try {
        visit(parseFormula(p.config.expression ?? ""), [...path, p.id]);
      } catch (e) {
        if (!(e instanceof FormulaError)) throw e;
      }
    }
  };
  visit(node, propId ? [propId] : []);
}

/**
 * Checks values sent for a row and returns those to store. Throws 400 on anything invalid:
 * unknown or computed column, wrong type, unknown option, unknown person, file of another page.
 */
export function validateValues(db: DbLike, properties: DatabaseProperty[], rowId: string | null, input: Record<string, unknown>) {
  const byId = new Map(properties.map((p) => [p.id, p]));
  const out: Record<string, CellValue> = {};
  let title: string | undefined;
  for (const [propId, raw] of Object.entries(input)) {
    const prop = byId.get(propId);
    if (!prop) throw new HttpError(400, "unknown_property", t("error.unknownProperty"));
    if (COMPUTED_TYPES.includes(prop.type)) throw new HttpError(400, "computed_property", t("error.computedProperty", { name: prop.name }));
    const parsed = valueSchema(prop.type).safeParse(raw);
    if (!parsed.success) throw new HttpError(400, "invalid_value", t("error.invalidValue", { name: prop.name }));
    let value = parsed.data;
    if (typeof value === "string" && value === "" && prop.type !== "title") value = null;
    if (Array.isArray(value) && value.length === 0) value = null;

    if (prop.type === "title") {
      title = (value as string | null) ?? "";
      continue;
    }
    if (prop.type === "select" && value !== null && !(prop.config.options ?? []).some((o) => o.id === value)) {
      throw new HttpError(400, "unknown_option", t("error.unknownOption", { name: prop.name }));
    }
    if (prop.type === "multi_select" && value !== null) {
      const ids = new Set((prop.config.options ?? []).map((o) => o.id));
      if ((value as string[]).some((v) => !ids.has(v))) throw new HttpError(400, "unknown_option", t("error.unknownOption", { name: prop.name }));
      value = [...new Set(value as string[])];
    }
    if (prop.type === "person" && value !== null) {
      const ids = [...new Set(value as string[])];
      const found = db.select({ id: users.id }).from(users).where(inArray(users.id, ids)).all();
      if (found.length !== ids.length) throw new HttpError(400, "unknown_user", t("error.unknownPerson", { name: prop.name }));
      value = ids;
    }
    if (prop.type === "relation" && value !== null) {
      const ids = [...new Set(value as string[])];
      const found = prop.config.databaseId
        ? db
            .select({ id: pages.id })
            .from(pages)
            .where(and(inArray(pages.id, ids), eq(pages.parentId, prop.config.databaseId), eq(pages.kind, "row"), isNull(pages.deletedAt)))
            .all()
        : [];
      if (found.length !== ids.length) throw new HttpError(400, "unknown_row", t("error.unknownRow", { name: prop.name }));
      value = ids;
    }
    if (prop.type === "file" && value !== null) {
      const files = value as { id: string; name: string }[];
      const owned = rowId
        ? db
            .select({ id: attachments.id })
            .from(attachments)
            .where(and(eq(attachments.pageId, rowId), inArray(attachments.id, files.map((f) => f.id))))
            .all()
        : [];
      if (owned.length !== new Set(files.map((f) => f.id)).size) throw new HttpError(400, "unknown_file", t("error.unknownFile"));
    }
    out[propId] = value;
  }
  return { values: out, title };
}

// --- Changing a column's type -------------------------------------------------------------

export const TRUE_WORDS = new Set(["oui", "yes", "true", "vrai", "1", "x", "✓", "✔"]);

export function parseNumber(s: string): number | null {
  const cleaned = s.replace(/[\s €$£%]/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

export function parseDate(s: string): string | null {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const fr = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (fr) return `${fr[3]}-${fr[2].padStart(2, "0")}-${fr[1].padStart(2, "0")}`;
  return null;
}

/** Text shown for a value; used as the pivot when converting between types. */
export function valueToText(value: CellValue, prop: DatabaseProperty): string {
  if (value === null || value === undefined) return "";
  const opts = new Map((prop.config.options ?? []).map((o) => [o.id, o.name]));
  switch (prop.type) {
    case "select":
      return opts.get(value as string) ?? "";
    case "multi_select":
      return (value as string[]).map((v) => opts.get(v) ?? "").filter(Boolean).join(", ");
    case "date": {
      const d = value as { start: string; end?: string | null };
      return d.end ? `${d.start} → ${d.end}` : d.start;
    }
    case "checkbox":
      return value ? t("common.yes") : "";
    case "file":
      return (value as { name: string }[]).map((f) => f.name).join(", ");
    case "person":
      return "";
    default:
      return String(value);
  }
}

/**
 * Converts every row's value when a column changes type, the way a spreadsheet would:
 * through the displayed text. Text becoming a select creates one option per distinct value.
 */
export function convertColumn(rowValues: CellValue[], from: DatabaseProperty, toType: PropertyType, toConfig: PropertyConfig) {
  const texts = rowValues.map((v) => valueToText(v, from));
  const config: PropertyConfig = { ...toConfig };
  if (toType === "select" || toType === "multi_select") {
    const options: SelectOption[] = [...(config.options ?? [])];
    // Keep option ids when going select <-> multi_select.
    if ((from.type === "select" || from.type === "multi_select") && !config.options) options.push(...(from.config.options ?? []));
    const byName = new Map(options.map((o) => [o.name.toLowerCase(), o]));
    const colors = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;
    const ensure = (name: string) => {
      const key = name.toLowerCase();
      let o = byName.get(key);
      if (!o) {
        o = { id: randomUUID().slice(0, 8), name: name.slice(0, 100), color: colors[options.length % colors.length] };
        options.push(o);
        byName.set(key, o);
      }
      return o.id;
    };
    const values = texts.map((t) => {
      const parts = (toType === "multi_select" ? t.split(",") : [t]).map((p) => p.trim()).filter(Boolean);
      if (!parts.length) return null;
      return toType === "select" ? ensure(parts[0]) : [...new Set(parts.map(ensure))];
    });
    config.options = options;
    return { values: values as CellValue[], config };
  }
  const values = texts.map((t, i): CellValue => {
    if (!t) return null;
    switch (toType) {
      case "text":
      case "url":
      case "email":
        return t;
      case "number":
      case "currency":
      case "percent":
        return typeof rowValues[i] === "number" ? (rowValues[i] as number) : parseNumber(t);
      case "checkbox":
        return TRUE_WORDS.has(t.trim().toLowerCase()) || rowValues[i] === true;
      case "date": {
        const d = parseDate(t);
        return d ? { start: d, end: null } : null;
      }
      default:
        return null;
    }
  });
  return { values, config };
}

export function defaultConfig(type: PropertyType): PropertyConfig {
  switch (type) {
    case "select":
    case "multi_select":
      return { options: [] };
    case "currency":
      return { currency: "EUR", decimals: 2 };
    case "percent":
      return { decimals: 0 };
    default:
      return {};
  }
}

/**
 * Keeps a two-way relation consistent: rows added to (or removed from) a relation cell get this row
 * added to (or removed from) the matching cell on their side.
 */
export function syncTwin(db: DbLike, prop: DatabaseProperty, rowId: string, before: string[], after: string[]) {
  const twin = prop.config.twinPropertyId;
  if (!twin) return;
  const added = after.filter((id) => !before.includes(id));
  const removed = before.filter((id) => !after.includes(id));
  for (const id of [...added, ...removed]) {
    const r = db.select({ props: pages.props }).from(pages).where(eq(pages.id, id)).get();
    if (!r) continue;
    const props = { ...(r.props ?? {}) } as Record<string, CellValue>;
    const current = (props[twin] as string[] | null) ?? [];
    const next = added.includes(id) ? [...new Set([...current, rowId])] : current.filter((x) => x !== rowId);
    if (next.length) props[twin] = next;
    else delete props[twin];
    db.update(pages).set({ props, updatedAt: new Date() }).where(eq(pages.id, id)).run();
  }
}

/** Relations and rollups only read databases the user can see. */
export const canReadAs =
  (db: Db, userId: string): CanRead =>
  (databaseId) =>
    atLeast(getPageRole(db, userId, databaseId), "viewer");
