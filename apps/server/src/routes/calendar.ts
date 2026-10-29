import type { FastifyPluginAsync } from "fastify";
import { and, eq } from "drizzle-orm";
import { t, type CalendarFeed, type Locale } from "@nootion/shared";
import { newToken } from "../auth/tokens.js";
import { calendarFeeds, users } from "../db/schema.js";
import { notFound, requireUser } from "../http.js";
import { withLocale } from "../i18n.js";
import { requirePageRole } from "../permissions.js";
import { calendarEvents, toICal } from "../ical.js";

/** Private iCal links of calendar blocks: each user has their own, and can revoke it. */
export const calendarFeedRoutes: FastifyPluginAsync = async (app) => {
  const { db, config } = app;
  const feedUrl = (token: string): CalendarFeed => ({ url: `${config.appUrl}/api/ical/${token}.ics` });
  const where = (userId: string, pageId: string, blockId: string) =>
    and(eq(calendarFeeds.userId, userId), eq(calendarFeeds.pageId, pageId), eq(calendarFeeds.blockId, blockId));

  app.get<{ Params: { pageId: string; blockId: string } }>("/:pageId/:blockId", async (req) => {
    const user = requireUser(req);
    requirePageRole(db, user.id, req.params.pageId, "viewer");
    const feed = db
      .select()
      .from(calendarFeeds)
      .where(where(user.id, req.params.pageId, req.params.blockId))
      .get();
    return { feed: feed ? feedUrl(feed.token) : null };
  });

  app.post<{ Params: { pageId: string; blockId: string } }>("/:pageId/:blockId", async (req) => {
    const user = requireUser(req);
    const { pageId, blockId } = req.params;
    requirePageRole(db, user.id, pageId, "viewer");
    if (blockId.length > 64) throw notFound();
    db.insert(calendarFeeds).values({ token: newToken(), userId: user.id, pageId, blockId }).onConflictDoNothing().run();
    return {
      feed: feedUrl(
        db
          .select()
          .from(calendarFeeds)
          .where(where(user.id, pageId, blockId))
          .get()!.token,
      ),
    };
  });

  app.delete<{ Params: { pageId: string; blockId: string } }>("/:pageId/:blockId", async (req) => {
    const user = requireUser(req);
    db.delete(calendarFeeds)
      .where(where(user.id, req.params.pageId, req.params.blockId))
      .run();
    return { ok: true };
  });
};

/** The feed itself, read by calendar apps: the link is the only credential. */
export const icalRoutes: FastifyPluginAsync = async (app) => {
  const { db, config } = app;
  app.get<{ Params: { file: string } }>("/:file", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const token = req.params.file.replace(/\.ics$/, "");
    const feed = db.select().from(calendarFeeds).where(eq(calendarFeeds.token, token)).get();
    const user = feed && db.select().from(users).where(eq(users.id, feed.userId)).get();
    if (!feed || !user || user.disabled) throw notFound();
    const calendar = calendarEvents(db, user.id, feed.pageId, feed.blockId, config.appUrl);
    if (!calendar) throw notFound();
    const body = withLocale(user.locale as Locale, () => toICal(calendar.title, calendar.events, t("common.untitled")));
    return reply
      .header("content-type", "text/calendar; charset=utf-8")
      .header("content-disposition", 'inline; filename="nootion.ics"')
      .header("cache-control", "private, max-age=300")
      .send(body);
  });
};
