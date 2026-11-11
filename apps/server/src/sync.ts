/**
 * Sync of a space between two Nootions: the desktop app's local server and a Nootion server.
 *
 * Every change of a page, a database column or a view is recorded in `sync_changes` by SQLite triggers (migration
 * 0034), which also stamp when each field changed (`field_clock`, `sync_clock`). A peer pulls what changed since
 * its last pull (`changesSince`) and pushes what changed on its side (`applyChanges`):
 *
 * - page content is a Yjs document: both sides' updates are merged, nothing is ever lost;
 * - every other field of a page, and each cell of a row ("p:<property id>"), is kept from whichever side changed it
 *   last;
 * - columns and views are kept whole from the side that changed them last;
 * - a page, column or view deleted for good on one side is deleted on the other.
 *
 * Changes applied from a peer are recorded with its id as `origin`, so they aren't sent back to it.
 */
import * as Y from "yjs";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import type { Collab } from "./collab.js";
import { editContent, encodeContent } from "./collab.js";
import type { Db } from "./db/index.js";
import { databaseProperties, databaseViews, pages, syncChanges, syncState, users } from "./db/schema.js";

/** The fields of a page kept from the side that changed them last, as named in `field_clock`. */
export const PAGE_FIELDS = [
  "parentId",
  "kind",
  "title",
  "icon",
  "fullWidth",
  "cover",
  "coverPosition",
  "position",
  "deletedAt",
  "deletedBy",
  "template",
  "defaultTemplateId",
] as const;
type PageField = (typeof PAGE_FIELDS)[number];

export interface SyncPage {
  id: string;
  workspaceId: string;
  parentId: string | null;
  kind: "page" | "database" | "row";
  title: string;
  icon: string | null;
  fullWidth: boolean;
  cover: string | null;
  coverPosition: number;
  position: number;
  createdBy: string | null;
  createdAt: number;
  deletedAt: number | null;
  deletedBy: string | null;
  props: Record<string, unknown> | null;
  template: boolean;
  defaultTemplateId: string | null;
  fieldClock: Record<string, number>;
  /** The Yjs document, base64. */
  content: string | null;
}

export interface SyncColumn {
  id: string;
  databaseId: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  position: number;
  createdAt: number;
  syncClock: number;
}

export type SyncChange =
  | { entity: "page"; id: string; deleted?: false; data: SyncPage }
  | { entity: "property" | "view"; id: string; deleted?: false; data: SyncColumn }
  | { entity: "page" | "property" | "view"; id: string; deleted: true };

/** The last change recorded, to start pulling from. */
export function currentSeq(db: Db): number {
  return (
    db
      .select({ seq: sql<number>`coalesce(max(${syncChanges.seq}), 0)` })
      .from(syncChanges)
      .get()?.seq ?? 0
  );
}

const toSyncPage = (r: typeof pages.$inferSelect): SyncPage => ({
  id: r.id,
  workspaceId: r.workspaceId,
  parentId: r.parentId,
  kind: r.kind,
  title: r.title,
  icon: r.icon,
  fullWidth: r.fullWidth,
  cover: r.cover,
  coverPosition: r.coverPosition,
  position: r.position,
  createdBy: r.createdBy,
  createdAt: r.createdAt.getTime(),
  deletedAt: r.deletedAt?.getTime() ?? null,
  deletedBy: r.deletedBy,
  props: r.props ?? null,
  template: r.template,
  defaultTemplateId: r.defaultTemplateId,
  fieldClock: r.fieldClock ?? {},
  content: r.contentState ? Buffer.from(r.contentState).toString("base64") : null,
});

const toSyncColumn = (r: typeof databaseProperties.$inferSelect): SyncColumn => ({
  id: r.id,
  databaseId: r.databaseId,
  name: r.name,
  type: r.type,
  config: r.config,
  position: r.position,
  createdAt: r.createdAt.getTime(),
  syncClock: r.syncClock,
});

