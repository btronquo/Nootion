import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  atLeast,
  commentBodyInput,
  commentMentions,
  commentPlainText,
  createThreadInput,
  resolveThreadInput,
  t,
  tIn,
  type CommentNotification,
  type CommentThread,
  type Locale,
} from "@nootion/shared";
import { commentNotifications, comments, commentThreads, pages, users } from "../db/schema.js";
import { HttpError, notFound, parseBody, requireUser } from "../http.js";
import { getPageRole, requirePageRole } from "../permissions.js";
import { avatarUrl } from "../users.js";
import type { Db } from "../db/index.js";

const EXCERPT = 200;

/** Comment threads on pages, their replies, and the notifications they send to the people concerned. */
export const commentRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  /** Reading needs the page; writing needs at least the "commenter" role. */
  function pageAccess(userId: string, pageId: string, write: boolean) {
    const access = requirePageRole(db, userId, pageId, "viewer");
    if (access.page.kind === "database") throw new HttpError(400, "not_a_page", t("error.notAPage"));
    if (write && !atLeast(access.role, "commenter")) throw new HttpError(403, "forbidden", t("error.cannotComment"));
    return access;
  }

  function threadOf(threadId: string) {
    const thread = db.select().from(commentThreads).where(eq(commentThreads.id, threadId)).get();
    if (!thread) throw notFound();
    return thread;
  }

  app.get<{ Params: { pageId: string } }>("/pages/:pageId/comments", async (req) => {
    const user = requireUser(req);
    pageAccess(user.id, req.params.pageId, false);
    return { threads: listThreads(db, req.params.pageId) };
  });

  app.post<{ Params: { pageId: string } }>("/pages/:pageId/comments", async (req) => {
    const user = requireUser(req);
    const { page } = pageAccess(user.id, req.params.pageId, true);
    const input = parseBody(createThreadInput, req.body);
    const id = randomUUID();
    db.insert(commentThreads)
      .values({ id, pageId: page.id, anchorStart: input.anchor?.start ?? null, anchorEnd: input.anchor?.end ?? null, quote: input.anchor ? input.quote : "" })
      .run();
    await addComment(id, user.id, input.body);
    return { thread: listThreads(db, page.id, id)[0] };
  });

  app.post<{ Params: { threadId: string } }>("/comments/threads/:threadId/replies", async (req) => {
    const user = requireUser(req);
    const thread = threadOf(req.params.threadId);
    pageAccess(user.id, thread.pageId, true);
    const { body } = parseBody(commentBodyInput, req.body);
    // Answering a resolved thread opens it again.
    if (thread.resolvedAt) db.update(commentThreads).set({ resolvedAt: null, resolvedBy: null }).where(eq(commentThreads.id, thread.id)).run();
    await addComment(thread.id, user.id, body);
    return { thread: listThreads(db, thread.pageId, thread.id)[0] };
  });

  app.post<{ Params: { threadId: string } }>("/comments/threads/:threadId/resolve", async (req) => {
    const user = requireUser(req);
    const thread = threadOf(req.params.threadId);
    pageAccess(user.id, thread.pageId, true);
    const { resolved } = parseBody(resolveThreadInput, req.body);
    db.update(commentThreads)
      .set(resolved ? { resolvedAt: new Date(), resolvedBy: user.id } : { resolvedAt: null, resolvedBy: null })
      .where(eq(commentThreads.id, thread.id))
      .run();
    return { thread: listThreads(db, thread.pageId, thread.id)[0] };
  });

  /** Only its author changes or deletes a comment. */
  function ownComment(userId: string, commentId: string) {
    const comment = db.select().from(comments).where(eq(comments.id, commentId)).get();
    if (!comment) throw notFound();
    const thread = threadOf(comment.threadId);
    pageAccess(userId, thread.pageId, true);
    if (comment.authorId !== userId) throw new HttpError(403, "forbidden", t("error.notYourComment"));
    return { comment, thread };
  }

  app.patch<{ Params: { id: string } }>("/comments/:id", async (req) => {
    const user = requireUser(req);
    const { comment, thread } = ownComment(user.id, req.params.id);
    const { body } = parseBody(commentBodyInput, req.body);
    db.update(comments).set({ body, editedAt: new Date() }).where(eq(comments.id, comment.id)).run();
    // Only the people newly mentioned hear about it.
    await notify(comment.id, user.id, body, thread.id, { reply: false, skip: commentMentions(comment.body) });
    return { thread: listThreads(db, thread.pageId, thread.id)[0] };
  });

  // The last comment of a thread takes the thread with it.
  app.delete<{ Params: { id: string } }>("/comments/:id", async (req) => {
    const user = requireUser(req);
    const { comment, thread } = ownComment(user.id, req.params.id);
    db.delete(comments).where(eq(comments.id, comment.id)).run();
    const left = db.select({ id: comments.id }).from(comments).where(eq(comments.threadId, thread.id)).get();
    if (!left) db.delete(commentThreads).where(eq(commentThreads.id, thread.id)).run();
    return { thread: left ? listThreads(db, thread.pageId, thread.id)[0] : null };
  });

  app.get("/comments/notifications", async (req) => {
    const user = requireUser(req);
    return { notifications: listNotifications(db, user.id) };
  });

  app.post("/comments/notifications/read", async (req) => {
    const user = requireUser(req);
    const { ids } = parseBody(z.object({ ids: z.array(z.string()).max(500).optional() }), req.body ?? {});
    db.update(commentNotifications)
      .set({ readAt: new Date() })
      .where(and(eq(commentNotifications.userId, user.id), isNull(commentNotifications.readAt), ids ? inArray(commentNotifications.id, ids) : undefined))
      .run();
    return { ok: true };
  });

  async function addComment(threadId: string, authorId: string, body: string) {
    const reply = !!db.select({ id: comments.id }).from(comments).where(eq(comments.threadId, threadId)).get();
    const id = randomUUID();
    db.insert(comments).values({ id, threadId, authorId, body }).run();
    await notify(id, authorId, body, threadId, { reply, skip: [] });
  }

  /**
   * Tells the people mentioned (and not already told for this comment), and on a reply, the others taking part in the
   * thread. Only people who can read the page, never the author.
   */
  async function notify(commentId: string, authorId: string, body: string, threadId: string, opts: { reply: boolean; skip: string[] }) {
    const thread = threadOf(threadId);
    const targets = new Map<string, "mention" | "reply">();
    for (const id of commentMentions(body)) if (!opts.skip.includes(id)) targets.set(id, "mention");
    if (opts.reply) {
      for (const c of db.select({ authorId: comments.authorId }).from(comments).where(eq(comments.threadId, threadId)).all())
        if (!targets.has(c.authorId)) targets.set(c.authorId, "reply");
    }
    targets.delete(authorId);
    if (!targets.size) return;

    const page = db.select({ title: pages.title, icon: pages.icon }).from(pages).where(eq(pages.id, thread.pageId)).get()!;
    const names = userNames(db);
    const author = names.get(authorId)?.name ?? "?";
    const text = commentPlainText(body, (id) => names.get(id)?.name);
    for (const [userId, kind] of targets) {
      const target = names.get(userId);
      if (!target || !atLeast(getPageRole(db, userId, thread.pageId), "viewer")) continue;
      const inserted = db
        .insert(commentNotifications)
        .values({ id: randomUUID(), userId, commentId, kind })
        .onConflictDoNothing()
        .returning({ id: commentNotifications.id })
        .get();
      if (!inserted) continue;
      const locale = target.locale as Locale;
      await app.notifier.push(userId, {
        title: tIn(locale, kind === "mention" ? "comments.pushMention" : "comments.pushReply", {
          name: author,
          page: `${page.icon ? `${page.icon} ` : ""}${page.title || tIn(locale, "common.untitled")}`,
        }),
        body: text.slice(0, EXCERPT),
        url: `/page/${thread.pageId}?comment=${threadId}`,
        tag: commentId,
      });
    }
  }
};

