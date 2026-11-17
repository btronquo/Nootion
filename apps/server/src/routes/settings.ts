import type { FastifyPluginAsync } from "fastify";
import { instanceSettingsInput } from "@nootion/shared";
import { parseBody, requireAdmin, requireUser } from "../http.js";
import { getInstanceSettings, saveInstanceSettings } from "../settings.js";
import { audit, changedKeys, settingsTarget } from "../audit.js";

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
    const before = getInstanceSettings(db);
    const settings = saveInstanceSettings(db, parseBody(instanceSettingsInput, { ...before, ...body }));
    const keys = changedKeys(before, settings);
    // Values are kept here: none of these is a secret, and "guests forbidden" says more than "allowGuests changed".
    const values = Object.fromEntries(keys.map((k) => [k, settings[k as keyof typeof settings]]));
    if (keys.length) audit(db, req, { action: "settings.changed", target: settingsTarget("server"), details: { keys, values } });
    return { settings };
  });

  // What the button editor tells people about webhooks.
  app.get("/buttons/webhook-policy", async (req) => {
    requireUser(req);
    return { privateNetworks: getInstanceSettings(db).webhookPrivateNetworks };
  });
};
