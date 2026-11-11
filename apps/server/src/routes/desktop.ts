import { randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { asc, eq } from "drizzle-orm";
import { users } from "../db/schema.js";
import { HttpError } from "../http.js";
import { requestLocale } from "../i18n.js";
import { createUser } from "../users.js";
import { startSession } from "./session-cookie.js";

/** How long a ticket can be used, once. */
const TICKET_TTL_MS = 60_000;

/**
 * Signing in on the desktop app's local mode, where Nootion runs on the computer for one person and has no password
 * to type. Only registered when the app started the server with NOOTION_DESKTOP_TOKEN (see config.ts).
 *
 * 1. The app asks for a ticket with the token, from Rust: `POST /api/desktop/ticket`, header `x-nootion-desktop-token`.
 * 2. Its window opens `GET /api/desktop/session?ticket=…`, which signs in (creating the account on the first launch)
 *    and goes to the home page.
 *
 * The token never goes through the web view or the logs; a ticket that shows up in a log has already been used.
 */
export const desktopRoutes: FastifyPluginAsync = async (app) => {
  const desktop = app.config.desktop;
  if (!desktop) return;
  const expected = Buffer.from(desktop.token);
  const tickets = new Map<string, number>();

  const sameToken = (value: unknown) => {
    if (typeof value !== "string") return false;
    const given = Buffer.from(value);
    return given.length === expected.length && timingSafeEqual(given, expected);
  };

  app.post("/ticket", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    if (!sameToken(req.headers["x-nootion-desktop-token"])) throw new HttpError(404, "not_found", "Not found");
    const now = Date.now();
    for (const [t, exp] of tickets) if (exp < now) tickets.delete(t);
    const ticket = randomBytes(24).toString("base64url");
    tickets.set(ticket, now + TICKET_TTL_MS);
    return { ticket };
  });

  // The app is quitting: close the database cleanly (on Windows, killing the process can't be caught).
  app.post("/quit", async (req, reply) => {
    if (!sameToken(req.headers["x-nootion-desktop-token"])) throw new HttpError(404, "not_found", "Not found");
    reply.raw.once("finish", () => setImmediate(() => process.emit("SIGTERM")));
    return { ok: true };
  });

  app.get<{ Querystring: { ticket?: string } }>("/session", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const ticket = req.query.ticket ?? "";
    const exp = tickets.get(ticket);
    tickets.delete(ticket);
    if (!exp || exp < Date.now()) throw new HttpError(404, "not_found", "Not found");

    // The person using this computer: the first administrator, or a new account on the first launch.
    let user = app.db.select().from(users).where(eq(users.role, "admin")).orderBy(asc(users.createdAt)).limit(1).get();
    if (!user) {
      user = await createUser(app.db, {
        name: desktop.userName,
        email: "me@nootion.local",
        password: randomBytes(32).toString("base64url"),
        role: "admin",
        locale: requestLocale(req),
      });
    }
    startSession(app, reply, user.id);
    return reply.redirect("/");
  });
};
