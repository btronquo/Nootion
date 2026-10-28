import type { FastifyInstance, FastifyReply } from "fastify";
import { createSession, SESSION_COOKIE } from "../auth/sessions.js";

export function startSession(app: FastifyInstance, reply: FastifyReply, userId: string): void {
  const { token, expiresAt } = createSession(app.db, userId);
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: app.config.appUrl.startsWith("https://"),
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}
