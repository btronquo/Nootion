import fs from "node:fs";
import path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import type { UserDirectoryEntry } from "@nootion/shared";
import { eq } from "drizzle-orm";
import { users } from "../db/schema.js";
import { notFound, requireUser } from "../http.js";
import { avatarsDir, avatarUrl } from "../users.js";

export const userRoutes: FastifyPluginAsync = async (app) => {
  // Directory of active accounts on this instance, used to pick people when sharing.
  app.get("/", async (req) => {
    requireUser(req);
    const list: UserDirectoryEntry[] = app.db
      .select({ id: users.id, name: users.name, email: users.email, avatar: users.avatar })
      .from(users)
      .where(eq(users.disabled, false))
      .orderBy(users.name)
      .all()
      .map(({ avatar, ...u }) => ({ ...u, avatarUrl: avatarUrl({ id: u.id, avatar }) }));
    return { users: list };
  });

  // Profile pictures are visible to every signed-in user, like names.
  app.get<{ Params: { id: string } }>("/:id/avatar", async (req, reply) => {
    requireUser(req);
    const u = app.db.select({ avatar: users.avatar }).from(users).where(eq(users.id, req.params.id)).get();
    if (!u?.avatar) throw notFound();
    const file = path.join(avatarsDir(app.config.dataDir), u.avatar);
    if (!fs.existsSync(file)) throw notFound();
    const type = AVATAR_MIME[path.extname(u.avatar)] ?? "application/octet-stream";
    return reply
      .header("Content-Type", type)
      .header("X-Content-Type-Options", "nosniff")
      .header("Cache-Control", "private, max-age=31536000, immutable")
      .send(fs.createReadStream(file));
  });
};

const AVATAR_MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
