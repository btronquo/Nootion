import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import {

  createPageInput,
  inviteGuestInput,
  isLocale,
  movePageInput,
  publicLinkInput,
  sharePageGroupInput,
  sharePageInput,
  updatePageInput,
  type Locale,
  type PageGroupShare,
  type PageShare,
  type PendingGuest,
  type PageSummary,
  type PublicLinkInfo,
  tIn,
} from "@nootion/shared";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { hashToken, newToken } from "../auth/tokens.js";
import { guestsAllowed, guestsOff, isGuest } from "../guests.js";
import { INVITATION_TTL_MS } from "./admin.js";
import { protectionInfo, protectionUpdate } from "../public-access.js";
import { attachments, effectivePagePermissions, groups, invitations, pageGroupPermissions, pagePermissions, pages, publicLinks, users } from "../db/schema.js";
import { findGroup, memberCounts, requireGroup } from "../groups.js";
import { HttpError, notFound, parseBody, requireUser } from "../http.js";
import {
  CAN_CREATE_ROOT_PAGES,
  getChain,
  getPageRole,
  getWorkspaceRole,
  isTrashed,
  memberWorkspaceIds,
  requirePageRole,
  requireWorkspaceRole,
} from "../permissions.js";
import { breadcrumbFor, getPageMeta, inTree, pageMeta, listDescendants, nextPosition, placeAmongSiblings, sortPages, toDetail, toSummary } from "../pages.js";
import { t } from "@nootion/shared";
import { homePageOf, recordVisit } from "../home.js";
import { copyTree } from "../templates.js";
import { isSyncedSpace, moveSubtreeToSpace, subtreeIds } from "../spaces-move.js";
import { syncReminders } from "../reminders.js";
import { listBacklinks } from "../backlinks.js";
import { getSnapshot, listVersions, recordAgentVersion, recordSnapshot } from "../history.js";
import { appendContent, hasLinkLine, linkChildPage, unlinkChildPage, readContent, writeContent, type ProseMirrorNode } from "../collab.js";
import { toMarkdown } from "../markdown.js";
import { fromAutomation, rowSnapshot } from "../automations.js";
import { checkContent, parseMarkdown } from "../markdown-in.js";
import { assertUnlocked, lockedError } from "../locks.js";
import { canReadSynced, inlineSyncedBlocks } from "../synced-blocks.js";
import { audit, personTarget } from "../audit.js";

const contentBody = z.object({ markdown: z.string().max(2_000_000).optional(), content: z.unknown().optional() }).passthrough();