/**
 * What changed in a space after `since`, as the objects are now (or their deletion), oldest change first.
 * Changes applied from `peer` are left out. `seq` is where the next pull starts; `more` says it should come at once.
 */
export function changesSince(
  db: Db,
  workspaceId: string,
  since: number,
  peer: string | null,
  limit = 200,
): { seq: number; more: boolean; changes: SyncChange[] } {
  const rows = db
    .select()
    .from(syncChanges)
    .where(and(eq(syncChanges.workspaceId, workspaceId), gt(syncChanges.seq, since)))
    .orderBy(syncChanges.seq)
    .limit(limit * 5)
    .all();
  if (!rows.length) return { seq: since, more: false, changes: [] };
  // Each object once; one only changed by the peer itself (its own changes coming back) stays out.
  const latest = new Map<string, (typeof rows)[number]>();
  const fromOthers = new Set<string>();
  let seq = since;
  for (const r of rows) {
    const key = `${r.entity}:${r.entityId}`;
    if (latest.size >= limit && !latest.has(key)) break;
    seq = r.seq;
    latest.set(key, r);
    if (!peer || r.origin !== peer) fromOthers.add(key);
  }
  const more = seq < rows[rows.length - 1].seq || rows.length === limit * 5;
  const wanted = [...latest.entries()].filter(([key]) => fromOthers.has(key)).map(([, r]) => r);
  const ids = (entity: string) => wanted.filter((r) => r.entity === entity).map((r) => r.entityId);
  const pageRows = new Map(
    ids("page").length
      ? db
          .select()
          .from(pages)
          .where(inArray(pages.id, ids("page")))
          .all()
          .map((r) => [r.id, r])
      : [],
  );
  const propRows = new Map(
    ids("property").length
      ? db
          .select()
          .from(databaseProperties)
          .where(inArray(databaseProperties.id, ids("property")))
          .all()
          .map((r) => [r.id, r])
      : [],
  );
  const viewRows = new Map(
    ids("view").length
      ? db
          .select()
          .from(databaseViews)
          .where(inArray(databaseViews.id, ids("view")))
          .all()
          .map((r) => [r.id, r])
      : [],
  );
  const changes: SyncChange[] = [];
  for (const r of wanted) {
    if (r.entity === "page") {
      const row = pageRows.get(r.entityId);
      // Moved to another space: gone from this one.
      if (row && row.workspaceId === workspaceId) changes.push({ entity: "page", id: r.entityId, data: toSyncPage(row) });
      else changes.push({ entity: "page", id: r.entityId, deleted: true });
    } else {
      const row = (r.entity === "property" ? propRows : viewRows).get(r.entityId);
      if (row) changes.push({ entity: r.entity, id: r.entityId, data: toSyncColumn(row) });
      else changes.push({ entity: r.entity, id: r.entityId, deleted: true });
    }
  }
  return { seq, more, changes };
}

/** Runs `fn` with the changes it makes recorded as `peer`'s, and their clocks kept as given. */
function asPeer<T>(db: Db, peer: string, fn: () => T): T {
  db.insert(syncState)
    .values({ key: "applying", value: peer })
    .onConflictDoUpdate({ target: syncState.key, set: { value: peer } })
    .run();
  try {
    return fn();
  } finally {
    db.update(syncState).set({ value: null }).where(eq(syncState.key, "applying")).run();
  }
}

const date = (ms: number | null) => (ms === null ? null : new Date(ms));

/** A user id kept only if that account exists here (the author of a page made elsewhere may not). */
function knownUser(db: Db, id: string | null): string | null {
  if (!id) return null;
  return db.select({ id: users.id }).from(users).where(eq(users.id, id)).get() ? id : null;
}

