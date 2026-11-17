import { eq } from "drizzle-orm";
import { t } from "@nootion/shared";
import type { DbLike } from "./db/index.js";
import { pages } from "./db/schema.js";
import { HttpError } from "./http.js";

/**
 * Locked pages. A locked page keeps its content, title, icon and cover; a locked database keeps its columns, views
 * and row templates while its rows can still be filled in. Anyone who can edit the page can lock or unlock it.
 * The interface shows the page read-only, but the server refuses the writes too: the collaborative editor opens it
 * read-only (collab.ts) and every route that changes the content checks it here.
 */
export function isLocked(db: DbLike, pageId: string): boolean {
  return db.select({ locked: pages.locked }).from(pages).where(eq(pages.id, pageId)).get()?.locked ?? false;
}

export const lockedError = (kind: string) => new HttpError(423, "locked", t(kind === "database" ? "error.databaseLocked" : "error.pageLocked"));

/** Throws 423 Locked when the page (or database) is locked. */
export function assertUnlocked(page: { locked: boolean; kind: string }) {
  if (page.locked) throw lockedError(page.kind);
}

/** Same, by id. */
export function assertUnlockedId(db: DbLike, pageId: string) {
  const row = db.select({ locked: pages.locked, kind: pages.kind }).from(pages).where(eq(pages.id, pageId)).get();
  if (row) assertUnlocked(row);
}
