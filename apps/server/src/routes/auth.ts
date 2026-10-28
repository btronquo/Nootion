import type { FastifyPluginAsync } from "fastify";
import { loginInput } from "@nootion/shared";
import { eq } from "drizzle-orm";
import { burnPasswordCheck, verifyPassword } from "../auth/password.js";
import { deleteSession, SESSION_COOKIE } from "../auth/sessions.js";
import { users } from "../db/schema.js";
import { HttpError, parseBody, requireUser } from "../http.js";
import { toPublicUser } from "../users.js";
import { clearSessionCookie, startSession } from "./session-cookie.js";

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const input = parseBody(loginInput, req.body);
    const user = app.db.select().from(users).where(eq(users.email, input.email)).get();
    if (!user) {
      await burnPasswordCheck(input.password);
      throw new HttpError(401, "bad_credentials", "Email ou mot de passe incorrect.");
    }
    if (!(await verifyPassword(user.passwordHash, input.password))) {
      throw new HttpError(401, "bad_credentials", "Email ou mot de passe incorrect.");
    }
    if (user.disabled) throw new HttpError(403, "disabled", "Ce compte est désactivé.");
    startSession(app, reply, user.id);
    return { user: toPublicUser(user) };
  });

  app.post("/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) deleteSession(app.db, token);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/me", async (req) => ({ user: toPublicUser(requireUser(req)) }));
};
