import { z } from "zod";
import type {
  CellValue,
  DatabaseProperty,
  DatabaseRow,
  DateValue,
  FileValue,
  PropertyType,
  RelatedRow,
  RollupValue,
  SelectOption,
} from "./databases.js";
import type { FormulaResult } from "./formula.js";

/** Filters, sorts and groups of database views. Applied in the browser, on rows the reader can already see. */

export const VIEW_TYPES = ["table", "board"] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

export const FILTER_OPERATORS = [
  "contains",
  "not_contains",
  "is",
  "is_not",
  "starts_with",
  "ends_with",
  "eq",
  "neq",
  "gt",
  "lt",
  "gte",
  "lte",
  "before",
  "after",
  "on_or_before",
  "on_or_after",
  "within",
  "checked",
  "unchecked",
  "is_empty",
  "is_not_empty",
] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

/** Relative dates a date filter can compare to (or an exact YYYY-MM-DD date). */
export const RELATIVE_DATES = ["today", "tomorrow", "yesterday", "one_week_ago", "one_week_from_now", "one_month_ago", "one_month_from_now"] as const;
/** Periods of the "within" date operator. */
export const DATE_PERIODS = ["past_week", "past_month", "past_year", "next_week", "next_month", "next_year"] as const;

export interface ViewFilter {
  propertyId: string;
  operator: FilterOperator;
  /** Text, number, option id, user id ("me" for the reader), date or period. */
  value?: string | number | null;
}

export interface ViewSort {
  propertyId: string;
  direction: "asc" | "desc";
}

export const viewFilterSchema = z.object({
  propertyId: z.string().min(1).max(64),
  operator: z.enum(FILTER_OPERATORS),
  value: z
    .union([z.string().max(500), z.number().finite()])
    .nullable()
    .optional(),
});
export const viewSortSchema = z.object({ propertyId: z.string().min(1).max(64), direction: z.enum(["asc", "desc"]) });

/** How a column behaves in filters and sorts. */
export type FilterKind = "text" | "number" | "date" | "checkbox" | "select" | "multi_select" | "people" | "list";

export const FILTER_OPERATORS_BY_KIND: Record<FilterKind, FilterOperator[]> = {
  text: ["contains", "not_contains", "is", "is_not", "starts_with", "ends_with", "is_empty", "is_not_empty"],
  number: ["eq", "neq", "gt", "lt", "gte", "lte", "is_empty", "is_not_empty"],
  date: ["is", "before", "after", "on_or_before", "on_or_after", "within", "is_empty", "is_not_empty"],
  checkbox: ["checked", "unchecked"],
  select: ["is", "is_not", "is_empty", "is_not_empty"],
  multi_select: ["contains", "not_contains", "is_empty", "is_not_empty"],
  people: ["contains", "not_contains", "is_empty", "is_not_empty"],
  list: ["contains", "not_contains", "is_empty", "is_not_empty"],
};

/** Operators that need no value. */
export const VALUELESS_OPERATORS: readonly FilterOperator[] = ["checked", "unchecked", "is_empty", "is_not_empty"];

/** What filters, sorts and groups read besides the rows. */
export interface ViewContext {
  properties: DatabaseProperty[];
  rows: DatabaseRow[];
  people: Record<string, string>;
  related: Record<string, RelatedRow>;
  rollupTargets: Record<string, DatabaseProperty | null>;
  /** The reader, for "me" in person filters. */
  me?: string | null;
}

const TEXT_TYPES: readonly PropertyType[] = ["title", "text", "url", "email"];
const NUMBER_TYPES: readonly PropertyType[] = ["number", "currency", "percent"];
const DATE_TYPES: readonly PropertyType[] = ["date", "created_time", "last_edited_time"];

