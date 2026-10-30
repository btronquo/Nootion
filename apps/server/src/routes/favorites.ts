import type { FastifyPluginAsync } from "fastify";
import { and, asc, eq, max } from "drizzle-orm";
import { reorderFavoritesInput, type PageSummary } from "@nootion/shared";
import { favorites } from "../db/schema.js";
import { parseBody, requireUser } from "../http.js";
import { getPageRole, requirePageRole } from "../permissions.js";
import { getPageMeta, toSummary } from "../pages.js";

/** Each user's starred pages, shown at the top of their sidebar. */
export const favoriteRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  // Pages in the trash, or no longer readable (unshared), are left out but stay starred: they come back with the page.
  app.get("/", async (req) => {
    const user = requireUser(req);
    const rows = db.select().from(favorites).where(eq(favorites.userId, user.id)).orderBy(asc(favorites.position), asc(favorites.createdAt)).all();
    const result: PageSummary[] = [];
    for (const f of rows) {
      if (!getPageRole(db, user.id, f.pageId)) continue;
      const page = getPageMeta(db, f.pageId);
      if (page) result.push(toSummary(page));
    }
    return { pages: result };
  });

  app.put<{ Params: { pageId: string } }>("/:pageId", async (req) => {
    const user = requireUser(req);
    requirePageRole(db, user.id, req.params.pageId, "viewer");
    const last = db.select({ n: max(favorites.position) }).from(favorites).where(eq(favorites.userId, user.id)).get()?.n ?? -1;
    db.insert(favorites).values({ userId: user.id, pageId: req.params.pageId, position: last + 1 }).onConflictDoNothing().run();
    return { ok: true };
  });

  app.delete<{ Params: { pageId: string } }>("/:pageId", async (req) => {
    const user = requireUser(req);
    db.delete(favorites).where(and(eq(favorites.userId, user.id), eq(favorites.pageId, req.params.pageId))).run();
    return { ok: true };
  });

  app.post("/order", async (req) => {
    const user = requireUser(req);
    const { pageIds } = parseBody(reorderFavoritesInput, req.body);
    db.transaction((tx) => {
      pageIds.forEach((pageId, position) =>
        tx.update(favorites).set({ position }).where(and(eq(favorites.userId, user.id), eq(favorites.pageId, pageId))).run(),
      );
    });
    return { ok: true };
  });
};
