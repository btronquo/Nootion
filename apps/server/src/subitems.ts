import { randomUUID } from "node:crypto";
import { and, eq, inArray, max } from "drizzle-orm";
import {
  MAX_CHAIN_DEPTH,
  daysBetween,
  dependencyProps,
  reaches,
  roleProperty,
  shiftDate,
  subItemProps,
  t,
  type CellValue,
  type DatabaseProperty,
  type DateValue,
  type RelationRole,
} from "@nootion/shared";
import { databaseProperties, pages } from "./db/schema.js";
import type { DbLike } from "./db/index.js";
import { HttpError } from "./http.js";
import { listProperties, listRowPages } from "./databases.js";

/**
 * Sub-items ("parent" / "children") and dependencies ("blocks" / "blockedBy") are relations of a database to itself
 * with a role. Here: turning them on and off, refusing loops, keeping one parent per row, and moving the rows a row
 * blocks when its dates move.
 */

type Props = Record<string, CellValue>;

const PAIRS = {
  subItems: { roles: ["parent", "children"], names: ["subItems.parentColumn", "subItems.childrenColumn"] },
  dependencies: { roles: ["blockedBy", "blocks"], names: ["dependencies.blockedByColumn", "dependencies.blocksColumn"] },
} as const;
export type Structure = keyof typeof PAIRS;

const idsOf = (props: Props | undefined, propId: string): string[] => {
  const v = props?.[propId];
  return Array.isArray(v) ? (v as string[]) : [];
};

