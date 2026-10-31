import type { FastifyPluginAsync } from "fastify";
import { eq, inArray } from "drizzle-orm";
import type { LibraryPage, PageGraph } from "@nootion/shared";
import type { Db } from "../db/index.js";
import { pagePermissions, pages, users, workspaceMembers, workspaces } from "../db/schema.js";
import { requireUser } from "../http.js";
import { getChain, isTrashed } from "../permissions.js";
import { getPageMeta, listDescendants, listWorkspacePages, notRow, toSummary, type PageMeta } from "../pages.js";
import { homePageOf } from "../home.js";
import type { ProseMirrorNode } from "../collab.js";

/**
 * Every page and database the user can read, outside the trash: those of their spaces, and those shared with them
 * (with their subpages). Their own home page is left out, as in the sidebar.
 */
export function readablePages(db: Db, userId: string): PageMeta[] {
  const memberOf = db.select({ id: workspaceMembers.workspaceId }).from(workspaceMembers).where(eq(workspaceMembers.userId, userId)).all();
  const byId = new Map<string, PageMeta>();
  for (const { id } of memberOf) for (const p of listWorkspacePages(db, id)) byId.set(p.id, p);
  const grants = db.select({ pageId: pagePermissions.pageId }).from(pagePermissions).where(eq(pagePermissions.userId, userId)).all();
  for (const { pageId } of grants) {
    if (byId.has(pageId) || isTrashed(getChain(db, pageId))) continue;
    const root = getPageMeta(db, pageId);
    if (root && notRow(root)) byId.set(root.id, root);
    for (const d of listDescendants(db, pageId).filter(notRow)) byId.set(d.id, d);
  }
  const home = homePageOf(db, userId);
  if (home) byId.delete(home);
  return [...byId.values()];
}

const PAGE_HREF = /\/page\/([0-9a-f-]{36})/g;

/** The pages a page's content links to or mentions. */
function linkedIds(node: ProseMirrorNode, found = new Set<string>()): Set<string> {
  if ((node.type === "pageLink" || node.type === "pageMention") && typeof node.attrs?.pageId === "string") found.add(node.attrs.pageId);
  for (const m of node.marks ?? []) {
    if (m.type === "link" && typeof m.attrs?.href === "string") for (const [, id] of m.attrs.href.matchAll(PAGE_HREF)) found.add(id!);
  }
  for (const c of node.content ?? []) linkedIds(c, found);
  return found;
}

/** "All pages" and the graph of the links between them. */
export const libraryRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  app.get("/all", async (req) => {
    const user = requireUser(req);
    const list = readablePages(db, user.id);
    const byId = new Map(list.map((p) => [p.id, p]));
    const spaceIds = [...new Set(list.map((p) => p.workspaceId))];
    const spaces = new Map(
      (spaceIds.length ? db.select().from(workspaces).where(inArray(workspaces.id, spaceIds)).all() : []).map((w) => [
        w.id,
        w.kind === "personal" ? null : w.name,
      ]),
    );
    const authorIds = [...new Set(list.map((p) => p.createdBy).filter((id): id is string => !!id))];
    const authors = new Map(
      (authorIds.length ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, authorIds)).all() : []).map((u) => [u.id, u.name]),
    );
    const pathOf = (p: PageMeta) => {
      const path: string[] = [];
      for (
        let parent = p.parentId ? byId.get(p.parentId) : undefined;
        parent && path.length < 50;
        parent = parent.parentId ? byId.get(parent.parentId) : undefined
      ) {
        path.unshift(parent.title);
      }
      return path;
    };
    const result: LibraryPage[] = list.map((p) => ({
      ...toSummary(p),
      workspaceName: spaces.get(p.workspaceId) ?? null,
      path: pathOf(p),
      createdByName: p.createdBy ? (authors.get(p.createdBy) ?? null) : null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    }));
    result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { pages: result };
  });

  app.get("/graph", async (req) => {
    const user = requireUser(req);
    // What is being typed is saved first, so that its links are there.
    await app.collab.flushPendingStores();
    const list = readablePages(db, user.id);
    const ids = new Set(list.map((p) => p.id));
    const links: PageGraph["links"] = [];
    const seen = new Set<string>();
    for (const p of list) {
      if (!p.parentId || !ids.has(p.parentId)) continue;
      links.push({ source: p.parentId, target: p.id, kind: "child" });
      seen.add(`${p.parentId} ${p.id}`);
    }
    // Contents are read in batches, not all at once.
    const all = [...ids];
    for (let i = 0; i < all.length; i += 500) {
      const rows = db
        .select({ id: pages.id, content: pages.contentJson })
        .from(pages)
        .where(inArray(pages.id, all.slice(i, i + 500)))
        .all();
      for (const row of rows) {
        if (!row.content) continue;
        for (const target of linkedIds(row.content as ProseMirrorNode)) {
          // A subpage's link in its parent is already its "child" line.
          if (target === row.id || !ids.has(target) || seen.has(`${row.id} ${target}`)) continue;
          seen.add(`${row.id} ${target}`);
          links.push({ source: row.id, target, kind: "link" });
        }
      }
    }
    const graph: PageGraph = { nodes: list.map((p) => ({ id: p.id, title: p.title, icon: p.icon, kind: p.kind, workspaceId: p.workspaceId })), links };
    return graph;
  });
};
