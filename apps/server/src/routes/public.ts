import type { FastifyPluginAsync } from "fastify";
import { eq, inArray } from "drizzle-orm";
import { attachments, pages, publicLinks } from "../db/schema.js";
import { sendAttachment } from "../attachments.js";
import type { ProseMirrorNode } from "../collab.js";
import { notFound } from "../http.js";
import { getChain, isTrashed } from "../permissions.js";
import { getPageMeta, listDescendants, notRow, toSummary } from "../pages.js";
import { listProperties, loadDatabase, toRow } from "../databases.js";

/** Read-only access through a public link. No account needed. */
export const publicRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  const resolve = (token: string) => {
    const link = db.select().from(publicLinks).where(eq(publicLinks.token, token)).get();
    if (!link || isTrashed(getChain(db, link.pageId))) throw notFound();
    return link;
  };

  /**
   * True if the page is reachable through this link: the root, a live subpage when allowed, or a
   * database embedded in a reachable page (and its rows), since it is part of that page's content.
   */
  const inScope = (link: typeof publicLinks.$inferSelect, pageId: string) => {
    if (pageId === link.pageId) return true;
    const chain = getChain(db, pageId);
    const rootIndex = chain.findIndex((c) => c.id === link.pageId);
    if (rootIndex < 0 || isTrashed(chain)) return false;
    if (link.includeSubpages) return true;
    const below = chain.slice(0, rootIndex);
    const rows = db.select({ id: pages.id, kind: pages.kind }).from(pages).where(inArray(pages.id, below.map((c) => c.id))).all();
    const kind = new Map(rows.map((r) => [r.id, r.kind]));
    return below.every((c) => kind.get(c.id) === "row" || (kind.get(c.id) === "database" && c.parentId !== null && embeds(c.parentId, c.id)));
  };

  const embeds = (pageId: string, databaseId: string) => {
    const p = db.select({ content: pages.contentJson }).from(pages).where(eq(pages.id, pageId)).get();
    const walk = (n: ProseMirrorNode | null | undefined): boolean =>
      !!n && ((n.type === "databaseBlock" && n.attrs?.pageId === databaseId) || (n.content ?? []).some(walk));
    return walk(p?.content as ProseMirrorNode | null);
  };

  /**
   * Makes stored content safe to publish: links to pages outside the link's scope lose their title,
   * and files are served through the public link instead of the private API.
   */
  const sanitize = (link: typeof publicLinks.$inferSelect, node: ProseMirrorNode): ProseMirrorNode => {
    const out: ProseMirrorNode = { ...node };
    const attrs = node.attrs ? { ...node.attrs } : undefined;
    if (attrs && node.type === "databaseBlock" && (typeof attrs.pageId !== "string" || !inScope(link, attrs.pageId))) attrs.pageId = null;
    if (attrs && (node.type === "pageLink" || node.type === "pageMention")) {
      const pageId = typeof attrs.pageId === "string" ? attrs.pageId : null;
      if (!pageId || !inScope(link, pageId)) {
        attrs.pageId = null;
        attrs.title = "Page privée";
      }
    }
    if (attrs) {
      for (const key of ["src", "url"]) {
        const value = attrs[key];
        const m = typeof value === "string" ? /^\/api\/attachments\/([0-9a-f-]{36})/.exec(value) : null;
        if (m) attrs[key] = `/api/public/${link.token}/attachments/${m[1]}`;
      }
      out.attrs = attrs;
    }
    if (node.content) out.content = node.content.map((c) => sanitize(link, c));
    return out;
  };

  const publicPage = (link: typeof publicLinks.$inferSelect, p: typeof pages.$inferSelect) => {
    let row = null;
    if (p.kind === "row" && p.parentId) {
      const properties = listProperties(db, p.parentId);
      row = { properties, values: toRow(p, properties).values };
    }
    return {
      ...toSummary(p),
      updatedAt: p.updatedAt.toISOString(),
      fullWidth: p.fullWidth,
      content: p.contentJson ? sanitize(link, p.contentJson as ProseMirrorNode) : null,
      row,
    };
  };


  app.get<{ Params: { token: string } }>("/:token", async (req) => {
    const link = resolve(req.params.token);
    const root = getPageMeta(db, link.pageId)!;
    const subpages = link.includeSubpages ? listDescendants(db, root.id).filter(notRow).map(toSummary) : [];
    return { root: { ...toSummary(root), parentId: null }, pages: subpages };
  });

  app.get<{ Params: { token: string; pageId: string } }>("/:token/pages/:pageId", async (req) => {
    const link = resolve(req.params.token);
    if (!inScope(link, req.params.pageId)) throw notFound();
    const page = db.select().from(pages).where(eq(pages.id, req.params.pageId)).get();
    if (!page) throw notFound();
    return { page: publicPage(link, page) };
  });

  // Read-only database. Names of people are not published.
  app.get<{ Params: { token: string; id: string } }>("/:token/databases/:id", async (req) => {
    const link = resolve(req.params.token);
    if (!inScope(link, req.params.id)) throw notFound();
    const meta = getPageMeta(db, req.params.id);
    if (!meta || meta.kind !== "database") throw notFound();
    return { database: { ...loadDatabase(db, meta, "viewer"), people: {} } };
  });

  app.get<{ Params: { token: string; id: string } }>("/:token/attachments/:id", async (req, reply) => {
    const link = resolve(req.params.token);
    const a = db.select().from(attachments).where(eq(attachments.id, req.params.id)).get();
    if (!a || !inScope(link, a.pageId)) throw notFound();
    return sendAttachment(reply, app.config.dataDir, a);
  });
};