export function filterKind(prop: DatabaseProperty, ctx: Pick<ViewContext, "rows">): FilterKind {
  const t = prop.type;
  if (TEXT_TYPES.includes(t)) return "text";
  if (NUMBER_TYPES.includes(t)) return "number";
  if (DATE_TYPES.includes(t)) return "date";
  if (t === "checkbox" || t === "select" || t === "multi_select") return t;
  if (t === "person" || t === "created_by") return "people";
  if (t === "relation" || t === "file") return "list";
  if (t === "rollup" || t === "formula") {
    // Computed columns take the type of what they produce.
    for (const row of ctx.rows) {
      const v = row.values[prop.id] as RollupValue | FormulaResult | null | undefined;
      if (!v || v.kind === "error") continue;
      if (v.kind === "list" || v.kind === "text") return "text";
      if (v.kind === "date") return "date";
      if (v.kind === "boolean") return "checkbox";
      return "number";
    }
    return "text";
  }
  return "text";
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const pad = (n: number) => String(n).padStart(2, "0");
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Day (YYYY-MM-DD, local time) of a stored date or timestamp. */
function dayOf(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : localDay(d);
}

function shiftDay(days: number, months = 0, years = 0, now = new Date()): string {
  const d = new Date(now.getFullYear() + years, now.getMonth() + months, now.getDate() + days);
  return localDay(d);
}

function resolveDate(value: string, now: Date): string {
  switch (value) {
    case "today":
      return shiftDay(0, 0, 0, now);
    case "tomorrow":
      return shiftDay(1, 0, 0, now);
    case "yesterday":
      return shiftDay(-1, 0, 0, now);
    case "one_week_ago":
      return shiftDay(-7, 0, 0, now);
    case "one_week_from_now":
      return shiftDay(7, 0, 0, now);
    case "one_month_ago":
      return shiftDay(0, -1, 0, now);
    case "one_month_from_now":
      return shiftDay(0, 1, 0, now);
    default:
      return dayOf(value);
  }
}

function periodBounds(period: string, now: Date): [string, string] | null {
  const today = shiftDay(0, 0, 0, now);
  switch (period) {
    case "past_week":
      return [shiftDay(-7, 0, 0, now), today];
    case "past_month":
      return [shiftDay(0, -1, 0, now), today];
    case "past_year":
      return [shiftDay(0, 0, -1, now), today];
    case "next_week":
      return [today, shiftDay(7, 0, 0, now)];
    case "next_month":
      return [today, shiftDay(0, 1, 0, now)];
    case "next_year":
      return [today, shiftDay(0, 0, 1, now)];
    default:
      return null;
  }
}

/** Plain text of a cell, for text filters, text sorts and groups. */
export function cellText(prop: DatabaseProperty, value: CellValue, ctx: Omit<ViewContext, "rows" | "me">): string {
  if (value === null || value === undefined) return "";
  switch (prop.type) {
    case "select":
      return prop.config.options?.find((o) => o.id === value)?.name ?? "";
    case "multi_select":
      return (value as string[])
        .map((id) => prop.config.options?.find((o) => o.id === id)?.name ?? "")
        .filter(Boolean)
        .join(", ");
    case "person":
    case "created_by":
      return (value as string[])
        .map((id) => ctx.people[id] ?? "")
        .filter(Boolean)
        .join(", ");
    case "relation":
      return (value as string[])
        .map((id) => ctx.related[id]?.title ?? "")
        .filter(Boolean)
        .join(", ");
    case "file":
      return (value as FileValue[]).map((f) => f.name).join(", ");
    case "date":
      return (value as DateValue).start;
    case "checkbox":
      return value ? "true" : "";
    case "rollup": {
      const r = value as RollupValue;
      if (r.kind !== "list") return String(r.value);
      const target = ctx.rollupTargets[prop.id];
      return target
        ? r.values
            .map((v) => cellText(target, v, ctx))
            .filter(Boolean)
            .join(", ")
        : "";
    }
    case "formula": {
      const f = value as FormulaResult;
      if (f.kind === "error") return "";
      if (f.kind === "list") return f.value.join(", ");
      if (f.kind === "boolean") return f.value ? "true" : "";
      return String(f.value);
    }
    default:
      return String(value);
  }
}

function rawValue(prop: DatabaseProperty, row: DatabaseRow): CellValue {
  return prop.type === "title" ? row.title : (row.values[prop.id] ?? null);
}

/** Value of a cell as filters and sorts compare it, for the column's kind. */
function comparable(prop: DatabaseProperty, kind: FilterKind, row: DatabaseRow, ctx: ViewContext): string | number | boolean | string[] | null {
  const v = rawValue(prop, row);
  if (v === null || v === undefined) return kind === "checkbox" ? false : null;
  const computed = prop.type === "rollup" || prop.type === "formula" ? (v as RollupValue | FormulaResult) : null;
  switch (kind) {
    case "number":
      if (computed) return computed.kind !== "list" && computed.kind !== "error" && typeof computed.value === "number" ? computed.value : null;
      return typeof v === "number" ? v : null;
    case "date": {
      if (computed) return computed.kind === "date" ? dayOf(computed.value) : null;
      if (typeof v === "string") return dayOf(v);
      return dayOf((v as DateValue).start);
    }
    case "checkbox":
      if (computed) return computed.kind === "boolean" ? computed.value : false;
      return v === true;
    case "select":
      return typeof v === "string" ? v : null;
    case "multi_select":
    case "people":
      return Array.isArray(v) && v.length ? (v as string[]) : null;
    case "list": {
      const texts = prop.type === "relation" ? (v as string[]).map((id) => ctx.related[id]?.title ?? "") : (v as FileValue[]).map((f) => f.name);
      return texts.length ? texts : null;
    }
    default: {
      const s = cellText(prop, v, ctx);
      return s === "" ? null : s;
    }
  }
}

/** Whether a filter can be applied (the column exists, the operator fits it, a value is set when needed). */
export function isActiveFilter(f: ViewFilter, ctx: Pick<ViewContext, "properties" | "rows">): boolean {
  const prop = ctx.properties.find((p) => p.id === f.propertyId);
  if (!prop || !FILTER_OPERATORS_BY_KIND[filterKind(prop, ctx)].includes(f.operator)) return false;
  return VALUELESS_OPERATORS.includes(f.operator) || (f.value !== null && f.value !== undefined && f.value !== "");
}

export function matchesFilter(row: DatabaseRow, f: ViewFilter, ctx: ViewContext, now = new Date()): boolean {
  const prop = ctx.properties.find((p) => p.id === f.propertyId)!;
  const kind = filterKind(prop, ctx);
  const v = comparable(prop, kind, row, ctx);
  const empty = v === null || v === false;
  if (f.operator === "is_empty") return kind === "checkbox" ? v === false : empty;
  if (f.operator === "is_not_empty") return kind === "checkbox" ? v === true : !empty;
  if (f.operator === "checked") return v === true;
  if (f.operator === "unchecked") return v !== true;
  const target = f.value!;

  switch (kind) {
    case "text": {
      const s = norm(typeof v === "string" ? v : "");
      const t = norm(String(target));
      switch (f.operator) {
        case "contains":
          return s.includes(t);
        case "not_contains":
          return !s.includes(t);
        case "is":
          return s === t;
        case "is_not":
          return s !== t;
        case "starts_with":
          return s.startsWith(t);
        case "ends_with":
          return s.endsWith(t);
      }
      return true;
    }
    case "number": {
      const n = Number(target);
      if (typeof v !== "number") return f.operator === "neq";
      switch (f.operator) {
        case "eq":
          return v === n;
        case "neq":
          return v !== n;
        case "gt":
          return v > n;
        case "lt":
          return v < n;
        case "gte":
          return v >= n;
        case "lte":
          return v <= n;
      }
      return true;
    }
    case "date": {
      if (typeof v !== "string") return false;
      if (f.operator === "within") {
        const b = periodBounds(String(target), now);
        return !!b && v >= b[0] && v <= b[1];
      }
      const day = resolveDate(String(target), now);
      switch (f.operator) {
        case "is":
          return v === day;
        case "before":
          return v < day;
        case "after":
          return v > day;
        case "on_or_before":
          return v <= day;
        case "on_or_after":
          return v >= day;
      }
      return true;
    }
    case "select":
      return f.operator === "is" ? v === target : v !== target;
    case "multi_select":
    case "people": {
      const id = target === "me" ? ctx.me : String(target);
      const has = Array.isArray(v) && !!id && v.includes(id);
      return f.operator === "contains" ? has : !has;
    }
    case "list": {
      const t = norm(String(target));
      const has = Array.isArray(v) && v.some((s) => norm(s).includes(t));
      return f.operator === "contains" ? has : !has;
    }
  }
  return true;
}

const collator = new Intl.Collator("fr", { numeric: true, sensitivity: "base" });

function sortKey(prop: DatabaseProperty, kind: FilterKind, row: DatabaseRow, ctx: ViewContext): string | number | null {
  const v = comparable(prop, kind, row, ctx);
  if (v === null) return null;
  switch (kind) {
    case "checkbox":
      return v ? 1 : 0;
    case "select": {
      // Options sort in the order they were arranged, like Notion.
      const i = prop.config.options?.findIndex((o) => o.id === v) ?? -1;
      return i < 0 ? null : i;
    }
    case "multi_select": {
      const i = prop.config.options?.findIndex((o) => o.id === (v as string[])[0]) ?? -1;
      return i < 0 ? null : i;
    }
    case "people":
      return (v as string[]).map((id) => ctx.people[id] ?? "").join(", ");
    case "list":
      return (v as string[]).join(", ");
    default:
      return v as string | number;
  }
}

/** Rows of a view: filtered, then sorted (empty values last). */
export function applyView(
  ctx: ViewContext,
  config: { filters?: ViewFilter[]; filterMode?: "and" | "or"; sorts?: ViewSort[] },
  now = new Date(),
): DatabaseRow[] {
  const filters = (config.filters ?? []).filter((f) => isActiveFilter(f, ctx));
  let rows = ctx.rows;
  if (filters.length) {
    const any = config.filterMode === "or";
    rows = rows.filter((r) => (any ? filters.some((f) => matchesFilter(r, f, ctx, now)) : filters.every((f) => matchesFilter(r, f, ctx, now))));
  }
  const sorts = (config.sorts ?? [])
    .map((s) => ({ s, prop: ctx.properties.find((p) => p.id === s.propertyId) }))
    .filter((x): x is { s: ViewSort; prop: DatabaseProperty } => !!x.prop);
  if (!sorts.length) return rows;
  const keyed = rows.map((row) => ({ row, keys: sorts.map(({ prop }) => sortKey(prop, filterKind(prop, ctx), row, ctx)) }));
  keyed.sort((a, b) => {
    for (let i = 0; i < sorts.length; i++) {
      const x = a.keys[i]!;
      const y = b.keys[i]!;
      if (x === y) continue;
      if (x === null) return 1;
      if (y === null) return -1;
      const c = typeof x === "number" && typeof y === "number" ? x - y : collator.compare(String(x), String(y));
      if (c) return sorts[i]!.s.direction === "desc" ? -c : c;
    }
    return 0;
  });
  return keyed.map((k) => k.row);
}

/** Types a view can be grouped by. */
export function canGroupBy(type: PropertyType): boolean {
  return type !== "title" && type !== "file";
}

/** Types whose groups can receive rows (board drag and drop, "new" in a group). */
export function canMoveBetweenGroups(type: PropertyType): boolean {
  return ["select", "multi_select", "checkbox", "person", "text", "url", "email", "number", "currency", "percent"].includes(type);
}

export interface RowGroup {
  /** "" is the group of rows without a value. */
  key: string;
  label: string;
  option?: SelectOption;
  rows: DatabaseRow[];
}

const monthFmt = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });

