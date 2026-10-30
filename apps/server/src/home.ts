import { randomUUID } from "node:crypto";
import { and, desc, eq, lt, notInArray } from "drizzle-orm";
import * as Y from "yjs";
import { t, type RecentPage } from "@nootion/shared";
import type { Db } from "./db/index.js";
import { pages, pageVisits, users, workspaceMembers, workspaces } from "./db/schema.js";
import { encodeContent, setProsemirrorJSON, type ProseMirrorNode } from "./collab.js";
import { getPageRole } from "./permissions.js";
import { getPageMeta, toSummary } from "./pages.js";

/** Widgets of a new home page; users then arrange it like any page. */
const DEFAULT_HOME: ProseMirrorNode = {
  type: "doc",
  content: [{ type: "recentPages" }, { type: "upcomingEvents", attrs: { sources: [], days: 14 } }, { type: "favoritesList" }, { type: "paragraph" }],
};

/** Id of the user's home page, created (or created again, if it was deleted) in their personal workspace. */
export function ensureHomePage(db: Db, userId: string): string {
  const user = db.select({ homePageId: users.homePageId }).from(users).where(eq(users.id, userId)).get();
  if (user?.homePageId && getPageRole(db, userId, user.homePageId)) return user.homePageId;
  const personal = db
    .select({ id: workspaces.id })
    .from(workspaces)
    .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaces.kind, "personal")))
    .get();
  if (!personal) throw new Error("No personal workspace");
  const doc = new Y.Doc();
  setProsemirrorJSON(doc, DEFAULT_HOME);
  const { state, json, text } = encodeContent(doc);
  const id = randomUUID();
  db.transaction((tx) => {
    tx.insert(pages)
      .values({
        id,
        workspaceId: personal.id,
        parentId: null,
        title: t("home.title"),
        icon: "🏠",
        position: -1,
        createdBy: userId,
        contentState: state,
        contentJson: json,
        contentText: text,
      })
      .run();
    tx.update(users).set({ homePageId: id }).where(eq(users.id, userId)).run();
  });
  return id;
}

export function homePageOf(db: Db, userId: string): string | null {
  return db.select({ homePageId: users.homePageId }).from(users).where(eq(users.id, userId)).get()?.homePageId ?? null;
}

/** How many visits are kept per user. */
const KEPT_VISITS = 100;

export function recordVisit(db: Db, userId: string, pageId: string) {
  const now = new Date();
  db.insert(pageVisits)
    .values({ userId, pageId, visitedAt: now })
    .onConflictDoUpdate({ target: [pageVisits.userId, pageVisits.pageId], set: { visitedAt: now } })
    .run();
  // Now and then, forget the oldest ones.
  if (Math.random() < 0.05) {
    const keep = db
      .select({ pageId: pageVisits.pageId })
      .from(pageVisits)
      .where(eq(pageVisits.userId, userId))
      .orderBy(desc(pageVisits.visitedAt))
      .limit(KEPT_VISITS)
      .all();
    db.delete(pageVisits)
      .where(
        and(
          eq(pageVisits.userId, userId),
          notInArray(
            pageVisits.pageId,
            keep.map((k) => k.pageId),
          ),
          lt(pageVisits.visitedAt, now),
        ),
      )
      .run();
  }
}

/** Pages the user opened lately, most recent first: those still readable and out of the trash, home page aside. */
export function recentPages(db: Db, userId: string, limit: number): RecentPage[] {
  const home = homePageOf(db, userId);
  const visits = db.select().from(pageVisits).where(eq(pageVisits.userId, userId)).orderBy(desc(pageVisits.visitedAt)).limit(KEPT_VISITS).all();
  const result: RecentPage[] = [];
  for (const v of visits) {
    if (result.length >= limit) break;
    if (v.pageId === home || !getPageRole(db, userId, v.pageId)) continue;
    const page = getPageMeta(db, v.pageId);
    if (page) result.push({ ...toSummary(page), cover: page.cover, coverPosition: page.coverPosition, visitedAt: v.visitedAt.toISOString() });
  }
  return result;
}
