import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import { createCollab, registerCollabRoute, type Collab } from "./collab.js";
import { syncMentions } from "./mentions.js";
import { attachmentRoutes } from "./routes/attachments.js";
import { databaseRoutes } from "./routes/databases.js";
import { cleanOrphanFiles } from "./attachments.js";
import type { Config } from "./config.js";
import type { Db } from "./db/index.js";
import { findSessionUser, SESSION_COOKIE } from "./auth/sessions.js";
import { HttpError } from "./http.js";
import { requestLocale, withLocale } from "./i18n.js";
import { t } from "@nootion/shared";
import type { UserRow } from "./users.js";
import { setupRoutes } from "./routes/setup.js";
import { authRoutes } from "./routes/auth.js";
import { favoriteRoutes } from "./routes/favorites.js";
import { calendarFeedRoutes, icalRoutes } from "./routes/calendar.js";
import { homeRoutes } from "./routes/home.js";
import { inboxRoutes } from "./routes/inbox.js";
import { adminRoutes } from "./routes/admin.js";
import { invitationRoutes } from "./routes/invitations.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { pageRoutes } from "./routes/pages.js";
import { commentRoutes } from "./routes/comments.js";
import { automationRoutes } from "./routes/automations.js";
import { createAutomations, type Automations } from "./automations.js";
import { createRecurrences, type Recurrences } from "./recurrences.js";
import { recurrenceRoutes } from "./routes/recurrences.js";
import { createBackups, type Backups } from "./backups.js";
import { backupRoutes } from "./routes/backups.js";
import { createLiveEvents, liveEventRoutes, type LiveEvents } from "./events.js";
import { userRoutes } from "./routes/users.js";
import { publicRoutes } from "./routes/public.js";
import { pluginAdminRoutes, pluginRoutes } from "./routes/plugins.js";
import { exportRoutes } from "./routes/export.js";
import { notionRoutes } from "./routes/notion.js";
import { searchRoutes } from "./routes/search.js";
import { builtinPluginsDir, PluginManager } from "./plugins.js";
import { createExtractor, type Extractor } from "./extract.js";
import { createNotifier, type Notifier, type PushSender } from "./reminders.js";
import { reminderRoutes } from "./routes/reminders.js";
import { apiTokenRoutes } from "./routes/api-tokens.js";
import { oauthDiscoveryRoutes, oauthRoutes } from "./routes/oauth.js";
import { mcpRoutes } from "./mcp.js";
import { ACT_AS_HEADER, INTERNAL_HEADER, INTERNAL_SECRET } from "./internal.js";
import { users } from "./db/schema.js";
import { eq } from "drizzle-orm";
import { buttonRoutes, publicFormRoutes } from "./routes/buttons.js";
import { agentAction, findTokenUser, recordActivity, tokenRefusal, withTokenScope, type TokenScope } from "./api-tokens.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    config: Config;
    collab: Collab;
    plugins: PluginManager;
    extractor: Extractor;
    notifier: Notifier;
    automations: Automations;
    recurrences: Recurrences;
    backups: Backups;
    liveEvents: LiveEvents;
  }
  interface FastifyRequest {
    user: UserRow | null;
    tokenScope: TokenScope | null;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
// Called by apps from anywhere, without cookies: no cross-site check.
const APP_ENDPOINTS = /^\/api\/oauth\/(token|register|revoke)$/;

/** Requests a personal token can make per minute. */
const TOKEN_REQUESTS_PER_MINUTE = Number(process.env.API_RATE_LIMIT ?? 300);

/** Counts requests per key over a sliding minute; false once the limit is reached. */
function rateLimiter(perMinute: number) {
  const hits = new Map<string, number[]>();
  return (key: string, now = Date.now()) => {
    const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= perMinute) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    return true;
  };
}