/** Keys (and labels) of the groups a row belongs to; a row can be in several groups (multi-select, people). */
function groupKeysOf(prop: DatabaseProperty, row: DatabaseRow, ctx: ViewContext): { key: string; label: string }[] {
  const v = rawValue(prop, row);
  if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length))
    return prop.type === "checkbox" ? [{ key: "false", label: "Non coché" }] : [];
  switch (prop.type) {
    case "checkbox":
      return [{ key: String(v === true), label: v === true ? "Coché" : "Non coché" }];
    case "select":
    case "multi_select":
      return (Array.isArray(v) ? (v as string[]) : [v as string])
        .filter((id) => prop.config.options?.some((o) => o.id === id))
        .map((id) => ({ key: id, label: "" }));
    case "person":
    case "created_by":
      return (v as string[]).map((id) => ({ key: id, label: ctx.people[id] ?? "?" }));
    case "relation":
      return (v as string[]).map((id) => ({ key: id, label: ctx.related[id]?.title || "Sans titre" }));
    case "date":
    case "created_time":
    case "last_edited_time": {
      const day = dayOf(typeof v === "string" ? v : (v as DateValue).start);
      const month = day.slice(0, 7);
      return [{ key: month, label: monthFmt.format(new Date(`${month}-01T00:00:00`)) }];
    }
    case "number":
    case "currency":
    case "percent":
      return [{ key: String(v), label: String(v) }];
    default: {
      const s = cellText(prop, v, ctx);
      return s ? [{ key: s, label: s }] : [];
    }
  }
}

