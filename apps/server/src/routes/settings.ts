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
    // Settings left out keep their value: a form that only knows some of them doesn't reset the others.
    const body = req.body && typeof req.body === "object" ? req.body : {};
    return { settings: saveInstanceSettings(db, parseBody(instanceSettingsInput, { ...getInstanceSettings(db), ...body })) };
  });

  // What the button editor tells people about webhooks.
  app.get("/buttons/webhook-policy", async (req) => {
    requireUser(req);
    return { privateNetworks: getInstanceSettings(db).webhookPrivateNetworks };
  });
};
