import type { FastifyPluginAsync } from "fastify";
import { requireUser } from "../http.js";
import { ensureHomePage, recentPages } from "../home.js";

/** Each user's home page and the pages they visited lately. */
export const homeRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  app.get("/home", async (req) => ({ pageId: ensureHomePage(db, requireUser(req).id) }));

  app.get<{ Querystring: { limit?: string } }>("/recent", async (req) => {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 12));
    return { pages: recentPages(db, requireUser(req).id, limit) };
  });
};