function userNames(db: Db) {
  return new Map(
    db
      .select({ id: users.id, name: users.name, avatar: users.avatar, locale: users.locale })
      .from(users)
      .all()
      .map((u) => [u.id, u]),
  );
}

/** A page's threads (or one of them), the open ones first, each with its comments in order. */
export function listThreads(db: Db, pageId: string, onlyThread?: string): CommentThread[] {
  const threads = db
    .select()
    .from(commentThreads)
    .where(onlyThread ? and(eq(commentThreads.pageId, pageId), eq(commentThreads.id, onlyThread)) : eq(commentThreads.pageId, pageId))
    .orderBy(asc(commentThreads.createdAt))
    .all();
  if (!threads.length) return [];
  const list = db
    .select()
    .from(comments)
    .where(
      inArray(
        comments.threadId,
        threads.map((th) => th.id),
      ),
    )
    .orderBy(asc(comments.createdAt))
    .all();
  const names = userNames(db);
  return threads
    .map((th) => ({
      id: th.id,
      pageId: th.pageId,
      anchor: th.anchorStart && th.anchorEnd ? { start: th.anchorStart, end: th.anchorEnd } : null,
      quote: th.quote,
      resolvedAt: th.resolvedAt?.toISOString() ?? null,
      resolvedByName: th.resolvedBy ? (names.get(th.resolvedBy)?.name ?? null) : null,
      comments: list
        .filter((c) => c.threadId === th.id)
        .map((c) => {
          const author = names.get(c.authorId);
          return {
            id: c.id,
            authorId: c.authorId,
            authorName: author?.name ?? "?",
            authorAvatarUrl: author ? avatarUrl(author) : null,
            body: c.body,
            createdAt: c.createdAt.toISOString(),
            editedAt: c.editedAt?.toISOString() ?? null,
          };
        }),
    }))
    .sort((a, b) => Number(!!a.resolvedAt) - Number(!!b.resolvedAt));
}

/** The user's latest mentions and replies, on pages they can still read. */
export function listNotifications(db: Db, userId: string): CommentNotification[] {
  const rows = db
    .select({
      n: commentNotifications,
      body: comments.body,
      actorId: comments.authorId,
      threadId: comments.threadId,
      pageId: commentThreads.pageId,
      title: pages.title,
      icon: pages.icon,
    })
    .from(commentNotifications)
    .innerJoin(comments, eq(comments.id, commentNotifications.commentId))
    .innerJoin(commentThreads, eq(commentThreads.id, comments.threadId))
    .innerJoin(pages, eq(pages.id, commentThreads.pageId))
    .where(eq(commentNotifications.userId, userId))
    .orderBy(desc(commentNotifications.createdAt))
    .limit(50)
    .all();
  const names = userNames(db);
  return rows
    .filter((r) => atLeast(getPageRole(db, userId, r.pageId), "viewer"))
    .map((r) => ({
      id: r.n.id,
      kind: r.n.kind,
      pageId: r.pageId,
      pageTitle: r.title,
      pageIcon: r.icon,
      threadId: r.threadId,
      actorName: names.get(r.actorId)?.name ?? "?",
      excerpt: commentPlainText(r.body, (id) => names.get(id)?.name).slice(0, EXCERPT),
      createdAt: r.n.createdAt.toISOString(),
      read: !!r.n.readAt,
    }));
}
