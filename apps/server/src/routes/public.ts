import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { pages, publicLinks } from "../db/schema.js";
import { notFound } from "../http.js";
import { getChain, isTrashed } from "../permissions.js";
import { listDescendants, toSummary } from "../pages.js";

/** Read-only access through a public link. No account needed. */
export const publicRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  const resolve = (token: string) => {
    const link = db.select().from(publicLinks).where(eq(publicLinks.token, token)).get();
    if (!link || isTrashed(getChain(db, link.pageId))) throw notFound();
    return link;
  };

  const publicPage = (p: typeof pages.$inferSelect) => ({
    ...toSummary(p),
    updatedAt: p.updatedAt.toISOString(),
  });

  app.get<{ Params: { token: string } }>("/:token", async (req) => {
    const link = resolve(req.params.token);
    const root = db.select().from(pages).where(eq(pages.id, link.pageId)).get()!;
    const subpages = link.includeSubpages ? listDescendants(db, root.id).map(toSummary) : [];
    return { root: { ...toSummary(root), parentId: null }, pages: subpages };
  });

  app.get<{ Params: { token: string; pageId: string } }>("/:token/pages/:pageId", async (req) => {
    const link = resolve(req.params.token);
    if (req.params.pageId !== link.pageId) {
      if (!link.includeSubpages) throw notFound();
      const chain = getChain(db, req.params.pageId);
      if (isTrashed(chain) || !chain.some((c) => c.id === link.pageId)) throw notFound();
    }
    const page = db.select().from(pages).where(eq(pages.id, req.params.pageId)).get();
    if (!page) throw notFound();
    return { page: publicPage(page) };
  });
};
