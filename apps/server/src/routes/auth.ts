import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { AVATAR_MAX_BYTES, deleteMeInput, loginInput, t, updateMeInput } from "@nootion/shared";
import { and, count, eq, inArray, ne } from "drizzle-orm";
import { burnPasswordCheck, hashPassword, verifyPassword } from "../auth/password.js";
import { deleteSession, deleteUserSessions, SESSION_COOKIE } from "../auth/sessions.js";
import { users, workspaceMembers, workspaces } from "../db/schema.js";
import { HttpError, parseBody, requireUser } from "../http.js";
import { avatarsDir, toPublicUser } from "../users.js";
import { imageExtension } from "../images.js";
import { clearSessionCookie, startSession } from "./session-cookie.js";
import { passwordAllowed, ssoOnlyMessage } from "./sso.js";
import { startTwoFactorChallenge } from "./two-factor.js";

/** Wrong passwords allowed for one account before it has to wait. */
const LOGIN_FAILURES_MAX = 20;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60_000;

export const authRoutes: FastifyPluginAsync = async (app) => {
  // Wrong passwords for one account, whatever address they come from (the limit per address is spread over many by a botnet).
  const failures = new Map<string, number[]>();
  const recentFailures = (email: string, now = Date.now()) => (failures.get(email) ?? []).filter((at) => now - at < LOGIN_FAILURE_WINDOW_MS);
  const failed = (email: string) => {
    const now = Date.now();
    failures.set(email, [...recentFailures(email, now), now]);
    if (failures.size > 5000) for (const [k] of failures) if (!recentFailures(k, now).length) failures.delete(k);
    return new HttpError(401, "bad_credentials", t("error.badCredentials"));
  };

  app.post("/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const input = parseBody(loginInput, req.body);
    if (recentFailures(input.email).length >= LOGIN_FAILURES_MAX) throw new HttpError(429, "too_many_requests", t("error.tooManyRequests"));
    const user = app.db.select().from(users).where(eq(users.email, input.email)).get();
    if (!user) {
      await burnPasswordCheck(input.password);
      throw failed(input.email);
    }
    if (!(await verifyPassword(user.passwordHash, input.password))) throw failed(input.email);
    if (user.disabled) throw new HttpError(403, "disabled", t("error.accountDisabled"));
    if (!passwordAllowed(app, user.role)) throw new HttpError(403, "sso_only", ssoOnlyMessage());
    failures.delete(input.email);
    // The password alone is not enough: the code from the authenticator app comes next (POST /login/2fa).
    if (user.totpSecret) {
      startTwoFactorChallenge(app, reply, user.id);
      return { twoFactorRequired: true };
    }
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

  app.patch("/me", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = requireUser(req);
    const input = parseBody(updateMeInput, req.body);
    const changesEmail = input.email !== undefined && input.email !== user.email;
    if (changesEmail || input.newPassword) {
      if (!input.currentPassword || !(await verifyPassword(user.passwordHash, input.currentPassword))) {
        throw new HttpError(400, "bad_password", t("error.badCurrentPassword"));
      }
    }
    if (changesEmail && app.db.select({ id: users.id }).from(users).where(and(eq(users.email, input.email!), ne(users.id, user.id))).get()) {
      throw new HttpError(409, "email_taken", t("error.emailUsed"));
    }
    const set: Partial<typeof users.$inferInsert> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.locale !== undefined) set.locale = input.locale;
    if (changesEmail) set.email = input.email;
    if (input.newPassword) set.passwordHash = await hashPassword(input.newPassword);
    const updated = Object.keys(set).length ? app.db.update(users).set(set).where(eq(users.id, user.id)).returning().get() : user;
    if (input.newPassword) {
      // Signs out every other device; this one gets a fresh session.
      deleteUserSessions(app.db, user.id);
      startSession(app, reply, user.id);
    }
    return { user: toPublicUser(updated) };
  });

  app.post("/me/avatar", async (req) => {
    const user = requireUser(req);
    const file = await req.file();
    if (!file) throw new HttpError(400, "no_file", t("error.noFile"));
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of file.file) {
      size += chunk.length;
      if (size > AVATAR_MAX_BYTES) throw new HttpError(413, "too_large", t("error.imageTooLarge"));
      chunks.push(chunk);
    }
    const data = Buffer.concat(chunks);
    // The type comes from the file content, not from what the browser claims.
    const ext = imageExtension(data);
    if (!ext) throw new HttpError(400, "bad_image", t("error.imageFormat"));
    const dir = avatarsDir(app.config.dataDir);
    fs.mkdirSync(dir, { recursive: true });
    const name = `${user.id}-${randomBytes(6).toString("hex")}${ext}`;
    fs.writeFileSync(path.join(dir, name), data);
    removeAvatarFile(user.avatar);
    const updated = app.db.update(users).set({ avatar: name }).where(eq(users.id, user.id)).returning().get();
    return { user: toPublicUser(updated) };
  });

  app.delete("/me/avatar", async (req) => {
    const user = requireUser(req);
    removeAvatarFile(user.avatar);
    const updated = app.db.update(users).set({ avatar: null }).where(eq(users.id, user.id)).returning().get();
    return { user: toPublicUser(updated) };
  });

  // Deletes the account and everything only it had: its personal space, and the shared spaces nobody else is in.
  app.delete("/me", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = requireUser(req);
    const input = parseBody(deleteMeInput, req.body);
    if (!(await verifyPassword(user.passwordHash, input.password))) throw new HttpError(400, "bad_password", t("error.badCurrentPassword"));
    const db = app.db;
    const others = db.select({ n: count() }).from(users).where(ne(users.id, user.id)).get()?.n ?? 0;
    if (user.role === "admin" && others > 0) {
      const otherAdmins = db.select({ n: count() }).from(users).where(and(eq(users.role, "admin"), eq(users.disabled, false), ne(users.id, user.id))).get()?.n ?? 0;
      if (otherAdmins === 0) throw new HttpError(409, "last_admin", t("error.lastAdminDelete"));
    }

    const mine = db
      .select({ id: workspaces.id, name: workspaces.name, kind: workspaces.kind, role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.userId, user.id))
      .all();
    const members = (workspaceId: string, role?: "owner") =>
      db
        .select({ n: count() })
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, workspaceId), ne(workspaceMembers.userId, user.id), ...(role ? [eq(workspaceMembers.role, role)] : [])))
        .get()?.n ?? 0;
    const toDelete: string[] = [];
    const blocking: string[] = [];
    for (const ws of mine) {
      if (ws.kind === "personal" || members(ws.id) === 0) toDelete.push(ws.id);
      // Others work in it: someone has to own it first.
      else if (ws.role === "owner" && members(ws.id, "owner") === 0) blocking.push(ws.name);
    }
    if (blocking.length) throw new HttpError(409, "sole_owner", t("error.soleOwner", { names: blocking.join(", ") }));

    db.transaction((tx) => {
      if (toDelete.length) tx.delete(workspaces).where(inArray(workspaces.id, toDelete)).run();
      // Sessions, memberships and shares go with the account; what it wrote in shared spaces stays.
      tx.delete(users).where(eq(users.id, user.id)).run();
    });
    removeAvatarFile(user.avatar);
    clearSessionCookie(reply);
    return { ok: true };
  });

  function removeAvatarFile(name: string | null) {
    if (name) fs.rmSync(path.join(avatarsDir(app.config.dataDir), path.basename(name)), { force: true });
  }
};
