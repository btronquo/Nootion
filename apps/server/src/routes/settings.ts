import type { FastifyPluginAsync } from "fastify";
import { instanceSettingsInput } from "@nootion/shared";
import { parseBody, requireAdmin, requireUser } from "../http.js";
import { getInstanceSettings, saveInstanceSettings } from "../settings.js";

/** Server-wide choices, set by administrators. */
export const settingsRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  app.get("/admin/settings", async (req) => {
    requireAdmin(req);
    return { settings: getInstanceSettings(db) };
  });

  app.put("/admin/settings", async (req) => {
    requireAdmin(req);
    return { settings: saveInstanceSettings(db, parseBody(instanceSettingsInput, req.body)) };
  });

  // What the button editor tells people about webhooks.
  app.get("/buttons/webhook-policy", async (req) => {
    requireUser(req);
    return { privateNetworks: getInstanceSettings(db).webhookPrivateNetworks };
  });
};