/** Adds the two columns of sub-items or dependencies to a database (nothing when they are there), or removes them. */
export function setStructure(db: DbLike, databaseId: string, kind: Structure, enabled: boolean) {
  const { roles, names } = PAIRS[kind];
  const existing = listProperties(db, databaseId).filter((p) => p.type === "relation" && roles.includes(p.config.role as never));
  if (!enabled) {
    for (const p of existing) removeRoleColumn(db, databaseId, p);
    return;
  }
  if (existing.length === 2) return;
  // Half a pair (left by an older version): start again with a whole one.
  for (const p of existing) removeRoleColumn(db, databaseId, p);
  const taken = new Set(listProperties(db, databaseId).map((p) => p.name.toLowerCase()));
  const free = (base: string) => {
    let name = base;
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base} ${i}`;
    return name;
  };
  const position =
    (db
      .select({ max: max(databaseProperties.position) })
      .from(databaseProperties)
      .where(eq(databaseProperties.databaseId, databaseId))
      .get()?.max ?? -1) + 1;
  const [a, b] = [randomUUID(), randomUUID()];
  db.insert(databaseProperties)
    .values([
      { id: a, databaseId, name: free(t(names[0])), type: "relation", config: { databaseId, twinPropertyId: b, role: roles[0] }, position },
      { id: b, databaseId, name: free(t(names[1])), type: "relation", config: { databaseId, twinPropertyId: a, role: roles[1] }, position: position + 1 },
    ])
    .run();
}

/** Deletes a column with a role and its values (its twin is handled by the caller or the next call). */
function removeRoleColumn(db: DbLike, databaseId: string, prop: DatabaseProperty) {
  for (const r of listRowPages(db, databaseId)) {
    if (!r.props || !(prop.id in r.props)) continue;
    const { [prop.id]: _removed, ...rest } = r.props;
    db.update(pages).set({ props: rest }).where(eq(pages.id, r.id)).run();
  }
  db.delete(databaseProperties).where(eq(databaseProperties.id, prop.id)).run();
}

/** The twin of a column with a role, which goes with it when it is deleted. */
export function roleTwin(properties: DatabaseProperty[], prop: DatabaseProperty): DatabaseProperty | undefined {
  if (prop.type !== "relation" || !prop.config.role) return undefined;
  return properties.find((p) => p.id === prop.config.twinPropertyId && p.config.role);
}

/**
 * Refuses values that would give a row two parents, link a row to itself, or close a loop (a row inside its own
 * sub-items, a task that ends up waiting for itself). `rowId` is null for a new row, which nothing links to yet.
 */
export function checkRoleLinks(db: DbLike, databaseId: string, properties: DatabaseProperty[], rowId: string | null, values: Props) {
  const written = properties.filter((p) => p.type === "relation" && p.config.role && p.id in values);
  if (!written.length) return;
  const rows = new Map(listRowPages(db, databaseId).map((r) => [r.id, (r.props ?? {}) as Props]));
  const prop = (role: RelationRole) => roleProperty(properties, role);
  // Links as they would be once these values are written.
  const linked = (id: string, role: RelationRole): string[] => {
    const p = prop(role);
    if (!p) return [];
    return id === rowId && p.id in values ? idsOf(values, p.id) : idsOf(rows.get(id), p.id);
  };
  const up = (id: string) => linked(id, "parent");
  const next = (id: string) => linked(id, "blocks");
  for (const p of written) {
    const targets = idsOf(values, p.id);
    if (rowId && targets.includes(rowId)) throw new HttpError(400, "self_link", t("error.selfLink", { name: p.name }));
    if (p.config.role === "parent" && targets.length > 1) throw new HttpError(400, "one_parent", t("error.oneParent"));
    if (!rowId) continue;
    for (const target of targets) {
      const loop =
        p.config.role === "parent"
          ? reaches(up, target, rowId)
          : p.config.role === "children"
            ? reaches(up, rowId, target)
            : p.config.role === "blockedBy"
              ? reaches(next, rowId, target)
              : reaches(next, target, rowId);
      if (loop)
        throw new HttpError(400, "link_loop", t(p.config.role === "parent" || p.config.role === "children" ? "error.subItemLoop" : "error.dependencyLoop"));
    }
  }
}

/**
 * After a row's sub-items were written (and their twin cells updated): each new sub-item leaves its previous parent,
 * so that a row always has one parent at most.
 */
export function keepOneParent(db: DbLike, properties: DatabaseProperty[], rowId: string, before: string[], after: string[]) {
  const sub = subItemProps(properties);
  if (!sub) return;
  for (const child of after.filter((id) => !before.includes(id))) {
    const row = db.select({ props: pages.props }).from(pages).where(eq(pages.id, child)).get();
    if (!row) continue;
    const props = { ...(row.props ?? {}) } as Props;
    const others = idsOf(props, sub.parent.id).filter((id) => id !== rowId);
    if (!others.length) continue;
    props[sub.parent.id] = [rowId];
    db.update(pages).set({ props }).where(eq(pages.id, child)).run();
    for (const old of db.select({ id: pages.id, props: pages.props }).from(pages).where(inArray(pages.id, others)).all()) {
      const p = { ...(old.props ?? {}) } as Props;
      const kept = idsOf(p, sub.children.id).filter((id) => id !== child);
      if (kept.length) p[sub.children.id] = kept;
      else delete p[sub.children.id];
      db.update(pages).set({ props: p, updatedAt: new Date() }).where(eq(pages.id, old.id)).run();
    }
  }
}

const endDay = (v: CellValue | undefined): string | null => {
  if (!v || typeof v !== "object" || Array.isArray(v) || !("start" in v)) return null;
  const d = v as DateValue;
  return (d.end || d.start).slice(0, 10);
};

/**
 * When "move the rows it blocks" is on and a row's date moved, the rows it blocks (and the rows they block, and so
 * on) move by as many days, so the gaps between them stay. Each row moves once. Returns the ids of the rows moved.
 */
export function shiftDependents(db: DbLike, databaseId: string, properties: DatabaseProperty[], rowId: string, before: Props, after: Props): string[] {
  const deps = dependencyProps(properties);
  if (!deps?.blocks.config.shiftDependents) return [];
  const moved: string[] = [];
  for (const date of properties.filter((p) => p.type === "date")) {
    const from = endDay(before[date.id]);
    const to = endDay(after[date.id]);
    if (!from || !to || from === to) continue;
    const days = daysBetween(from, to);
    const seen = new Set([rowId]);
    let wave = idsOf(after, deps.blocks.id);
    for (let depth = 0; wave.length && depth < MAX_CHAIN_DEPTH; depth++) {
      const nextWave: string[] = [];
      const found = db
        .select({ id: pages.id, props: pages.props })
        .from(pages)
        .where(
          and(
            inArray(
              pages.id,
              wave.filter((id) => !seen.has(id)),
            ),
            eq(pages.parentId, databaseId),
          ),
        )
        .all();
      for (const r of found) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        const props = { ...(r.props ?? {}) } as Props;
        const v = props[date.id] as DateValue | undefined;
        if (v?.start) {
          props[date.id] = { start: shiftDate(v.start, days), end: v.end ? shiftDate(v.end, days) : null };
          db.update(pages).set({ props, updatedAt: new Date() }).where(eq(pages.id, r.id)).run();
          if (!moved.includes(r.id)) moved.push(r.id);
        }
        nextWave.push(...idsOf(props, deps.blocks.id));
      }
      wave = nextWave;
    }
  }
  return moved;
}
