import type { FastifyPluginAsync } from "fastify";
import { requireUser } from "../http.js";
import { ensureHomePage, homePageOf, recentPages } from "../home.js";
import { createDemo } from "../demo.js";

/** Each user's home page and the pages they visited lately. */
export const homeRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  app.get("/home", async (req) => {
    const user = requireUser(req);
    // A user's very first visit also gets the demo page.
    const first = !homePageOf(db, user.id);
    const pageId = ensureHomePage(db, user.id);
    if (first && app.config.demoPage !== false) {
      try {
        createDemo(db, app.config.dataDir, user.id);
      } catch (err) {
        req.log.error(err, "demo page not created");
      }
    }
    return { pageId };
  });

  // The demo page again, on request (from the account page).
  app.post("/demo", async (req) => ({ pageId: createDemo(db, app.config.dataDir, requireUser(req).id) }));

  app.get<{ Querystring: { limit?: string } }>("/recent", async (req) => {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 12));
    return { pages: recentPages(db, requireUser(req).id, limit) };
  });
};
