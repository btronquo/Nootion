import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { atLeast, iconText, tIn, type CommentNotification, type Locale } from "@nootion/shared";
import { pageMentions, pages, users } from "./db/schema.js";
import type { Db } from "./db/index.js";
import { prosemirrorToText, type ProseMirrorNode } from "./collab.js";
import { getPageRole } from "./permissions.js";

const EXCERPT = 200;

interface Found {
  mentionId: string;
  userId: string;
  by: string | null;
  excerpt: string;
}

/** People mentioned in a page's content, each with the line they are in. */
export function findMentions(content: ProseMirrorNode | null | undefined): Found[] {
  const out: Found[] = [];
  const walk = (node: ProseMirrorNode, block: ProseMirrorNode) => {
    if (node.type === "userMention") {
      const a = node.attrs ?? {};
      if (typeof a.id === "string" && a.id && typeof a.userId === "string" && a.userId)
        out.push({
          mentionId: a.id,
          userId: a.userId,
          by: typeof a.by === "string" ? a.by : null,
          excerpt: prosemirrorToText(block).replace(/\s+/g, " ").trim().slice(0, EXCERPT),
        });
      return;
    }
    const inline = node.content?.some((c) => c.type === "text" || c.type === "userMention");
    for (const c of node.content ?? []) walk(c, inline ? node : c);
  };
  if (content) walk(content, content);
  return out;
}

/**
 * Tells people newly mentioned in a page (once per mention) that can read it, unless they mentioned themselves.
 * Templates tell nobody: the pages made from them do.
 */
export async function syncMentions(app: FastifyInstance, pageId: string, content: ProseMirrorNode | null | undefined) {
  const { db } = app;
  const page = db.select({ title: pages.title, icon: pages.icon, template: pages.template }).from(pages).where(eq(pages.id, pageId)).get();
  if (!page || page.template) return;
  const found = findMentions(content);
  if (!found.length) return;
  const known = new Set(
    db
      .select({ mentionId: pageMentions.mentionId })
      .from(pageMentions)
      .where(
        and(
          eq(pageMentions.pageId, pageId),
          inArray(
            pageMentions.mentionId,
            found.map((f) => f.mentionId),
          ),
        ),
      )
      .all()
      .map((r) => r.mentionId),
  );
  for (const f of found) {
    if (known.has(f.mentionId)) continue;
    known.add(f.mentionId);
    // Only someone who can write here can have written the mention.
    const actorId = f.by && atLeast(getPageRole(db, f.by, pageId), "editor") ? f.by : null;
    const target = db.select({ locale: users.locale, disabled: users.disabled }).from(users).where(eq(users.id, f.userId)).get();
    if (!target || target.disabled || actorId === f.userId || !atLeast(getPageRole(db, f.userId, pageId), "viewer")) continue;
    const inserted = db
      .insert(pageMentions)
      .values({ id: randomUUID(), pageId, mentionId: f.mentionId, userId: f.userId, actorId, excerpt: f.excerpt })
      .onConflictDoNothing()
      .returning({ id: pageMentions.id })
      .get();
    if (!inserted) continue;
    const locale = target.locale as Locale;
    const actor = actorId ? db.select({ name: users.name }).from(users).where(eq(users.id, actorId)).get()?.name : null;
    await app.notifier.push(f.userId, {
      title: tIn(locale, "mentions.push", {
        name: actor ?? tIn(locale, "mentions.someone"),
        page: `${iconText(page.icon)}${page.title || tIn(locale, "common.untitled")}`,
      }),
      body: f.excerpt,
      url: `/page/${pageId}`,
      tag: inserted.id,
    });
  }
}

/** The user's latest mentions in pages they can still read, as notifications. */
export function listPageMentions(db: Db, userId: string, locale: Locale): CommentNotification[] {
  return db
    .select({ m: pageMentions, title: pages.title, icon: pages.icon, actor: users.name })
    .from(pageMentions)
    .innerJoin(pages, eq(pages.id, pageMentions.pageId))
    .leftJoin(users, eq(users.id, pageMentions.actorId))
    .where(and(eq(pageMentions.userId, userId), isNull(pages.deletedAt)))
    .orderBy(desc(pageMentions.createdAt))
    .limit(50)
    .all()
    .filter((r) => atLeast(getPageRole(db, userId, r.m.pageId), "viewer"))
    .map((r) => ({
      id: r.m.id,
      kind: "page_mention" as const,
      pageId: r.m.pageId,
      pageTitle: r.title,
      pageIcon: r.icon,
      threadId: null,
      actorName: r.actor ?? tIn(locale, "mentions.someone"),
      excerpt: r.m.excerpt,
      createdAt: r.m.createdAt.toISOString(),
      read: !!r.m.readAt,
    }));
}
