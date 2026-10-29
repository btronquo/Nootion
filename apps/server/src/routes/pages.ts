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
import { and, eq, inArray } from "drizzle-orm";
import { newToken } from "../auth/tokens.js";
import { attachments, pagePermissions, pages, publicLinks, users, workspaceMembers } from "../db/schema.js";
import { HttpError, notFound, parseBody, requireUser } from "../http.js";
import {
  CAN_CREATE_ROOT_PAGES,
  getChain,
  getWorkspaceRole,
  isTrashed,
  requirePageRole,
  requireWorkspaceRole,
} from "../permissions.js";
import { breadcrumbFor, getPageMeta, notRow, pageMeta, listDescendants, nextPosition, placeAmongSiblings, toDetail, toSummary } from "../pages.js";
import { t } from "@nootion/shared";

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
    return { page: toSummary(page) };
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
    return { page: toDetail(page, role, breadcrumb) };
  });

  app.patch<{ Params: { id: string } }>("/:id", async (req) => {
    const user = requireUser(req);
    const input = parseBody(updatePageInput, req.body);
    requirePageRole(db, user.id, req.params.id, "editor");
    // An uploaded cover must be a file of this page: its access follows the page's.
    const coverFile = input.cover?.match(/^\/api\/attachments\/(.+)$/)?.[1];
    if (coverFile && db.select({ pageId: attachments.pageId }).from(attachments).where(eq(attachments.id, coverFile)).get()?.pageId !== req.params.id) {
      throw new HttpError(400, "bad_cover", t("error.badCover"));
    }
    const page = db
      .update(pages)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(pages.id, req.params.id))
      .returning(pageMeta)
      .get();
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
    if (!target || target.disabled) throw new HttpError(404, "user_not_found", "Utilisateur introuvable.");
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

