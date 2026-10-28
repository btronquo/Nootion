import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  COMPUTED_TYPES,
  valueSchema,
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
import type { PageMeta } from "./pages.js";

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
    .map((v) => ({ id: v.id, name: v.name, type: "table" as const, config: v.config, position: v.position }))
    .sort((a, b) => a.position - b.position);
}

/** Creates the page holding the database, its title column and a first table view. */
export function createDatabase(db: Db, input: { workspaceId: string; parentId: string | null; title: string; position: number; userId: string }) {
  return db.transaction((tx) => {
    const id = randomUUID();
    tx.insert(pages)
      .values({ id, kind: "database", workspaceId: input.workspaceId, parentId: input.parentId, title: input.title, position: input.position, createdBy: input.userId })
      .run();
    tx.insert(databaseProperties).values({ id: randomUUID(), databaseId: id, name: "Nom", type: "title", position: 0 }).run();
    tx.insert(databaseProperties).values({ id: randomUUID(), databaseId: id, name: "Étiquettes", type: "multi_select", config: { options: [] }, position: 1 }).run();
    tx.insert(databaseViews).values({ id: randomUUID(), databaseId: id, name: "Tableau", type: "table", position: 0 }).run();
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
export function collectPeople(db: DbLike, properties: DatabaseProperty[], rows: DatabaseRow[]): Record<string, string> {
  const personIds = new Set<string>();
  for (const p of properties) {
    if (p.type !== "person" && p.type !== "created_by") continue;
    for (const r of rows) for (const id of (r.values[p.id] as string[] | null) ?? []) personIds.add(id);
  }
  const people: Record<string, string> = {};
  if (personIds.size) {
    for (const u of db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...personIds])).all()) people[u.id] = u.name;
  }
  return people;
}

export function loadDatabase(db: Db, page: PageMeta, role: PageRole): DatabaseData {
  const properties = listProperties(db, page.id);
  const rows = listRowPages(db, page.id).map((r) => toRow(r, properties));
  const people = collectPeople(db, properties, rows);
  return { id: page.id, title: page.title, icon: page.icon, role, properties, views: listViews(db, page.id), rows, people };
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
    if (!prop) throw new HttpError(400, "unknown_property", "Colonne inconnue.");
    if (COMPUTED_TYPES.includes(prop.type)) throw new HttpError(400, "computed_property", `La colonne « ${prop.name} » est calculée automatiquement.`);
    const parsed = valueSchema(prop.type).safeParse(raw);
    if (!parsed.success) throw new HttpError(400, "invalid_value", `Valeur invalide pour « ${prop.name} ».`);
    let value = parsed.data;
    if (typeof value === "string" && value === "" && prop.type !== "title") value = null;
    if (Array.isArray(value) && value.length === 0) value = null;

    if (prop.type === "title") {
      title = (value as string | null) ?? "";
      continue;
    }
    if (prop.type === "select" && value !== null && !(prop.config.options ?? []).some((o) => o.id === value)) {
      throw new HttpError(400, "unknown_option", `Option inconnue pour « ${prop.name} ».`);
    }
    if (prop.type === "multi_select" && value !== null) {
      const ids = new Set((prop.config.options ?? []).map((o) => o.id));
      if ((value as string[]).some((v) => !ids.has(v))) throw new HttpError(400, "unknown_option", `Option inconnue pour « ${prop.name} ».`);
      value = [...new Set(value as string[])];
    }
    if (prop.type === "person" && value !== null) {
      const ids = [...new Set(value as string[])];
      const found = db.select({ id: users.id }).from(users).where(inArray(users.id, ids)).all();
      if (found.length !== ids.length) throw new HttpError(400, "unknown_user", `Personne inconnue pour « ${prop.name} ».`);
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
      if (owned.length !== new Set(files.map((f) => f.id)).size) throw new HttpError(400, "unknown_file", "Fichier inconnu : envoyez-le d'abord sur cette ligne.");
    }
    out[propId] = value;
  }
  return { values: out, title };
}

// --- Changing a column's type -------------------------------------------------------------

const TRUE_WORDS = new Set(["oui", "yes", "true", "vrai", "1", "x", "✓", "✔"]);

function parseNumber(s: string): number | null {
  const cleaned = s.replace(/[\s €$£%]/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

function parseDate(s: string): string | null {
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
      return value ? "Oui" : "";
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
