import { inArray } from "drizzle-orm";
import { PEOPLE_TYPES, type DatabaseProperty, type PropertyType } from "@nootion/shared";
import type { Db } from "./db/index.js";
import { users } from "./db/schema.js";
import { listProperties } from "./databases.js";
import { cellText } from "./buttons.js";

/**
 * Cells that go into the search index. Computed values (formulas, rollups, times, authors) are left out: they change
 * without the row being written. Dates and checkboxes say little as words.
 */
const SEARCHED_TYPES: readonly PropertyType[] = [
  "text",
  "number",
  "currency",
  "percent",
  "select",
  "multi_select",
  "status",
  "url",
  "email",
  "phone",
  "person",
  "file",
  "unique_id",
];

/** Separates the cells in cells_text, and in the snippets shown by the search. */
export const CELL_SEPARATOR = " · ";

/** A row's cells as plain text: "Customer: Dupont · Status: Paid". */
export function rowCellsText(properties: DatabaseProperty[], props: Record<string, unknown> | null, names: Map<string, string>): string {
  const parts: string[] = [];
  for (const p of properties) {
    if (!SEARCHED_TYPES.includes(p.type)) continue;
    let text: string;
    try {
      text = cellText(p, props?.[p.id] ?? null, names).replace(/\s+/g, " ").trim();
    } catch {
      continue; // A value that doesn't have the shape of its column (changed type): left out.
    }
    if (text) parts.push(`${p.name}: ${text.slice(0, 2000)}`);
  }
  return parts.join(CELL_SEPARATOR);
}

/**
 * Computes cells_text again for the rows the triggers marked as stale, at most `max` of them, oldest first.
 * Returns how many were done.
 */
export function refreshCellsText(db: Db, max = 500): number {
  const client = db.$client;
  const stale = client
    .prepare(
      `SELECT s.page_id AS id, p.parent_id AS databaseId, p.props, p.kind
         FROM search_stale s LEFT JOIN pages p ON p.id = s.page_id
        LIMIT ?`,
    )
    .all(max) as { id: string; databaseId: string | null; props: string | null; kind: string | null }[];
  if (!stale.length) return 0;

  const propertiesOf = new Map<string, DatabaseProperty[]>();
  const parsed = stale.map((r) => {
    let props: Record<string, unknown> | null = null;
    try {
      props = r.props ? (JSON.parse(r.props) as Record<string, unknown>) : null;
    } catch {
      props = null;
    }
    if (r.kind === "row" && r.databaseId && !propertiesOf.has(r.databaseId)) propertiesOf.set(r.databaseId, listProperties(db, r.databaseId));
    return { ...r, props };
  });

  // Names of the people mentioned in person columns, read once.
  const people = new Set<string>();
  for (const r of parsed) {
    if (r.kind !== "row" || !r.databaseId) continue;
    for (const p of propertiesOf.get(r.databaseId) ?? []) {
      if (!PEOPLE_TYPES.includes(p.type)) continue;
      const v = r.props?.[p.id];
      if (Array.isArray(v)) for (const id of v) if (typeof id === "string") people.add(id);
    }
  }
  const names = new Map(
    people.size
      ? db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, [...people]))
          .all()
          .map((u) => [u.id, u.name] as const)
      : [],
  );

  const write = client.prepare(`UPDATE pages SET cells_text = ? WHERE id = ? AND cells_text IS NOT ?`);
  const done = client.prepare(`DELETE FROM search_stale WHERE page_id = ?`);
  client.transaction(() => {
    for (const r of parsed) {
      if (r.kind === "row" && r.databaseId) {
        const text = rowCellsText(propertiesOf.get(r.databaseId) ?? [], r.props, names);
        write.run(text || null, r.id, text || null);
      } else if (r.kind) {
        write.run(null, r.id, null); // No longer a row.
      }
      done.run(r.id);
    }
  })();
  return stale.length;
}

/** Keeps the index of database values up to date in the background, a batch at a time. */
export function createSearchIndexer(db: Db, log?: { error: (obj: unknown, msg?: string) => void }) {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  const run = () => {
    timer = null;
    if (stopped) return;
    let more = false;
    try {
      more = refreshCellsText(db, 500) === 500;
    } catch (err) {
      log?.error({ err }, "search index");
    }
    // Right away while rows are waiting (first start after the upgrade), then every few seconds.
    timer = setTimeout(run, more ? 0 : 5000);
    timer.unref();
  };
  return {
    wake() {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, 0);
      timer.unref();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
