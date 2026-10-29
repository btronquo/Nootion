import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { AVATAR_MAX_BYTES, loginInput, t, updateMeInput } from "@nootion/shared";
import { and, eq, ne } from "drizzle-orm";
import { burnPasswordCheck, hashPassword, verifyPassword } from "../auth/password.js";
import { deleteSession, deleteUserSessions, SESSION_COOKIE } from "../auth/sessions.js";
import { users } from "../db/schema.js";
import { HttpError, parseBody, requireUser } from "../http.js";
import { avatarsDir, toPublicUser } from "../users.js";
import { clearSessionCookie, startSession } from "./session-cookie.js";

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const input = parseBody(loginInput, req.body);
    const user = app.db.select().from(users).where(eq(users.email, input.email)).get();
    if (!user) {
      await burnPasswordCheck(input.password);
      throw new HttpError(401, "bad_credentials", t("error.badCredentials"));
    }
    if (!(await verifyPassword(user.passwordHash, input.password))) {
      throw new HttpError(401, "bad_credentials", t("error.badCredentials"));
    }
    if (user.disabled) throw new HttpError(403, "disabled", t("error.accountDisabled"));
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

  function removeAvatarFile(name: string | null) {
    if (name) fs.rmSync(path.join(avatarsDir(app.config.dataDir), path.basename(name)), { force: true });
  }
};

function imageExtension(b: Buffer): string | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ".png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return ".jpg";
  if (b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return ".webp";
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.toString("ascii", 0, 6))) return ".gif";
  return null;
}