/** Merges the incoming fields and cells into the page as it is here. Returns the fields to write, or null if nothing changes. */
export function mergePage(
  local: SyncPage,
  incoming: SyncPage,
): { fields: Partial<Record<PageField, unknown>>; props: Record<string, unknown> | null; fieldClock: Record<string, number> } | null {
  const clock = { ...local.fieldClock };
  const fields: Partial<Record<PageField, unknown>> = {};
  let changed = false;
  for (const f of PAGE_FIELDS) {
    const theirs = incoming.fieldClock[f] ?? 0;
    if (theirs > (clock[f] ?? 0)) {
      clock[f] = theirs;
      changed = true;
      if (JSON.stringify(local[f]) !== JSON.stringify(incoming[f])) fields[f] = incoming[f];
    }
  }
  let props = local.props ? { ...local.props } : null;
  const keys = new Set([
    ...Object.keys(incoming.fieldClock)
      .filter((k) => k.startsWith("p:"))
      .map((k) => k.slice(2)),
  ]);
  let propsChanged = false;
  for (const k of keys) {
    const theirs = incoming.fieldClock[`p:${k}`] ?? 0;
    if (theirs <= (clock[`p:${k}`] ?? 0)) continue;
    clock[`p:${k}`] = theirs;
    changed = true;
    const inValue = incoming.props && k in incoming.props ? incoming.props[k] : undefined;
    const localValue = props && k in props ? props[k] : undefined;
    if (JSON.stringify(inValue) === JSON.stringify(localValue)) continue;
    props = props ?? {};
    if (inValue === undefined) delete props[k];
    else props[k] = inValue;
    propsChanged = true;
  }
  if (!changed) return null;
  return { fields, props: propsChanged ? props : (local.props ?? null), fieldClock: clock };
}

/** Merges two Yjs states. Returns the merged state, or null when `incoming` brings nothing new. */
export function mergeContent(local: Buffer | null, incoming: string | null): Buffer | null {
  if (!incoming) return null;
  const update = new Uint8Array(Buffer.from(incoming, "base64"));
  if (!local) return Buffer.from(update);
  const before = Y.encodeStateVectorFromUpdate(new Uint8Array(local));
  const merged = Y.mergeUpdates([new Uint8Array(local), update]);
  const after = Y.encodeStateVectorFromUpdate(merged);
  return Buffer.compare(Buffer.from(before), Buffer.from(after)) === 0 ? null : Buffer.from(merged);
}

/**
 * Applies a peer's changes to a space. Pages come first (columns and views belong to a database page), deletions
 * last. Changes for another space are refused. Returns how many objects changed here.
 */
