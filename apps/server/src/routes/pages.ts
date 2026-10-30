import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import {

  createPageInput,
  movePageInput,
  publicLinkInput,
  sharePageInput,
  updatePageInput,
  type PageShare,
  type PageSummary,
  type PublicLinkInfo,
} from "@nootion/shared";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { newToken } from "../auth/tokens.js";
import { attachments, pagePermissions, pages, publicLinks, users, workspaceMembers } from "../db/schema.js";
import { HttpError, notFound, parseBody, requireUser } from "../http.js";
import {
  CAN_CREATE_ROOT_PAGES,
  getChain,
  getPageRole,
  getWorkspaceRole,
  isTrashed,
  requirePageRole,
  requireWorkspaceRole,
} from "../permissions.js";
import { breadcrumbFor, getPageMeta, notRow, pageMeta, listDescendants, nextPosition, placeAmongSiblings, sortPages, toDetail, toSummary } from "../pages.js";
import { t } from "@nootion/shared";
import { homePageOf, recordVisit } from "../home.js";
import { copyTree } from "../templates.js";
import { syncReminders } from "../reminders.js";
import { listBacklinks } from "../backlinks.js";
import { getSnapshot, listVersions, recordAgentVersion, recordSnapshot } from "../history.js";
import { appendContent, linkChildPage, readContent, writeContent, type ProseMirrorNode } from "../collab.js";
import { toMarkdown } from "../markdown.js";
import { fromAutomation, rowSnapshot } from "../automations.js";
import { checkContent, parseMarkdown } from "../markdown-in.js";

const contentBody = z.object({ markdown: z.string().max(2_000_000).optional(), content: z.unknown().optional() }).passthrough();

