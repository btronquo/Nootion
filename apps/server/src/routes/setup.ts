import type { FastifyPluginAsync } from "fastify";
import { setupInput, t } from "@nootion/shared";
import { count } from "drizzle-orm";
import { users } from "../db/schema.js";
import { HttpError, parseBody } from "../http.js";
import { requestLocale } from "../i18n.js";
import { createUser, toPublicUser } from "../users.js";
import { startSession } from "./session-cookie.js";
import { passkeySite } from "./passkeys.js";

export const setupRoutes: FastifyPluginAsync = async (app) => {
  const hasUsers = () => (app.db.select({ n: count() }).from(users).get()?.n ?? 0) > 0;

  // Also tells the sign-in page whether "Forgot password" can send its e-mail, about SSO, and where passkeys work.
  app.get("/setup", async () => {
    const { available, origin } = passkeySite(app.config.appUrl);
    return { needsSetup: !hasUsers(), mail: app.mailer.enabled(), sso: app.sso.info(), passkeys: available ? origin : null };
  });

  // Creates the first administrator. Closed for good once any account exists.
  app.post("/setup", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const input = parseBody(setupInput, req.body);
    if (hasUsers()) throw new HttpError(409, "already_setup", t("error.alreadySetup"));
    const user = await createUser(app.db, { ...input, role: "admin", locale: input.locale ?? requestLocale(req) });
    startSession(app, reply, user.id);
    return { user: toPublicUser(user) };
  });
};
