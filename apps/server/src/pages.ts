import { and, asc, eq, isNull, max, sql } from "drizzle-orm";
import type { PageDetail, PageRole, PageSummary } from "@nootion/shared";
import type { Db, DbLike } from "./db/index.js";
import { pages } from "./db/schema.js";
import type { ChainEntry } from "./permissions.js";

export type PageRow = typeof pages.$inferSelect;

export function toSummary(p: Pick<PageRow, "id" | "kind" | "workspaceId" | "parentId" | "title" | "icon" | "position">): PageSummary {
  return { id: p.id, kind: p.kind, workspaceId: p.workspaceId, parentId: p.parentId, title: p.title, icon: p.icon, position: p.position };
}

export function toDetail(p: PageMeta, role: PageRole, breadcrumb: PageDetail["breadcrumb"], home = false): PageDetail {
  return {
    ...toSummary(p),
    role,
    breadcrumb,
    fullWidth: p.fullWidth,
    cover: p.cover,
    coverPosition: p.coverPosition,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    home,
    template: p.template,
  };
}

/**
 * Drops pages that are in the trash, directly or through an ancestor.
 * `rows` must contain every page of the subtrees involved (typically a whole workspace).
 */
export function withoutTrashed<T extends { id: string; parentId: string | null; deletedAt: Date | null }>(rows: T[]): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const memo = new Map<string, boolean>();
  const trashed = (id: string, seen = new Set<string>()): boolean => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    const row = byId.get(id);
    let result = false;
    if (row) {
      if (row.deletedAt) result = true;
      else if (row.parentId && !seen.has(row.parentId)) {
        seen.add(id);
        result = trashed(row.parentId, seen);
      }
    }
    memo.set(id, result);
    return result;
  };
  return rows.filter((r) => !trashed(r.id));
}

export function sortPages<T extends { position: number; createdAt: Date }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime());
}

/** Page columns without the (possibly large) content. */
export const pageMeta = {
  id: pages.id,
  workspaceId: pages.workspaceId,
  parentId: pages.parentId,
  kind: pages.kind,
  title: pages.title,
  icon: pages.icon,
  fullWidth: pages.fullWidth,
  cover: pages.cover,
  coverPosition: pages.coverPosition,
  position: pages.position,
  createdBy: pages.createdBy,
  createdAt: pages.createdAt,
  updatedAt: pages.updatedAt,
  deletedAt: pages.deletedAt,
  deletedBy: pages.deletedBy,
  template: pages.template,
  defaultTemplateId: pages.defaultTemplateId,
};
export type PageMeta = Omit<PageRow, "contentState" | "contentJson" | "contentText" | "props">;

/** Database rows are pages too, but they are listed inside their database, not in page trees. */
export const notRow = <T extends { kind: string }>(p: T) => p.kind !== "row";

export function getPageMeta(db: DbLike, id: string): PageMeta | undefined {
  return db.select(pageMeta).from(pages).where(eq(pages.id, id)).get();
}

export function listWorkspacePages(db: Db, workspaceId: string): PageMeta[] {
  const rows = db.select(pageMeta).from(pages).where(eq(pages.workspaceId, workspaceId)).all();
  return sortPages(withoutTrashed(rows)).filter(notRow);
}

/** All live descendants of a page (not including the page itself). */
export function listDescendants(db: Db, pageId: string, opts: { includeTrashed?: boolean } = {}): PageMeta[] {
  const ids = db
    .all<{ id: string }>(sql`
      WITH RECURSIVE sub(id, depth) AS (
        SELECT id, 0 FROM pages WHERE parent_id = ${pageId}
        UNION ALL
        SELECT p.id, sub.depth + 1 FROM pages p JOIN sub ON p.parent_id = sub.id WHERE sub.depth < 1000
      )
      SELECT id FROM sub
    `)
    .map((r) => r.id);
  if (ids.length === 0) return [];
  const rows = db
    .select(pageMeta)
    .from(pages)
    .where(sql`${pages.id} IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`)
    .all();
  if (opts.includeTrashed) return sortPages(rows);
  // The root itself is live here; drop subtrees that were trashed individually.
  const live = withoutTrashed(rows.map((r) => (r.parentId === pageId ? { ...r, parentId: null } : r)));
  const liveIds = new Set(live.map((r) => r.id));
  return sortPages(rows.filter((r) => liveIds.has(r.id)));
}

export function nextPosition(db: Db, workspaceId: string, parentId: string | null): number {
  const row = db
    .select({ max: max(pages.position) })
    .from(pages)
    .where(and(eq(pages.workspaceId, workspaceId), parentId ? eq(pages.parentId, parentId) : isNull(pages.parentId)))
    .get();
  return (row?.max ?? -1) + 1;
}

/** Renumbers live siblings so that `pageId` sits at `index`. */
export function placeAmongSiblings(db: DbLike, page: PageMeta, index: number | undefined): void {
  const siblings = sortPages(
    db
      .select(pageMeta)
      .from(pages)
      .where(
        and(
          eq(pages.workspaceId, page.workspaceId),
          page.parentId ? eq(pages.parentId, page.parentId) : isNull(pages.parentId),
          isNull(pages.deletedAt),
        ),
      )
      .all(),
  ).filter((p) => p.id !== page.id);
  const at = index === undefined ? siblings.length : Math.min(index, siblings.length);
  siblings.splice(at, 0, page);
  siblings.forEach((p, i) => {
    if (p.position !== i || p.id === page.id) db.update(pages).set({ position: i }).where(eq(pages.id, p.id)).run();
  });
}

export function breadcrumbFor(chain: ChainEntry[], canSee: (entry: ChainEntry) => boolean): PageDetail["breadcrumb"] {
  // chain = [page, parent, ..., root]; keep visible ancestors, root first.
  return chain
    .slice(1)
    .reverse()
    .filter(canSee)
    .map((c) => ({ id: c.id, title: c.title, icon: c.icon }));
}

export const orderByPosition = [asc(pages.position), asc(pages.createdAt)];
