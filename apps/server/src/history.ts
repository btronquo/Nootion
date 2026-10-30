import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { PageVersion } from "@nootion/shared";
import type { Db } from "./db/index.js";
import { pages, pageSnapshots, users } from "./db/schema.js";
import type { ProseMirrorNode } from "./collab.js";
import { currentTokenScope } from "./api-tokens.js";

/** Minimum time between two versions made while editing. */
export const SNAPSHOT_INTERVAL = 10 * 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Saves the page's current content as a version, unless nothing changed since the last one or, while people are
 * still editing (`force` false), the last one is too recent. Returns whether a version was made.
 */
export function recordSnapshot(
  db: Db,
  pageId: string,
  opts: { content: ProseMirrorNode; authors?: Iterable<string>; force?: boolean; restoredFrom?: Date; agent?: string; now?: Date },
): boolean {
  const now = opts.now ?? new Date();
  const page = db.select({ title: pages.title }).from(pages).where(eq(pages.id, pageId)).get();
  if (!page) return false;
  const last = db.select().from(pageSnapshots).where(eq(pageSnapshots.pageId, pageId)).orderBy(desc(pageSnapshots.createdAt)).limit(1).get();
  if (last && !opts.restoredFrom && last.title === page.title && JSON.stringify(last.content) === JSON.stringify(opts.content)) return false;
  if (last && !opts.force && now.getTime() - last.createdAt.getTime() < SNAPSHOT_INTERVAL) return false;
  db.insert(pageSnapshots)
    .values({
      id: randomUUID(),
      pageId,
      title: page.title,
      content: opts.content,
      authors: [...new Set(opts.authors ?? [])],
      restoredFrom: opts.restoredFrom ?? null,
      agent: opts.agent ?? null,
      createdAt: now,
    })
    .run();
  pruneSnapshots(db, pageId, now);
  return true;
}

/**
 * Thins out old versions: all of the last day are kept, then the last one of each day for a month,
 * then the last one of each week.
 */
export function pruneSnapshots(db: Db, pageId: string, now = new Date()) {
  const rows = db
    .select({ id: pageSnapshots.id, createdAt: pageSnapshots.createdAt })
    .from(pageSnapshots)
    .where(eq(pageSnapshots.pageId, pageId))
    .orderBy(desc(pageSnapshots.createdAt))
    .all();
  const seen = new Set<string>();
  const drop: string[] = [];
  for (const r of rows) {
    const age = now.getTime() - r.createdAt.getTime();
    if (age < DAY) continue;
    const bucket = age < 30 * DAY ? `d${Math.floor(r.createdAt.getTime() / DAY)}` : `w${Math.floor(r.createdAt.getTime() / (7 * DAY))}`;
    if (seen.has(bucket)) drop.push(r.id);
    else seen.add(bucket);
  }
  if (drop.length)
    db.delete(pageSnapshots)
      .where(and(eq(pageSnapshots.pageId, pageId), inArray(pageSnapshots.id, drop)))
      .run();
}

export function listVersions(db: Db, pageId: string): PageVersion[] {
  const rows = db
    .select({
      id: pageSnapshots.id,
      createdAt: pageSnapshots.createdAt,
      title: pageSnapshots.title,
      authors: pageSnapshots.authors,
      restoredFrom: pageSnapshots.restoredFrom,
      agent: pageSnapshots.agent,
    })
    .from(pageSnapshots)
    .where(eq(pageSnapshots.pageId, pageId))
    .orderBy(desc(pageSnapshots.createdAt))
    .all();
  const ids = [...new Set(rows.flatMap((r) => r.authors))];
  const names = new Map(
    ids.length
      ? db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, ids))
          .all()
          .map((u) => [u.id, u.name])
      : [],
  );
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    title: r.title,
    authors: r.authors.filter((id) => names.has(id)).map((id) => ({ id, name: names.get(id)! })),
    restoredFrom: r.restoredFrom?.toISOString() ?? null,
    agent: r.agent,
  }));
}

/** After an app or agent wrote a page's content with a token, keeps that content as a version marked with the token's name. */
export function recordAgentVersion(db: Db, pageId: string, content: ProseMirrorNode, userId: string) {
  const scope = currentTokenScope();
  if (scope) recordSnapshot(db, pageId, { content, authors: [userId], agent: scope.name, force: true });
}

export function getSnapshot(db: Db, pageId: string, id: string) {
  return db
    .select()
    .from(pageSnapshots)
    .where(and(eq(pageSnapshots.pageId, pageId), eq(pageSnapshots.id, id)))
    .get();
}
