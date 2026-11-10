import fs from "node:fs";
import path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { t, type UserDirectoryEntry } from "@nootion/shared";
import { eq, sql } from "drizzle-orm";
import { users } from "../db/schema.js";
import { HttpError, notFound, requireUser } from "../http.js";
import { avatarsDir, avatarUrl, knownUserIds } from "../users.js";
import { IMAGE_MIME } from "../images.js";

export const userRoutes: FastifyPluginAsync = async (app) => {
  // The people the user works with, to share with, mention or put in a "person" column: see knownUserIds.
  app.get("/", async (req) => {
    const user = requireUser(req);
    const known = knownUserIds(app.db, user);
    const list: UserDirectoryEntry[] = app.db
      .select({ id: users.id, name: users.name, email: users.email, avatar: users.avatar })
      .from(users)
      .where(eq(users.disabled, false))
      .orderBy(users.name)
      .all()
      .filter((u) => !known || known.has(u.id))
      .map(({ avatar, ...u }) => ({ ...u, avatarUrl: avatarUrl({ id: u.id, avatar }) }));
    return { users: list };
  });

  // Someone the user doesn't work with yet, found by their exact e-mail address (to share a page or a space with them).
  app.get<{ Querystring: { email?: string } }>("/lookup", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    requireUser(req);
    const email = String(req.query.email ?? "").trim().toLowerCase();
    const found = email
      ? app.db
          .select({ id: users.id, name: users.name, email: users.email, avatar: users.avatar, disabled: users.disabled })
          .from(users)
          .where(sql`lower(${users.email}) = ${email}`)
          .get()
      : undefined;
    if (!found || found.disabled) throw new HttpError(404, "unknown_person", t("error.unknownEmail"));
    const entry: UserDirectoryEntry = { id: found.id, name: found.name, email: found.email, avatarUrl: avatarUrl(found) };
    return { user: entry };
  });

  // Profile pictures are visible to every signed-in user, like names.
  app.get<{ Params: { id: string } }>("/:id/avatar", async (req, reply) => {
    requireUser(req);
    const u = app.db.select({ avatar: users.avatar }).from(users).where(eq(users.id, req.params.id)).get();
    if (!u?.avatar) throw notFound();
    const file = path.join(avatarsDir(app.config.dataDir), u.avatar);
    if (!fs.existsSync(file)) throw notFound();
    const type = IMAGE_MIME[path.extname(u.avatar)] ?? "application/octet-stream";
    return reply
      .header("Content-Type", type)
      .header("X-Content-Type-Options", "nosniff")
      .header("Cache-Control", "private, max-age=31536000, immutable")
      .send(fs.createReadStream(file));
  });
};