export async function applyChanges(db: Db, collab: Collab | null, workspaceId: string, peer: string, changes: SyncChange[]): Promise<number> {
  let applied = 0;
  const order = { page: 0, property: 1, view: 2 } as const;
  const upserts = changes.filter((c) => !c.deleted).sort((a, b) => order[a.entity] - order[b.entity]);
  const deletions = changes.filter((c) => c.deleted).sort((a, b) => order[b.entity] - order[a.entity]);
  const contentToMerge: { id: string; update: Uint8Array }[] = [];

  asPeer(db, peer, () =>
    db.transaction((tx) => {
      for (const c of upserts) {
        if (c.deleted) continue;
        if (c.entity === "page") {
          const p = c.data;
          if (p.workspaceId !== workspaceId || p.id !== c.id) continue;
          const row = tx.select().from(pages).where(eq(pages.id, p.id)).get();
          if (row && row.workspaceId !== workspaceId) continue;
          if (!row) {
            tx.insert(pages)
              .values({
                id: p.id,
                workspaceId,
                parentId: p.parentId,
                kind: p.kind,
                title: p.title,
                icon: p.icon,
                fullWidth: p.fullWidth,
                cover: p.cover,
                coverPosition: p.coverPosition,
                position: p.position,
                createdBy: knownUser(db, p.createdBy),
                createdAt: new Date(p.createdAt),
                deletedAt: date(p.deletedAt),
                deletedBy: knownUser(db, p.deletedBy),
                props: p.props,
                template: p.template,
                defaultTemplateId: p.defaultTemplateId,
                fieldClock: p.fieldClock,
                syncClock: Math.max(0, ...Object.values(p.fieldClock)),
              })
              .run();
            if (p.content) contentToMerge.push({ id: p.id, update: new Uint8Array(Buffer.from(p.content, "base64")) });
            applied++;
            continue;
          }
          const merged = mergePage(toSyncPage(row), p);
          if (merged) {
            const f = merged.fields;
            const set: Partial<typeof pages.$inferInsert> = { fieldClock: merged.fieldClock, props: merged.props };
            if ("parentId" in f) set.parentId = f.parentId as string | null;
            if ("kind" in f) set.kind = f.kind as SyncPage["kind"];
            if ("title" in f) set.title = f.title as string;
            if ("icon" in f) set.icon = f.icon as string | null;
            if ("fullWidth" in f) set.fullWidth = f.fullWidth as boolean;
            if ("cover" in f) set.cover = f.cover as string | null;
            if ("coverPosition" in f) set.coverPosition = f.coverPosition as number;
            if ("position" in f) set.position = f.position as number;
            if ("deletedAt" in f) set.deletedAt = date(f.deletedAt as number | null);
            if ("deletedBy" in f) set.deletedBy = knownUser(db, f.deletedBy as string | null);
            if ("template" in f) set.template = f.template as boolean;
            if ("defaultTemplateId" in f) set.defaultTemplateId = f.defaultTemplateId as string | null;
            tx.update(pages).set(set).where(eq(pages.id, p.id)).run();
            applied++;
          }
          if (p.content && mergeContent(row.contentState, p.content)) {
            contentToMerge.push({ id: p.id, update: new Uint8Array(Buffer.from(p.content, "base64")) });
            if (!merged) applied++;
          }
        } else {
          const col = c.data;
          const table = c.entity === "property" ? databaseProperties : databaseViews;
          const db_ = tx.select({ ws: pages.workspaceId }).from(pages).where(eq(pages.id, col.databaseId)).get();
          if (!db_ || db_.ws !== workspaceId || col.id !== c.id) continue;
          const row = tx.select().from(table).where(eq(table.id, col.id)).get();
          const values = { databaseId: col.databaseId, name: col.name, type: col.type, config: col.config, position: col.position, syncClock: col.syncClock };
          if (!row) {
            tx.insert(table)
              .values({ id: col.id, createdAt: new Date(col.createdAt), ...values })
              .run();
            applied++;
          } else if (col.syncClock > row.syncClock) {
            tx.update(table).set(values).where(eq(table.id, col.id)).run();
            applied++;
          }
        }
      }
      for (const c of deletions) {
        if (c.entity === "page") {
          const row = tx.select({ ws: pages.workspaceId }).from(pages).where(eq(pages.id, c.id)).get();
          if (row?.ws !== workspaceId) continue;
          // Columns, views and rows of a database go with it; rows' pages are its children.
          tx.delete(pages).where(eq(pages.id, c.id)).run();
          applied++;
        } else {
          const table = c.entity === "property" ? databaseProperties : databaseViews;
          const row = tx.select({ ws: pages.workspaceId }).from(table).innerJoin(pages, eq(pages.id, table.databaseId)).where(eq(table.id, c.id)).get();
          if (row?.ws !== workspaceId) continue;
          tx.delete(table).where(eq(table.id, c.id)).run();
          applied++;
        }
      }
    }),
  );

  // Content goes through the live editing server when someone has the page open, so their editor gets it too.
  for (const { id, update } of contentToMerge) {
    if (collab) {
      await editContent(collab, db, id, (doc) => Y.applyUpdate(doc, update));
      continue;
    }
    const y = new Y.Doc();
    const row = db.select({ state: pages.contentState }).from(pages).where(eq(pages.id, id)).get();
    if (row?.state) Y.applyUpdate(y, new Uint8Array(row.state));
    Y.applyUpdate(y, update);
    const { state, json, text } = encodeContent(y);
    db.update(pages).set({ contentState: state, contentJson: json, contentText: text }).where(eq(pages.id, id)).run();
  }
  return applied;
}
