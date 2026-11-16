import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { atLeast, iconText, tIn, type CommentNotification, type Locale } from "@nootion/shared";
import { groups, pageMentions, pages, users } from "./db/schema.js";
import { groupMemberIds } from "./groups.js";
import type { Db } from "./db/index.js";
import { prosemirrorToText, type ProseMirrorNode } from "./collab.js";
import { getPageRole } from "./permissions.js";

const EXCERPT = 200;

interface Found {
  mentionId: string;
  /** Someone mentioned, or… */
  userId: string | null;
  /** …a group: everyone in it is told. */
  groupId: string | null;
  by: string | null;
  excerpt: string;
}

/** People and groups mentioned in a page's content, each with the line they are in. */
export function findMentions(content: ProseMirrorNode | null | undefined): Found[] {
  const out: Found[] = [];
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const walk = (node: ProseMirrorNode, block: ProseMirrorNode) => {
    if (node.type === "userMention") {
      const a = node.attrs ?? {};
      const userId = str(a.userId);
      const groupId = userId ? null : str(a.groupId);
      if (str(a.id) && (userId || groupId))
        out.push({
          mentionId: a.id as string,
          userId,
          groupId,
          by: str(a.by),
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
 * Tells people newly mentioned in a page (once per mention) that can read it, unless they mentioned themselves. A
 * group mentioned tells everyone in it who can read the page, once.
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
    const group = f.groupId ? db.select({ name: groups.name }).from(groups).where(eq(groups.id, f.groupId)).get() : undefined;
    if (f.groupId && !group) continue;
    const targets = f.userId ? [f.userId] : groupMemberIds(db, f.groupId!);
    for (const userId of targets) {
      const target = db.select({ locale: users.locale, disabled: users.disabled }).from(users).where(eq(users.id, userId)).get();
      if (!target || target.disabled || actorId === userId || !atLeast(getPageRole(db, userId, pageId), "viewer")) continue;
      const inserted = db
        .insert(pageMentions)
        .values({ id: randomUUID(), pageId, mentionId: f.mentionId, userId, actorId, excerpt: f.excerpt })
        .onConflictDoNothing()
        .returning({ id: pageMentions.id })
        .get();
      if (!inserted) continue;
      const locale = target.locale as Locale;
      const actor = actorId ? db.select({ name: users.name }).from(users).where(eq(users.id, actorId)).get()?.name : null;
      const vars = {
        name: actor ?? tIn(locale, "mentions.someone"),
        page: `${iconText(page.icon)}${page.title || tIn(locale, "common.untitled")}`,
      };
      await app.notifier.push(
        userId,
        {
          title: group ? tIn(locale, "mentions.pushGroup", { ...vars, group: group.name }) : tIn(locale, "mentions.push", vars),
          body: f.excerpt,
          url: `/page/${pageId}`,
          tag: inserted.id,
        },
        "mentions",
      );
    }
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