/** A page, as the activity log names it. */
const pageTarget = (p: { id: string; title: string }) => ({ type: "page" as const, id: p.id, label: p.title });
const personLabel = (u: { name: string; email: string }) => `${u.name} <${u.email}>`;

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
    // Synced blocks are written out in the Markdown; the JSON keeps them as they are.
    const markdown = toMarkdown(inlineSyncedBlocks(db, content, canReadSynced(db, user.id)), {
      file: (id) => `${base}/api/attachments/${id}`,
      page: (id) => `${base}/page/${id}`,
    });
    return { id: page.id, title: page.title, markdown, content };
  });

  // Replaces the content (PUT) or adds to its end (POST).
  app.put<{ Params: { id: string } }>("/:id/content", async (req) => {
    const user = requireUser(req);
    const { page } = requirePageRole(db, user.id, req.params.id, "editor");
    if (page.kind === "database") throw new HttpError(400, "not_a_page", t("error.notAPage"));
    assertUnlocked(page);
    const doc = contentInput(req.body, user.id)!;
    recordSnapshot(db, page.id, { content: readContent(app.collab, db, page.id), force: true });
    await writeContent(app.collab, db, page.id, doc);
    recordAgentVersion(db, page.id, readContent(app.collab, db, page.id), user.id);
    db.update(pages).set({ updatedAt: new Date(), updatedBy: user.id }).where(eq(pages.id, page.id)).run();
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/:id/content", async (req) => {
    const user = requireUser(req);
    const { page } = requirePageRole(db, user.id, req.params.id, "editor");
    if (page.kind === "database") throw new HttpError(400, "not_a_page", t("error.notAPage"));
    assertUnlocked(page);
    const doc = contentInput(req.body, user.id)!;
    await appendContent(app.collab, db, page.id, doc.content ?? []);
    recordAgentVersion(db, page.id, readContent(app.collab, db, page.id), user.id);
    db.update(pages).set({ updatedAt: new Date(), updatedBy: user.id }).where(eq(pages.id, page.id)).run();
    return { ok: true };
  });

  /**
   * Pages shared directly with the user, outside the workspaces they belong to, with their subpages.
   * Roots are the topmost shared pages (a shared page inside another shared page is not repeated).
   */
  app.get("/shared", async (req) => {
    const user = requireUser(req);
    // Spaces and pages shared with one of the user's groups count as shared with them.
    const memberOf = new Set(memberWorkspaceIds(db, user.id));
    const grants = db
      .selectDistinct({ pageId: effectivePagePermissions.pageId, workspaceId: pages.workspaceId })
      .from(effectivePagePermissions)
      .innerJoin(pages, eq(pages.id, effectivePagePermissions.pageId))
      .where(eq(effectivePagePermissions.userId, user.id))
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
      for (const d of listDescendants(db, id).filter(inTree)) result.push({ ...toSummary(d), shared: false });
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
    assertUnlocked(page);
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

  // Copies a page with its subpages, right after it.
  app.post<{ Params: { id: string } }>("/:id/duplicate", async (req) => {
    const user = requireUser(req);
    const { page } = requirePageRole(db, user.id, req.params.id, "viewer");
    if (page.kind === "row" || page.id === homePageOf(db, user.id)) throw new HttpError(400, "not_a_page", t("error.notAPage"));
    if (page.parentId) requirePageRole(db, user.id, page.parentId, "editor");
    else requireWorkspaceRole(db, user.id, page.workspaceId, CAN_CREATE_ROOT_PAGES);
    const id = await copyTree(db, app.collab, app.config.dataDir, page.id, {
      workspaceId: page.workspaceId,
      parentId: page.parentId,
      position: page.position + 1,
      userId: user.id,
      template: page.template,
    });
    db.transaction((tx) => {
      tx.update(pages)
        .set({ title: page.title ? t("page.copyTitle", { title: page.title }) : "" })
        .where(eq(pages.id, id))
        .run();
      const siblings = sortPages(
        tx
          .select(pageMeta)
          .from(pages)
          .where(and(eq(pages.workspaceId, page.workspaceId), page.parentId ? eq(pages.parentId, page.parentId) : isNull(pages.parentId), isNull(pages.deletedAt)))
          .all(),
      ).filter((p) => p.id !== id);
      placeAmongSiblings(tx, getPageMeta(tx, id)!, siblings.findIndex((p) => p.id === page.id) + 1);
    });
    const copy = getPageMeta(db, id)!;
    if (page.parentId && hasLinkLine(app.collab, db, page.parentId, page.id)) await linkChildPage(app.collab, db, page.parentId, copy);
    return { page: toSummary(copy) };
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
    assertUnlocked(page);
    const snapshot = getSnapshot(db, req.params.id, req.params.versionId);
    if (!snapshot) throw notFound();
    const current = db.select({ content: pages.contentJson }).from(pages).where(eq(pages.id, page.id)).get();
    if (current?.content) recordSnapshot(db, page.id, { content: current.content as ProseMirrorNode, force: true });
    await writeContent(app.collab, db, page.id, snapshot.content as ProseMirrorNode);
    db.update(pages).set({ title: snapshot.title, updatedAt: new Date(), updatedBy: user.id }).where(eq(pages.id, page.id)).run();
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
          .select({ id: effectivePagePermissions.pageId })
          .from(effectivePagePermissions)
          .where(and(eq(effectivePagePermissions.userId, user.id), inArray(effectivePagePermissions.pageId, chain.map((c) => c.id))))
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
    // A locked page keeps its title, icon and cover; the same request may unlock it first.
    const touchesContent = input.title !== undefined || input.icon !== undefined || input.cover !== undefined || input.coverPosition !== undefined;
    if (current.locked && input.locked !== false && touchesContent) throw lockedError(current.kind);
    // An uploaded cover must be a file of this page: its access follows the page's.
    const coverFile = input.cover?.match(/^\/api\/attachments\/(.+)$/)?.[1];
    if (coverFile && db.select({ pageId: attachments.pageId }).from(attachments).where(eq(attachments.id, coverFile)).get()?.pageId !== req.params.id) {
      throw new HttpError(400, "bad_cover", t("error.badCover"));
    }
    // A row's title is one of its database's columns: automations may watch it.
    const rowBefore = current.kind === "row" && current.parentId && input.title !== undefined ? rowSnapshot(db, current.parentId, current.id) : null;
    const page = db
      .update(pages)
      .set({ ...input, updatedAt: new Date(), updatedBy: user.id })
      .where(eq(pages.id, req.params.id))
      .returning(pageMeta)
      .get();
    // Open editors of the page reconnect, and open it read-only (or editable again).
    if (input.locked !== undefined && input.locked !== current.locked) app.collab.closeConnections(page.id);
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
    const from = page.workspaceId;
    const to = input.workspaceId ?? from;
    const crossing = to !== from;
    if (crossing) {
      // Taking a page out of a space takes it away from its members: only those who can organise the space may,
      // not someone it was only shared with. And it goes only into a space where they can add pages.
      const fromRole = getWorkspaceRole(db, user.id, from);
      if (!fromRole || !CAN_CREATE_ROOT_PAGES.includes(fromRole)) {
        throw new HttpError(403, "space_move_source", t("error.moveSpaceSource"));
      }
      requireWorkspaceRole(db, user.id, to, CAN_CREATE_ROOT_PAGES);
      // The desktop app's sync would delete the page from the server's old space before adding it to the new one,
      // losing its history and shares: synced spaces are reorganised on the server, and the app follows.
      if (isSyncedSpace(db, from) || isSyncedSpace(db, to)) throw new HttpError(409, "space_move_synced", t("error.moveSpaceSynced"));
    }
    if (input.parentId) {
      const { page: parent, chain } = requirePageRole(db, user.id, input.parentId, "editor");
      if (parent.workspaceId !== to) throw notFound();
      if (parent.kind === "database") throw new HttpError(400, "database_parent", t("error.moveIntoDatabase"));
      if (chain.some((c) => c.id === page.id)) {
        throw new HttpError(400, "cycle", t("error.moveCycle"));
      }
    } else if (!crossing) {
      requireWorkspaceRole(db, user.id, page.workspaceId, CAN_CREATE_ROOT_PAGES);
    }
    const ids = crossing ? subtreeIds(db, page.id) : [];
    db.transaction((tx) => {
      if (crossing) moveSubtreeToSpace(tx, ids, from, to);
      tx.update(pages).set({ parentId: input.parentId }).where(eq(pages.id, page.id)).run();
      const moved = getPageMeta(tx, page.id)!;
      placeAmongSiblings(tx, moved, input.index);
    });
    // Its link moves with it, as in Notion: out of the old parent, to the end of the new one.
    if (input.parentId !== page.parentId) {
      if (page.parentId) await unlinkChildPage(app.collab, db, page.parentId, page.id);
      if (input.parentId && !hasLinkLine(app.collab, db, input.parentId, page.id)) await linkChildPage(app.collab, db, input.parentId, page);
    }
    // Open editors are checked again: members of the old space who lost access are cut off.
    if (crossing) app.collab.revalidateAll();
    return { page: toSummary(getPageMeta(db, page.id)!), moved: crossing ? ids.length : 0 };
  });

  // Moves the page (and its subpages) to the trash.
  app.delete<{ Params: { id: string } }>("/:id", async (req) => {
    const user = requireUser(req);
    const { page } = requirePageRole(db, user.id, req.params.id, "full");
    if (homePageOf(db, user.id) === req.params.id) throw new HttpError(400, "home_page", t("error.homePage"));
    db.update(pages).set({ deletedAt: new Date(), deletedBy: user.id }).where(eq(pages.id, req.params.id)).run();
    audit(db, req, { action: "page.trashed", target: pageTarget(page) });
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
    audit(db, req, { action: "page.restored", target: pageTarget(page) });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/:id/permanent", async (req) => {
    const user = requireUser(req);
    const { page } = requirePageRole(db, user.id, req.params.id, "full", { includeTrashed: true });
    if (!page.deletedAt) throw new HttpError(400, "not_trashed", t("error.trashFirst"));
    const ids = [page.id, ...listDescendants(db, page.id, { includeTrashed: true }).map((p) => p.id)];
    db.delete(pages).where(inArray(pages.id, ids)).run();
    audit(db, req, { action: "page.deleted", target: { type: "page", id: page.id, label: page.title }, details: { pages: ids.length } });
    return { ok: true };
  });

  // --- Sharing ---

  app.get<{ Params: { id: string } }>("/:id/shares", async (req) => {
    const user = requireUser(req);
    const { chain, role } = requirePageRole(db, user.id, req.params.id, "viewer");
    const rows = db
      .select({ pageId: pagePermissions.pageId, userId: users.id, name: users.name, email: users.email, role: pagePermissions.role, userRole: users.role })
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
        guest: r.userRole === "guest",
        inheritedFrom: from.id === req.params.id ? null : { id: from.id, title: from.title },
      });
    }
    // Guests invited on this page who haven't made their account yet, for those who manage its sharing.
    const pendingGuests: PendingGuest[] =
      role === "full" && !isGuest(user)
        ? db
            .select()
            .from(invitations)
            .where(and(eq(invitations.pageId, req.params.id), eq(invitations.role, "guest"), isNull(invitations.usedAt), gt(invitations.expiresAt, new Date())))
            .orderBy(invitations.createdAt)
            .all()
            .map(toPendingGuest)
        : [];
    // Groups the page is shared with, the closest grant first as for people.
    const groupRows = db
      .select({ pageId: pageGroupPermissions.pageId, groupId: groups.id, name: groups.name, role: pageGroupPermissions.role })
      .from(pageGroupPermissions)
      .innerJoin(groups, eq(groups.id, pageGroupPermissions.groupId))
      .where(inArray(pageGroupPermissions.pageId, chain.map((c) => c.id)))
      .all()
      .sort((a, b) => depth.get(a.pageId)! - depth.get(b.pageId)!);
    const counts = memberCounts(
      db,
      groupRows.map((r) => r.groupId),
    );
    const seenGroups = new Set<string>();
    const groupShares: PageGroupShare[] = [];
    for (const r of groupRows) {
      if (seenGroups.has(r.groupId)) continue;
      seenGroups.add(r.groupId);
      const from = chain[depth.get(r.pageId)!];
      groupShares.push({
        groupId: r.groupId,
        name: r.name,
        memberCount: counts.get(r.groupId) ?? 0,
        role: r.role,
        inheritedFrom: from.id === req.params.id ? null : { id: from.id, title: from.title },
      });
    }
    // A guest sees who else is on the page, not the groups of the team.
    return { shares, groupShares: isGuest(user) ? [] : groupShares, pendingGuests, guestsAllowed: guestsAllowed(db) };
  });

  // Shares the page (and its subpages) with a group, or changes its access.
  app.put<{ Params: { id: string } }>("/:id/group-shares", async (req) => {
    const user = requireUser(req);
    const input = parseBody(sharePageGroupInput, req.body);
    const { page } = requirePageRole(db, user.id, req.params.id, "full");
    const group = requireGroup(db, input.groupId);
    const was = db
      .select({ role: pageGroupPermissions.role })
      .from(pageGroupPermissions)
      .where(and(eq(pageGroupPermissions.pageId, req.params.id), eq(pageGroupPermissions.groupId, input.groupId)))
      .get()?.role;
    if (was !== input.role) audit(db, req, { action: "page.shared", target: pageTarget(page), details: { group: group.name, role: input.role, ...(was && { from: was }) } });
    db.insert(pageGroupPermissions)
      .values({ pageId: req.params.id, groupId: input.groupId, role: input.role, grantedBy: user.id })
      .onConflictDoUpdate({ target: [pageGroupPermissions.pageId, pageGroupPermissions.groupId], set: { role: input.role, grantedBy: user.id } })
      .run();
    return { ok: true };
  });

  app.delete<{ Params: { id: string; groupId: string } }>("/:id/group-shares/:groupId", async (req) => {
    const user = requireUser(req);
    const { page } = requirePageRole(db, user.id, req.params.id, "full");
    const removed = db
      .delete(pageGroupPermissions)
      .where(and(eq(pageGroupPermissions.pageId, req.params.id), eq(pageGroupPermissions.groupId, req.params.groupId)))
      .run().changes;
    if (removed) audit(db, req, { action: "page.unshared", target: pageTarget(page), details: { group: findGroup(db, req.params.groupId)?.name ?? req.params.groupId } });
    return { ok: true };
  });

  app.put<{ Params: { id: string } }>("/:id/shares", async (req) => {
    const user = requireUser(req);
    const input = parseBody(sharePageInput, req.body);
    const { page } = requirePageRole(db, user.id, req.params.id, "full");
    const target = db.select().from(users).where(eq(users.id, input.userId)).get();
    if (!target || target.disabled) throw new HttpError(404, "user_not_found", t("error.userNotFound"));
    if (isGuest(target) && input.role === "full") throw new HttpError(400, "guest_role", t("error.guestRole"));
    db.insert(pagePermissions)
      .values({ pageId: req.params.id, userId: input.userId, role: input.role, grantedBy: user.id })
      .onConflictDoUpdate({ target: [pagePermissions.pageId, pagePermissions.userId], set: { role: input.role, grantedBy: user.id } })
      .run();
    audit(db, req, { action: "page.shared", target: pageTarget(page), details: { with: personLabel(target), role: input.role } });
    return { ok: true };
  });

  app.delete<{ Params: { id: string; userId: string } }>("/:id/shares/:userId", async (req) => {
    const user = requireUser(req);
    const { page } = requirePageRole(db, user.id, req.params.id, "full");
    const removed = db
      .delete(pagePermissions)
      .where(and(eq(pagePermissions.pageId, req.params.id), eq(pagePermissions.userId, req.params.userId)))
      .run().changes;
    if (removed) audit(db, req, { action: "page.unshared", target: pageTarget(page), details: { with: personTarget(db, req.params.userId).label ?? req.params.userId } });
    return { ok: true };
  });

  // --- Guests ---

  const toPendingGuest = (i: typeof invitations.$inferSelect): PendingGuest => ({
    id: i.id,
    email: i.email ?? "",
    role: i.pageRole ?? "viewer",
    expiresAt: i.expiresAt.toISOString(),
  });

  /**
   * "Invite a guest": someone without an account gets a link by e-mail; once their account is made, the page is
   * shared with them, and only it. Someone who already has an account gets the page shared at once.
   */
  app.post<{ Params: { id: string } }>("/:id/guests", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const user = requireUser(req);
    const input = parseBody(inviteGuestInput, req.body);
    const { page } = requirePageRole(db, user.id, req.params.id, "full");
    if (!guestsAllowed(db)) throw guestsOff();
    const existing = db.select().from(users).where(sql`lower(${users.email}) = ${input.email}`).get();
    if (existing) {
      if (existing.disabled) throw new HttpError(404, "user_not_found", t("error.userNotFound"));
      db.insert(pagePermissions)
        .values({ pageId: page.id, userId: existing.id, role: input.role, grantedBy: user.id })
        .onConflictDoUpdate({ target: [pagePermissions.pageId, pagePermissions.userId], set: { role: input.role, grantedBy: user.id } })
        .run();
      audit(db, req, { action: "page.shared", target: pageTarget(page), details: { with: personLabel(existing), role: input.role } });
      return { shared: true };
    }
    // One invitation per address and page: inviting again sends a new link.
    db.delete(invitations)
      .where(and(eq(invitations.pageId, page.id), eq(invitations.email, input.email), isNull(invitations.usedAt)))
      .run();
    const token = newToken();
    const invitation = db
      .insert(invitations)
      .values({
        id: randomUUID(),
        tokenHash: hashToken(token),
        email: input.email,
        role: "guest",
        pageId: page.id,
        pageRole: input.role,
        createdBy: user.id,
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      })
      .returning()
      .get();
    const url = `${app.config.appUrl}/invite/${token}`;
    let emailed = false;
    if (app.mailer.enabled()) {
      const locale = (isLocale(user.locale) ? user.locale : "en") as Locale;
      const title = page.title || tIn(locale, "common.untitled");
      try {
        await app.mailer.send({
          to: input.email,
          subject: tIn(locale, "mail.guestInviteSubject", { name: user.name, title }),
          text: tIn(locale, "mail.guestInviteBody", { name: user.name, title }),
          action: { label: tIn(locale, "mail.guestInviteAction"), url },
          footer: tIn(locale, "mail.inviteFooter"),
        });
        emailed = true;
      } catch (err) {
        req.log.warn({ err }, "Couldn't send a guest invitation e-mail");
      }
    }
    audit(db, req, { action: "page.guest_invited", target: pageTarget(page), details: { email: input.email, role: input.role } });
    // The link is shown once (only its hash is kept), to be sent another way when there is no e-mail.
    return { shared: false, invitation: toPendingGuest(invitation), url, emailed };
  });

  app.delete<{ Params: { id: string; invitationId: string } }>("/:id/guests/:invitationId", async (req) => {
    const user = requireUser(req);
    requirePageRole(db, user.id, req.params.id, "full");
    const gone = db
      .delete(invitations)
      .where(and(eq(invitations.id, req.params.invitationId), eq(invitations.pageId, req.params.id), isNull(invitations.usedAt)))
      .returning()
      .get();
    if (gone) audit(db, req, { action: "user.invitation_revoked", target: { type: "invitation", id: gone.id, label: gone.email }, details: { pageId: req.params.id } });
    return { ok: true };
  });

  // --- Public link ---

  const linkInfo = (l: typeof publicLinks.$inferSelect): PublicLinkInfo => ({
    token: l.token,
    includeSubpages: l.includeSubpages,
    url: `${app.config.appUrl}/p/${l.token}`,
    ...protectionInfo(l),
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
    const { page } = requirePageRole(db, user.id, req.params.id, "full");
    const before = db.select().from(publicLinks).where(eq(publicLinks.pageId, req.params.id)).get();
    const protection = await protectionUpdate(input);
    const changes = { ...protection, ...(input.includeSubpages !== undefined && { includeSubpages: input.includeSubpages }) };
    const link = db
      .insert(publicLinks)
      .values({ pageId: req.params.id, token: newToken(), includeSubpages: input.includeSubpages ?? true, createdBy: user.id, ...protection })
      .onConflictDoUpdate({ target: publicLinks.pageId, set: Object.keys(changes).length ? changes : { pageId: req.params.id } })
      .returning()
      .get();
    const info = linkInfo(link);
    const facts = { includeSubpages: link.includeSubpages, password: info.hasPassword, expiresAt: info.expiresAt };
    if (!before) audit(db, req, { action: "page.public_link_created", target: pageTarget(page), details: facts });
    else if (Object.keys(changes).length) audit(db, req, { action: "page.public_link_changed", target: pageTarget(page), details: facts });
    return { link: info };
  });

  app.delete<{ Params: { id: string } }>("/:id/public-link", async (req) => {
    const user = requireUser(req);
    const { page } = requirePageRole(db, user.id, req.params.id, "full");
    if (db.delete(publicLinks).where(eq(publicLinks.pageId, req.params.id)).run().changes) {
      audit(db, req, { action: "page.public_link_removed", target: pageTarget(page) });
    }
    return { ok: true };
  });
};

