import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { attachments, pages, publicLinks } from "../db/schema.js";
import { sendAttachment } from "../attachments.js";
import type { ProseMirrorNode } from "../collab.js";
import { notFound } from "../http.js";
import { getChain, isTrashed } from "../permissions.js";
import { getPageMeta, listDescendants, toSummary } from "../pages.js";

/** Read-only access through a public link. No account needed. */
export const publicRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  const resolve = (token: string) => {
    const link = db.select().from(publicLinks).where(eq(publicLinks.token, token)).get();
    if (!link || isTrashed(getChain(db, link.pageId))) throw notFound();
    return link;
  };

  /** True if the page is reachable through this link (the root, or a live subpage when allowed). */
  const inScope = (link: typeof publicLinks.$inferSelect, pageId: string) => {
    if (pageId === link.pageId) return true;
    if (!link.includeSubpages) return false;
    const chain = getChain(db, pageId);
    return !isTrashed(chain) && chain.some((c) => c.id === link.pageId);
  };

  /**
   * Makes stored content safe to publish: links to pages outside the link's scope lose their title,
   * and files are served through the public link instead of the private API.
   */
  const sanitize = (link: typeof publicLinks.$inferSelect, node: ProseMirrorNode): ProseMirrorNode => {
    const out: ProseMirrorNode = { ...node };
    const attrs = node.attrs ? { ...node.attrs } : undefined;
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

  const publicPage = (link: typeof publicLinks.$inferSelect, p: typeof pages.$inferSelect) => ({
    ...toSummary(p),
    updatedAt: p.updatedAt.toISOString(),
    content: p.contentJson ? sanitize(link, p.contentJson as ProseMirrorNode) : null,
  });


  app.get<{ Params: { token: string } }>("/:token", async (req) => {
    const link = resolve(req.params.token);
    const root = getPageMeta(db, link.pageId)!;
    const subpages = link.includeSubpages ? listDescendants(db, root.id).map(toSummary) : [];
    return { root: { ...toSummary(root), parentId: null }, pages: subpages };
  });

  app.get<{ Params: { token: string; pageId: string } }>("/:token/pages/:pageId", async (req) => {
    const link = resolve(req.params.token);
    if (!inScope(link, req.params.pageId)) throw notFound();
    const page = db.select().from(pages).where(eq(pages.id, req.params.pageId)).get();
    if (!page) throw notFound();
    return { page: publicPage(link, page) };
  });

  app.get<{ Params: { token: string; id: string } }>("/:token/attachments/:id", async (req, reply) => {
    const link = resolve(req.params.token);
    const a = db.select().from(attachments).where(eq(attachments.id, req.params.id)).get();
    if (!a || !inScope(link, a.pageId)) throw notFound();
    return sendAttachment(reply, app.config.dataDir, a);
  });
};
