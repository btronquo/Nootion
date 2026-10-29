import fs from "node:fs";
import type { FastifyPluginAsync } from "fastify";
import { updatePluginInput } from "@nootion/shared";
import { notFound, parseBody, requireAdmin } from "../http.js";

/** Plugins as every page sees them, their browser code, and their own API routes. */
export const pluginRoutes: FastifyPluginAsync = async (app) => {
  // Public: shared pages need the blocks and code of plugins too.
  app.get("/", async () => ({ plugins: app.plugins.clientList() }));

  app.get<{ Params: { id: string } }>("/:id/client.js", async (req, reply) => {
    const file = app.plugins.clientFile(req.params.id);
    if (!file) throw notFound();
    return reply.header("content-type", "text/javascript; charset=utf-8").header("cache-control", "no-cache").send(fs.createReadStream(file));
  });

  app.all<{ Params: { id: string; "*": string } }>("/:id/*", async (req, reply) => app.plugins.handle(req.params.id, req.params["*"], req, reply));
};

export const pluginAdminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (req) => {
    requireAdmin(req);
  });
  app.get("/", async () => ({ plugins: app.plugins.adminList(), broken: app.plugins.broken }));
  app.patch<{ Params: { id: string } }>("/:id", async (req) => {
    await app.plugins.update(req.params.id, parseBody(updatePluginInput, req.body));
    return { plugin: app.plugins.adminList().find((p) => p.id === req.params.id) };
  });
};
