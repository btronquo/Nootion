import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import { createCollab, registerCollabRoute, type Collab } from "./collab.js";
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
import { adminRoutes } from "./routes/admin.js";
import { invitationRoutes } from "./routes/invitations.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { pageRoutes } from "./routes/pages.js";
import { userRoutes } from "./routes/users.js";
import { publicRoutes } from "./routes/public.js";
import { pluginAdminRoutes, pluginRoutes } from "./routes/plugins.js";
import { exportRoutes } from "./routes/export.js";
import { notionRoutes } from "./routes/notion.js";
import { searchRoutes } from "./routes/search.js";
import { builtinPluginsDir, PluginManager } from "./plugins.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    config: Config;
    collab: Collab;
    plugins: PluginManager;
  }
  interface FastifyRequest {
    user: UserRow | null;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function buildApp(opts: { db: Db; config: Config; logger?: boolean }): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024,
  });
  app.decorate("db", opts.db);
  app.decorate("config", opts.config);
  const collab = createCollab(opts.db);
  app.decorate("collab", collab);
  app.addHook("onClose", async () => {
    collab.flushPendingStores();
    collab.closeConnections();
  });
  app.decorateRequest("user", null);

  await app.register(cookie, { secret: opts.config.appSecret });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: opts.config.maxUploadMb * 1024 * 1024, files: 1 } });
  await app.register(websocket, { options: { maxPayload: 10 * 1024 * 1024 } });

  app.addHook("onRequest", async (req) => {
    // CSRF: browsers always send Origin on cross-site mutations; reject those not coming from the app itself.
    if (!SAFE_METHODS.has(req.method) && req.url.startsWith("/api/")) {
      const origin = req.headers.origin;
      if (origin && origin !== opts.config.appUrl && origin !== `${req.protocol}://${req.host}`) {
        throw new HttpError(403, "bad_origin", withLocale(requestLocale(req), () => t("error.badOrigin")));
      }
    }
    const token = req.cookies[SESSION_COOKIE];
    if (token) req.user = findSessionUser(opts.db, token);
  });
  // From here on (the body is parsed), t() speaks the user's language until the response is sent.
  app.addHook("preValidation", (req, _reply, done) => withLocale(requestLocale(req), done));

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
  await app.register(favoriteRoutes, { prefix: "/api/favorites" });
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