export async function buildApp(opts: { db: Db; config: Config; logger?: boolean; pushSender?: PushSender }): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024,
  });
  app.decorate("db", opts.db);
  app.decorate("config", opts.config);
  const collab = createCollab(opts.db);
  app.decorate("collab", collab);
  collab.storeHooks.onStored = (pageId, json) => void syncMentions(app, pageId, json).catch((err) => app.log.warn({ err }, "Couldn't send mentions"));
  app.addHook("onClose", async () => {
    collab.flushPendingStores();
    collab.closeConnections();
  });
  app.decorateRequest("user", null);
  app.decorateRequest("tokenScope", null);
  const tokenLimiter = rateLimiter(TOKEN_REQUESTS_PER_MINUTE);
  // Reads the text of attached files in the background, for search.
  const extractor = createExtractor(opts.db, opts.config.dataDir, app.log);
  app.decorate("extractor", extractor);
  app.addHook("onReady", async () => extractor.wake());
  app.addHook("onClose", async () => extractor.stop());
  // Sends reminders to the devices of their users as they fall due.
  const notifier = createNotifier(opts.db, { dataDir: opts.config.dataDir, appUrl: opts.config.appUrl, log: app.log, send: opts.pushSender });
  app.decorate("notifier", notifier);
  app.addHook("onClose", async () => notifier.stop());
  const automationRunner = createAutomations(app);
  app.decorate("automations", automationRunner);
  app.addHook("onClose", async () => automationRunner.stop());
  const recurrenceRunner = createRecurrences(app);
  app.decorate("recurrences", recurrenceRunner);
  app.addHook("onClose", async () => recurrenceRunner.stop());
  const backupRunner = createBackups(app);
  app.decorate("backups", backupRunner);
  app.addHook("onClose", async () => backupRunner.stop());
  // Tells open tabs when the page tree changes.
  const liveEvents = createLiveEvents(opts.db);
  app.decorate("liveEvents", liveEvents);
  app.addHook("preClose", async () => liveEvents.stop());

  await app.register(cookie, { secret: opts.config.appSecret });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: opts.config.maxUploadMb * 1024 * 1024, files: 1 } });
  await app.register(websocket, { options: { maxPayload: 10 * 1024 * 1024 } });

  app.addHook("onRequest", async (req, reply) => {
    // The page where users allow apps can't be shown inside another site (clickjacking).
    if (req.url.startsWith("/oauth/")) reply.header("x-frame-options", "DENY").header("content-security-policy", "frame-ancestors 'none'");
    // CSRF: browsers always send Origin on cross-site mutations; reject those not coming from the app itself.
    if (!SAFE_METHODS.has(req.method) && req.url.startsWith("/api/") && !APP_ENDPOINTS.test(req.url.split("?")[0]!)) {
      const origin = req.headers.origin;
      if (origin && origin !== opts.config.appUrl && origin !== `${req.protocol}://${req.host}`) {
        throw new HttpError(403, "bad_origin", withLocale(requestLocale(req), () => t("error.badOrigin")));
      }
    }
    // Personal API tokens ("Authorization: Bearer nt_…"), for scripts and other apps.
    const bearer = req.url.startsWith("/api/") ? /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "")?.[1] : undefined;
    if (bearer) {
      const say = (key: "error.badToken" | "error.tokenNotAllowed" | "error.tokenReadOnly" | "error.tooManyRequests") => withLocale(requestLocale(req), () => t(key));
      const found = findTokenUser(opts.db, bearer);
      if (!found) throw new HttpError(401, "bad_token", say("error.badToken"));
      req.user = found.user;
      const refusal = tokenRefusal(found.scope, req.method, req.url);
      if (refusal) throw new HttpError(403, `token_${refusal}`, say(refusal === "read_only" ? "error.tokenReadOnly" : "error.tokenNotAllowed"));
      if (!tokenLimiter(found.scope.tokenId)) throw new HttpError(429, "too_many_requests", say("error.tooManyRequests"));
      req.tokenScope = found.scope;
      return;
    }
    // The server calling its own API as a user (see internal.ts); only from inside the process.
    const actAs = req.headers[ACT_AS_HEADER];
    if (typeof actAs === "string" && req.headers[INTERNAL_HEADER] === INTERNAL_SECRET) {
      req.user = opts.db.select().from(users).where(eq(users.id, actAs)).get() ?? null;
      if (req.user?.disabled) req.user = null;
      return;
    }
    const token = req.cookies[SESSION_COOKIE];
    if (token) req.user = findSessionUser(opts.db, token);
  });
  // From here on (the body is parsed), t() speaks the user's language until the response is sent,
  // and permission checks stay within the token's scope for requests made with one.
  app.addHook("preValidation", (req, _reply, done) => withLocale(requestLocale(req), () => withTokenScope(req.tokenScope, done)));

  // What apps and agents change with a token is logged, for "My account".
  app.addHook("onSend", async (req, reply, payload) => {
    const scope = req.tokenScope;
    if (!scope || !req.user || reply.statusCode >= 400) return payload;
    const action = agentAction(req.method, req.routeOptions.url);
    if (!action) return payload;
    const params = req.params as { id?: string; rowId?: string };
    // The page changed, or the one made (named in the answer).
    let pageId = params.rowId ?? params.id ?? null;
    if (action.endsWith(".create") && typeof payload === "string") {
      try {
        const body = JSON.parse(payload) as { page?: { id?: string }; database?: { id?: string }; row?: { id?: string } };
        pageId = body.page?.id ?? body.database?.id ?? body.row?.id ?? null;
      } catch {
        // Not JSON: no page named.
      }
    }
    recordActivity(opts.db, { userId: req.user.id, agent: scope.name, action, pageId });
    return payload;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: err.code, message: err.message });
    }
    const { statusCode, message } = err as { statusCode?: number; message?: string };
    if (statusCode && statusCode < 500) {
      return reply.status(statusCode).send({ error: "request_error", message });
    }
    req.log.error(err);
    return reply.status(500).send({ error: "internal", message: withLocale(requestLocale(req), () => t("error.internal")) });
  });

  // When access may have been taken away, drop live editing sessions: clients reconnect at once
  // and go through the permission check again.
  const ACCESS_CHANGES = [/^\/api\/pages\/[^/]+\/shares/, /^\/api\/pages\/[^/]+(\/permanent)?$/, /^\/api\/workspaces\/[^/]+(\/members.*|\/content)?$/, /^\/api\/admin\/users\//];
  app.addHook("onResponse", async (req, reply) => {
    if (SAFE_METHODS.has(req.method) || reply.statusCode >= 400) return;
    const url = req.url.split("?")[0];
    const accountDeleted = req.method === "DELETE" && url === "/api/auth/me";
    if (!accountDeleted && !ACCESS_CHANGES.some((r) => r.test(url))) return;
    if (req.method === "PATCH" && url.startsWith("/api/pages/")) return; // title/icon edits
    collab.revalidateAll();
    if (req.method === "DELETE") cleanOrphanFiles(opts.db, opts.config.dataDir);
  });

  app.get("/api/health", async () => ({ ok: true, version: process.env.NOOTION_VERSION ?? "dev" }));
  await app.register(setupRoutes, { prefix: "/api" });
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(adminRoutes, { prefix: "/api/admin" });
  await app.register(invitationRoutes, { prefix: "/api/invitations" });
  await app.register(workspaceRoutes, { prefix: "/api/workspaces" });
  await app.register(pageRoutes, { prefix: "/api/pages" });
  await app.register(commentRoutes, { prefix: "/api" });
  await app.register(automationRoutes, { prefix: "/api" });
  await app.register(recurrenceRoutes, { prefix: "/api/pages" });
  await app.register(backupRoutes, { prefix: "/api/admin/backups" });
  await app.register(favoriteRoutes, { prefix: "/api/favorites" });
  await app.register(calendarFeedRoutes, { prefix: "/api/calendar-feeds" });
  await app.register(icalRoutes, { prefix: "/api/ical" });
  await app.register(homeRoutes, { prefix: "/api" });
  await app.register(inboxRoutes, { prefix: "/api" });
  await app.register(liveEventRoutes, { prefix: "/api" });
  await app.register(reminderRoutes, { prefix: "/api/reminders" });
  await app.register(apiTokenRoutes, { prefix: "/api/tokens" });
  await app.register(buttonRoutes, { prefix: "/api/buttons" });
  await app.register(publicFormRoutes, { prefix: "/api/forms" });
  await app.register(oauthRoutes, { prefix: "/api/oauth" });
  await app.register(oauthDiscoveryRoutes);
  await app.register(mcpRoutes);
  await app.register(userRoutes, { prefix: "/api/users" });
  await app.register(publicRoutes, { prefix: "/api/public" });
  await app.register(attachmentRoutes, { prefix: "/api" });
  await app.register(databaseRoutes, { prefix: "/api/databases" });
  await app.register(exportRoutes, { prefix: "/api" });
  await app.register(searchRoutes, { prefix: "/api/search" });
  await app.register(notionRoutes, { prefix: "/api/import/notion" });
  const pluginManager = new PluginManager(opts.db, {
    dirs: [
      { path: builtinPluginsDir(), builtin: true },
      { path: path.join(opts.config.dataDir, "plugins"), builtin: false },
    ],
    dataDir: opts.config.dataDir,
    appSecret: opts.config.appSecret,
    log: app.log,
    maxUploadMb: opts.config.maxUploadMb,
    appUrl: opts.config.appUrl,
    onAttachment: () => extractor.wake(),
    inject: async (userId, method, apiPath, body) => {
      const res = await app.inject({
        method,
        url: `/api${apiPath}`,
        headers: { [ACT_AS_HEADER]: userId, [INTERNAL_HEADER]: INTERNAL_SECRET, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
      });
      return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
    },
  });
  app.decorate("plugins", pluginManager);
  app.addHook("onClose", () => pluginManager.stop());

  await app.register(pluginRoutes, { prefix: "/api/plugins" });
  await app.register(pluginAdminRoutes, { prefix: "/api/admin/plugins" });
  await registerCollabRoute(app, collab);
  await pluginManager.start();



  const webDir = opts.config.webDir;
  if (webDir && fs.existsSync(path.join(webDir, "index.html"))) {
    await app.register(fastifyStatic, {
      root: webDir,
      wildcard: false,
      cacheControl: false,
      setHeaders: (res, file) => {
        // Built files carry a hash in their name: browsers may keep them for good.
        // The rest (the page, the service worker, icons) is checked on every visit, so a new version reaches installed apps at once.
        res.setHeader("cache-control", file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache");
        if (file.endsWith(".webmanifest")) res.setHeader("content-type", "application/manifest+json");
      },
    });
    // Single-page app: unknown non-API GET routes serve index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/")) return reply.sendFile("index.html");
      return reply.status(404).send({ error: "not_found", message: withLocale(requestLocale(req), () => t("error.notFound")) });
    });
  } else {
    app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: "not_found", message: withLocale(requestLocale(req), () => t("error.notFound")) }));
  }

  return app;
}