/**
 * Groups the (already filtered and sorted) rows by a column. Select columns list all their options,
 * in order, so empty groups can still receive rows; other groups follow their natural order.
 */
export function groupRows(prop: DatabaseProperty, rows: DatabaseRow[], ctx: ViewContext): RowGroup[] {
  const groups = new Map<string, RowGroup>();
  const empty: RowGroup = { key: "", label: `Sans ${prop.name.toLowerCase()}`, rows: [] };
  if (prop.type === "select" || prop.type === "multi_select") {
    for (const o of prop.config.options ?? []) groups.set(o.id, { key: o.id, label: o.name, option: o, rows: [] });
  }
  if (prop.type === "checkbox") {
    groups.set("true", { key: "true", label: "Coché", rows: [] });
    groups.set("false", { key: "false", label: "Non coché", rows: [] });
  }
  for (const row of rows) {
    const keys = groupKeysOf(prop, row, ctx);
    if (!keys.length) empty.rows.push(row);
    for (const k of keys) {
      let g = groups.get(k.key);
      if (!g) groups.set(k.key, (g = { key: k.key, label: k.label, rows: [] }));
      g.rows.push(row);
    }
  }
  let list = [...groups.values()];
  if (DATE_TYPES.includes(prop.type)) list.sort((a, b) => (a.key < b.key ? -1 : 1));
  else if (NUMBER_TYPES.includes(prop.type)) list.sort((a, b) => Number(a.key) - Number(b.key));
  else if (prop.type !== "select" && prop.type !== "multi_select" && prop.type !== "checkbox")
    list.sort((a, b) => collator.compare(a.label, b.label));
  if (prop.type !== "checkbox") list = [...list, empty];
  return list;
}

