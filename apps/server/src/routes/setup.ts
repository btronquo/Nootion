import type { FastifyPluginAsync } from "fastify";
import { setupInput, t } from "@nootion/shared";
import { count } from "drizzle-orm";
import { users } from "../db/schema.js";
import { HttpError, parseBody } from "../http.js";
import { requestLocale } from "../i18n.js";
import { createUser, toPublicUser } from "../users.js";
import { startSession } from "./session-cookie.js";

export const setupRoutes: FastifyPluginAsync = async (app) => {
  const hasUsers = () => (app.db.select({ n: count() }).from(users).get()?.n ?? 0) > 0;

  app.get("/setup", async () => ({ needsSetup: !hasUsers() }));

  // Creates the first administrator. Closed for good once any account exists.
  app.post("/setup", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const input = parseBody(setupInput, req.body);
    if (hasUsers()) throw new HttpError(409, "already_setup", t("error.alreadySetup"));
    const user = await createUser(app.db, { ...input, role: "admin", locale: input.locale ?? requestLocale(req) });
    startSession(app, reply, user.id);
    return { user: toPublicUser(user) };
  });
};