export const pageRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  app.post("/", async (req) => {
    const user = requireUser(req);
    const input = parseBody(createPageInput, req.body);
    if (input.parentId) {
      const { page: parent } = requirePageRole(db, user.id, input.parentId, "editor");
      if (parent.workspaceId !== input.workspaceId) throw notFound();
      if (parent.kind === "database") throw new HttpError(400, "database_parent", t("error.addRowInstead"));
    } else {
      requireWorkspaceRole(db, user.id, input.workspaceId, CAN_CREATE_ROOT_PAGES);
    }
    const page = db
      .insert(pages)
      .values({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        parentId: input.parentId,
        title: input.title,
        icon: input.icon ?? null,
        position: nextPosition(db, input.workspaceId, input.parentId),
        createdBy: user.id,
      })
      .returning()
      .get();
    // Content given at once (API): Markdown or editor JSON.
    const body = contentInput(req.body, user.id, true);
    if (body) {
      await writeContent(app.collab, db, page.id, body);
      recordAgentVersion(db, page.id, readContent(app.collab, db, page.id), user.id);
    }
    if (page.parentId && input.linkInParent) await linkChildPage(app.collab, db, page.parentId, page);
    return { page: toSummary(page) };
  });

  /** Content sent through the API: `markdown`, or `content` as the editor's JSON. Null when neither is given. */
  const contentInput = (raw: unknown, userId: string, optional = false): ProseMirrorNode | null => {
    const input = parseBody(contentBody, raw ?? {});
    if (input.markdown !== undefined) return parseMarkdown(input.markdown);
    if (input.content !== undefined) {
      try {
        return checkContent(input.content, userId);
      } catch (e) {
        throw new HttpError(400, "bad_content", t("error.badContent", { reason: (e as Error).message }));
      }
    }
    if (optional) return null;
    throw new HttpError(400, "invalid_input", t("error.contentMissing"));
  };

  // A page's content, as Markdown and as the editor's JSON (what people are typing included).
  app.get<{ Params: { id: string } }>("/:id/content", async (req) => {
    const user = requireUser(req);
    const { page } = requirePageRole(db, user.id, req.params.id, "viewer");
    if (page.kind === "database") throw new HttpError(400, "not_a_page", t("error.notAPage"));
    const content = readContent(app.collab, db, page.id);
    const base = app.config.appUrl;
    const markdown = toMarkdown(content, { file: (id) => `${base}/api/attachments/${id}`, page: (id) => `${base}/page/${id}` });
    return { id: page.id, title: page.title, markdown, content };
  });

  // Replaces the content (PUT) or adds to its end (POST).
  app.put<{ Params: { id: string } }>("/:id/content", async (req) => {
    const user = requireUser(req);
    const { page } = requirePageRole(db, user.id, req.params.id, "editor");
    if (page.kind === "database") throw new HttpError(400, "not_a_page", t("error.notAPage"));
    const doc = contentInput(req.body, user.id)!;
    recordSnapshot(db, page.id, { content: readContent(app.collab, db, page.id), force: true });
    await writeContent(app.collab, db, page.id, doc);
    recordAgentVersion(db, page.id, readContent(app.collab, db, page.id), user.id);
    db.update(pages).set({ updatedAt: new Date() }).where(eq(pages.id, page.id)).run();
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/:id/content", async (req) => {
    const user = requireUser(req);
    const { page } = requirePageRole(db, user.id, req.params.id, "editor");
    if (page.kind === "database") throw new HttpError(400, "not_a_page", t("error.notAPage"));
    const doc = contentInput(req.body, user.id)!;
    await appendContent(app.collab, db, page.id, doc.content ?? []);
    recordAgentVersion(db, page.id, readContent(app.collab, db, page.id), user.id);
    db.update(pages).set({ updatedAt: new Date() }).where(eq(pages.id, page.id)).run();
    return { ok: true };
  });

  /**
   * Pages shared directly with the user, outside the workspaces they belong to, with their subpages.
   * Roots are the topmost shared pages (a shared page inside another shared page is not repeated).
   */
  app.get("/shared", async (req) => {
    const user = requireUser(req);
    const memberOf = new Set(
      db.select({ id: workspaceMembers.workspaceId }).from(workspaceMembers).where(eq(workspaceMembers.userId, user.id)).all().map((r) => r.id),
    );
    const grants = db
      .select({ pageId: pagePermissions.pageId, workspaceId: pages.workspaceId })
      .from(pagePermissions)
      .innerJoin(pages, eq(pages.id, pagePermissions.pageId))
      .where(eq(pagePermissions.userId, user.id))
      .all()
      .filter((g) => !memberOf.has(g.workspaceId));
    const grantedIds = new Set(grants.map((g) => g.pageId));

    const roots: string[] = [];
    for (const g of grants) {
      const chain = getChain(db, g.pageId);
      if (isTrashed(chain)) continue;
      if (chain.slice(1).some((c) => grantedIds.has(c.id))) continue;
      roots.push(g.pageId);
    }
    const result: (PageSummary & { shared: boolean })[] = [];
    for (const id of roots) {
      const root = getPageMeta(db, id)!;
      result.push({ ...toSummary(root), parentId: null, shared: true });
      for (const d of listDescendants(db, id).filter(notRow)) result.push({ ...toSummary(d), shared: false });
    }
    return { pages: result };
  });

  // Page templates the user can read, in all their spaces.
  app.get("/templates", async (req) => {
    const user = requireUser(req);
    const rows = db
      .select(pageMeta)
      .from(pages)
      .where(and(eq(pages.template, true), eq(pages.kind, "page"), isNull(pages.deletedAt)))
      .all();
    return { pages: sortPages(rows.filter((p) => getPageRole(db, user.id, p.id))).map(toSummary) };
  });

  // Fills a page with a copy of a template: its content, cover and icon, and its subpages and databases.
  app.post<{ Params: { id: string } }>("/:id/apply-template", async (req) => {
    const user = requireUser(req);
    const { templateId } = parseBody(z.object({ templateId: z.string().min(1) }), req.body);
    const { page, chain } = requirePageRole(db, user.id, req.params.id, "editor");
    const { page: template } = requirePageRole(db, user.id, templateId, "viewer");
    if (page.kind !== "page" || !template.template || template.kind !== "page" || chain.some((c) => c.id === template.id)) {
      throw new HttpError(400, "bad_template", t("error.badTemplate"));
    }
    await copyTree(
      db,
      app.collab,
      app.config.dataDir,
      template.id,
      { workspaceId: page.workspaceId, parentId: page.id, position: 0, userId: user.id },
      { pageId: page.id, title: page.title, icon: page.icon, cover: page.cover },
    );
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>("/:id/backlinks", async (req) => {
    const user = requireUser(req);
    requirePageRole(db, user.id, req.params.id, "viewer");
    return { pages: listBacklinks(db, user.id, req.params.id) };
  });

  // --- History ---

  app.get<{ Params: { id: string } }>("/:id/history", async (req) => {
    const user = requireUser(req);
    requirePageRole(db, user.id, req.params.id, "viewer");
    return { versions: listVersions(db, req.params.id) };
  });

  app.get<{ Params: { id: string; versionId: string } }>("/:id/history/:versionId", async (req) => {
    const user = requireUser(req);
    requirePageRole(db, user.id, req.params.id, "viewer");
    const snapshot = getSnapshot(db, req.params.id, req.params.versionId);
    if (!snapshot) throw notFound();
    return { content: snapshot.content, title: snapshot.title };
  });

  // Puts an older version back. The current content is saved as a version first, so nothing is lost.
  app.post<{ Params: { id: string; versionId: string } }>("/:id/history/:versionId/restore", async (req) => {
    const user = requireUser(req);
    const { page } = requirePageRole(db, user.id, req.params.id, "editor");
    if (page.kind === "database") throw notFound();
    const snapshot = getSnapshot(db, req.params.id, req.params.versionId);
    if (!snapshot) throw notFound();
    const current = db.select({ content: pages.contentJson }).from(pages).where(eq(pages.id, page.id)).get();
    if (current?.content) recordSnapshot(db, page.id, { content: current.content as ProseMirrorNode, force: true });
    await writeContent(app.collab, db, page.id, snapshot.content as ProseMirrorNode);
    db.update(pages).set({ title: snapshot.title, updatedAt: new Date() }).where(eq(pages.id, page.id)).run();
    recordSnapshot(db, page.id, { content: snapshot.content as ProseMirrorNode, authors: [user.id], force: true, restoredFrom: snapshot.createdAt });
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>("/:id", async (req) => {
    const user = requireUser(req);
    const { page, chain, role } = requirePageRole(db, user.id, req.params.id, "viewer");
    const isMember = getWorkspaceRole(db, user.id, page.workspaceId) !== null;
    let visibleFrom = chain.length; // ancestors at index < visibleFrom are visible
    if (!isMember) {
      const shared = new Set(
        db
          .select({ id: pagePermissions.pageId })
          .from(pagePermissions)
          .where(and(eq(pagePermissions.userId, user.id), inArray(pagePermissions.pageId, chain.map((c) => c.id))))
          .all()
          .map((r) => r.id),
      );
      visibleFrom = Math.max(...chain.map((c, i) => (shared.has(c.id) ? i + 1 : 0)));
    }
    const breadcrumb = breadcrumbFor(chain, (c) => chain.indexOf(c) < visibleFrom);
    // Scripts reading pages with a token don't fill "Recently visited".
    if (!req.tokenScope) recordVisit(db, user.id, page.id);
    return { page: toDetail(page, role, breadcrumb, homePageOf(db, user.id) === page.id) };
  });

  app.patch<{ Params: { id: string } }>("/:id", async (req) => {
    const user = requireUser(req);
    const input = parseBody(updatePageInput, req.body);
    const { page: current } = requirePageRole(db, user.id, req.params.id, "editor");
    if (input.template !== undefined && current.kind !== "page") throw new HttpError(400, "not_a_page", t("error.templateKind"));
    // An uploaded cover must be a file of this page: its access follows the page's.
    const coverFile = input.cover?.match(/^\/api\/attachments\/(.+)$/)?.[1];
    if (coverFile && db.select({ pageId: attachments.pageId }).from(attachments).where(eq(attachments.id, coverFile)).get()?.pageId !== req.params.id) {
      throw new HttpError(400, "bad_cover", t("error.badCover"));
    }
    // A row's title is one of its database's columns: automations may watch it.
    const rowBefore = current.kind === "row" && current.parentId && input.title !== undefined ? rowSnapshot(db, current.parentId, current.id) : null;
    const page = db
      .update(pages)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(pages.id, req.params.id))
      .returning(pageMeta)
      .get();
    // A template's dates remind nobody; they come back when it is a page again.
    if (input.template !== undefined) {
      syncReminders(db, page.id, db.select({ json: pages.contentJson }).from(pages).where(eq(pages.id, page.id)).get()?.json as ProseMirrorNode | null);
    }
    if (rowBefore && current.parentId && !fromAutomation(req)) {
      const after = rowSnapshot(db, current.parentId, current.id);
      if (after) await app.automations.rowChanged({ databaseId: current.parentId, rowId: current.id, before: rowBefore, after });
    }
    return { page: toSummary(page) };
  });

  app.post<{ Params: { id: string } }>("/:id/move", async (req) => {
    const user = requireUser(req);
    const input = parseBody(movePageInput, req.body);
    const { page } = requirePageRole(db, user.id, req.params.id, "full");
    if (page.kind === "row") throw new HttpError(400, "row_move", t("error.rowMove"));
    if (input.parentId) {
      const { page: parent, chain } = requirePageRole(db, user.id, input.parentId, "editor");
      if (parent.workspaceId !== page.workspaceId) throw notFound();
      if (parent.kind === "database") throw new HttpError(400, "database_parent", t("error.moveIntoDatabase"));
      if (chain.some((c) => c.id === page.id)) {
        throw new HttpError(400, "cycle", t("error.moveCycle"));
      }
    } else {
      requireWorkspaceRole(db, user.id, page.workspaceId, CAN_CREATE_ROOT_PAGES);
    }
    db.transaction((tx) => {
      tx.update(pages).set({ parentId: input.parentId }).where(eq(pages.id, page.id)).run();
      const moved = getPageMeta(tx, page.id)!;
      placeAmongSiblings(tx, moved, input.index);
    });
    return { page: toSummary(getPageMeta(db, page.id)!) };
  });

  // Moves the page (and its subpages) to the trash.
  app.delete<{ Params: { id: string } }>("/:id", async (req) => {
    const user = requireUser(req);
    requirePageRole(db, user.id, req.params.id, "full");
    if (homePageOf(db, user.id) === req.params.id) throw new HttpError(400, "home_page", t("error.homePage"));
    db.update(pages).set({ deletedAt: new Date(), deletedBy: user.id }).where(eq(pages.id, req.params.id)).run();
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/:id/restore", async (req) => {
    const user = requireUser(req);
    const { page, chain } = requirePageRole(db, user.id, req.params.id, "full", { includeTrashed: true });
    if (!page.deletedAt) throw new HttpError(400, "not_trashed", t("error.notInTrash"));
    // If an ancestor is itself in the trash, the page comes back at the root of its workspace.
    const parentTrashed = isTrashed(chain.slice(1));
    db.transaction((tx) => {
      tx.update(pages)
        .set({ deletedAt: null, deletedBy: null, ...(parentTrashed ? { parentId: null } : {}) })
        .where(eq(pages.id, page.id))
        .run();
      if (parentTrashed) placeAmongSiblings(tx, getPageMeta(tx, page.id)!, undefined);
    });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/:id/permanent", async (req) => {
    const user = requireUser(req);
    const { page } = requirePageRole(db, user.id, req.params.id, "full", { includeTrashed: true });
    if (!page.deletedAt) throw new HttpError(400, "not_trashed", t("error.trashFirst"));
    const ids = [page.id, ...listDescendants(db, page.id, { includeTrashed: true }).map((p) => p.id)];
    db.delete(pages).where(inArray(pages.id, ids)).run();
    return { ok: true };
  });

  // --- Sharing ---

  app.get<{ Params: { id: string } }>("/:id/shares", async (req) => {
    const user = requireUser(req);
    const { chain } = requirePageRole(db, user.id, req.params.id, "viewer");
    const rows = db
      .select({ pageId: pagePermissions.pageId, userId: users.id, name: users.name, email: users.email, role: pagePermissions.role })
      .from(pagePermissions)
      .innerJoin(users, eq(users.id, pagePermissions.userId))
      .where(inArray(pagePermissions.pageId, chain.map((c) => c.id)))
      .all();
    // Closest grant wins for display (the effective role is still the best of all of them).
    const depth = new Map(chain.map((c, i) => [c.id, i]));
    rows.sort((a, b) => depth.get(a.pageId)! - depth.get(b.pageId)!);
    const seen = new Set<string>();
    const shares: PageShare[] = [];
    for (const r of rows) {
      if (seen.has(r.userId)) continue;
      seen.add(r.userId);
      const from = chain[depth.get(r.pageId)!];
      shares.push({
        userId: r.userId,
        name: r.name,
        email: r.email,
        role: r.role,
        inheritedFrom: from.id === req.params.id ? null : { id: from.id, title: from.title },
      });
    }
    return { shares };
  });

  app.put<{ Params: { id: string } }>("/:id/shares", async (req) => {
    const user = requireUser(req);
    const input = parseBody(sharePageInput, req.body);
    requirePageRole(db, user.id, req.params.id, "full");
    const target = db.select().from(users).where(eq(users.id, input.userId)).get();
    if (!target || target.disabled) throw new HttpError(404, "user_not_found", t("error.userNotFound"));
    db.insert(pagePermissions)
      .values({ pageId: req.params.id, userId: input.userId, role: input.role, grantedBy: user.id })
      .onConflictDoUpdate({ target: [pagePermissions.pageId, pagePermissions.userId], set: { role: input.role, grantedBy: user.id } })
      .run();
    return { ok: true };
  });

  app.delete<{ Params: { id: string; userId: string } }>("/:id/shares/:userId", async (req) => {
    const user = requireUser(req);
    requirePageRole(db, user.id, req.params.id, "full");
    db.delete(pagePermissions)
      .where(and(eq(pagePermissions.pageId, req.params.id), eq(pagePermissions.userId, req.params.userId)))
      .run();
    return { ok: true };
  });

  // --- Public link ---

  const linkInfo = (l: typeof publicLinks.$inferSelect): PublicLinkInfo => ({
    token: l.token,
    includeSubpages: l.includeSubpages,
    url: `${app.config.appUrl}/p/${l.token}`,
  });

  app.get<{ Params: { id: string } }>("/:id/public-link", async (req) => {
    const user = requireUser(req);
    requirePageRole(db, user.id, req.params.id, "full");
    const link = db.select().from(publicLinks).where(eq(publicLinks.pageId, req.params.id)).get();
    return { link: link ? linkInfo(link) : null };
  });

  app.put<{ Params: { id: string } }>("/:id/public-link", async (req) => {
    const user = requireUser(req);
    const input = parseBody(publicLinkInput, req.body);
    requirePageRole(db, user.id, req.params.id, "full");
    const link = db
      .insert(publicLinks)
      .values({ pageId: req.params.id, token: newToken(), includeSubpages: input.includeSubpages, createdBy: user.id })
      .onConflictDoUpdate({ target: publicLinks.pageId, set: { includeSubpages: input.includeSubpages } })
      .returning()
      .get();
    return { link: linkInfo(link) };
  });

  app.delete<{ Params: { id: string } }>("/:id/public-link", async (req) => {
    const user = requireUser(req);
    requirePageRole(db, user.id, req.params.id, "full");
    db.delete(publicLinks).where(eq(publicLinks.pageId, req.params.id)).run();
    return { ok: true };
  });
};