/** New value of a cell when its row moves from one group to another. */
export function moveToGroup(prop: DatabaseProperty, value: CellValue, from: string, to: string): CellValue {
  switch (prop.type) {
    case "checkbox":
      return to === "true";
    case "multi_select":
    case "person": {
      const list = ((value as string[] | null) ?? []).filter((id) => id !== from && id !== to);
      return to ? [...list, to] : list;
    }
    case "number":
    case "currency":
    case "percent":
      return to === "" ? null : Number(to);
    default:
      return to === "" ? null : to;
  }
}

/** Values a new row gets so it shows up in the view: simple "is" filters, and the group it was added to. */
export function initialValues(
  ctx: Pick<ViewContext, "properties" | "rows" | "me">,
  config: { filters?: ViewFilter[]; filterMode?: "and" | "or" },
  group?: { prop: DatabaseProperty; key: string },
): Record<string, CellValue> {
  const values: Record<string, CellValue> = {};
  const filters = (config.filters ?? []).filter((f) => isActiveFilter(f, ctx));
  // With "or", a single matching filter is enough: don't guess which one.
  if (config.filterMode !== "or" || filters.length === 1) {
    for (const f of filters) {
      const prop = ctx.properties.find((p) => p.id === f.propertyId)!;
      if (prop.type === "select" && f.operator === "is") values[prop.id] = f.value as string;
      else if (prop.type === "multi_select" && f.operator === "contains") values[prop.id] = [f.value as string];
      else if (prop.type === "person" && f.operator === "contains") {
        const id = f.value === "me" ? ctx.me : (f.value as string);
        if (id) values[prop.id] = [id];
      } else if (prop.type === "checkbox" && (f.operator === "checked" || f.operator === "unchecked")) values[prop.id] = f.operator === "checked";
      else if (["number", "currency", "percent"].includes(prop.type) && f.operator === "eq") values[prop.id] = Number(f.value);
      else if (["text", "url", "email"].includes(prop.type) && f.operator === "is") values[prop.id] = String(f.value);
    }
  }
  if (group && canMoveBetweenGroups(group.prop.type)) values[group.prop.id] = moveToGroup(group.prop, values[group.prop.id] ?? null, "", group.key);
  return values;
}
