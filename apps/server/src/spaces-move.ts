import { eq, sql } from "drizzle-orm";
import type { Db, DbLike } from "./db/index.js";
import { pages, syncLinks } from "./db/schema.js";
import { listDescendants } from "./pages.js";

/**
 * Moving a page to another space: the page and all its subpages (database rows, templates and trashed subpages
 * included) change space together, since a page's space is always its root's (see permissions.ts).
 *
 * Everything else is keyed by page id and follows on its own: content and history, attachments and their files,
 * comments, shares, public link, favorites, backlinks and mentions, reminders, database columns and views.
 * Who can see the pages changes with the space: the members of the old space lose access (unless the page is
 * shared with them directly), the members of the new one gain it.
 */

/** Ids of the page and of all its subpages, the page first. */
export function subtreeIds(db: Db, pageId: string): string[] {
  return [pageId, ...listDescendants(db, pageId, { includeTrashed: true }).map((p) => p.id)];
}

/** A space kept in sync with a server by the desktop app (local mode). */
export function isSyncedSpace(db: Db, workspaceId: string): boolean {
  return !!db.select({ id: syncLinks.workspaceId }).from(syncLinks).where(eq(syncLinks.workspaceId, workspaceId)).get();
}

/** Moves the pages (a whole subtree, from `subtreeIds`) from one space to another, inside the caller's transaction. */
export function moveSubtreeToSpace(tx: DbLike, ids: string[], from: string, to: string): void {
  const list = JSON.stringify(ids);
  const inList = sql`(SELECT value FROM json_each(${list}))`;
  tx.update(pages).set({ workspaceId: to }).where(sql`${pages.id} IN ${inList}`).run();

  // The desktop app's sync (sync.ts) reads changes by space, and the triggers that record them don't watch the
  // space column: the old space is told the pages are gone, the new one gets them with everything that belongs
  // to them.
  const now = Date.now();
  const record = (entity: string, workspaceId: string, deleted: boolean, ids: ReturnType<typeof sql>) =>
    tx.run(sql`
      INSERT INTO sync_changes (entity, entity_id, workspace_id, deleted, origin, at)
      SELECT ${entity}, id, ${workspaceId}, ${deleted ? 1 : 0}, NULL, ${now} FROM (${ids})
    `);
  record("page", from, true, sql`SELECT value AS id FROM json_each(${list})`);
  record("page", to, false, sql`SELECT value AS id FROM json_each(${list})`);
  record("property", to, false, sql`SELECT id FROM database_properties WHERE database_id IN ${inList}`);
  record("view", to, false, sql`SELECT id FROM database_views WHERE database_id IN ${inList}`);
  record("attachment", to, false, sql`SELECT id FROM attachments WHERE page_id IN ${inList}`);
  record("thread", to, false, sql`SELECT id FROM comment_threads WHERE page_id IN ${inList}`);
  record(
    "comment",
    to,
    false,
    sql`SELECT c.id FROM comments c JOIN comment_threads th ON th.id = c.thread_id WHERE th.page_id IN ${inList}`,
  );
}
