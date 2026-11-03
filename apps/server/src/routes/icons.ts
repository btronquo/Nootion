import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { desc, eq } from "drizzle-orm";
import { customIconUrl, ICON_MAX_BYTES, t, type CustomIcon } from "@nootion/shared";
import { customIcons } from "../db/schema.js";
import { HttpError, notFound, requireUser } from "../http.js";
import { IMAGE_MIME, imageExtension } from "../images.js";

export const iconsDir = (dataDir: string) => path.join(dataDir, "icons");

/** Page icons uploaded by people, shared by everyone on the server. */
export const iconRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  app.get("/", async (req) => {
    const user = requireUser(req);
    const icons: CustomIcon[] = db
      .select()
      .from(customIcons)
      .orderBy(desc(customIcons.createdAt))
      .all()
      .map((i) => ({ id: i.id, name: i.name, url: customIconUrl(i.id), canDelete: i.createdBy === user.id || user.role === "admin" }));
    return { icons };
  });

  app.post("/", async (req) => {
    const user = requireUser(req);
    if (req.tokenScope) throw new HttpError(403, "forbidden", t("error.forbidden"));
    const file = await req.file();
    if (!file) throw new HttpError(400, "no_file", t("error.noFile"));
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of file.file) {
      size += chunk.length;
      if (size > ICON_MAX_BYTES) throw new HttpError(413, "too_large", t("error.iconTooLarge"));
      chunks.push(chunk);
    }
    const data = Buffer.concat(chunks);
    const ext = imageExtension(data);
    if (!ext) throw new HttpError(400, "bad_image", t("error.imageFormat"));
    const id = randomUUID();
    fs.mkdirSync(iconsDir(app.config.dataDir), { recursive: true });
    fs.writeFileSync(path.join(iconsDir(app.config.dataDir), id + ext), data);
    const name = path.parse(file.filename || "").name.slice(0, 100) || t("icon.custom");
    db.insert(customIcons)
      .values({ id, name, file: id + ext, createdBy: user.id })
      .run();
    const icon: CustomIcon = { id, name, url: customIconUrl(id), canDelete: true };
    return { icon };
  });

  // Shown wherever the page is, public pages included: the id can't be guessed.
  app.get<{ Params: { id: string } }>("/:id/image", async (req, reply) => {
    const icon = db.select().from(customIcons).where(eq(customIcons.id, req.params.id)).get();
    const file = icon && path.join(iconsDir(app.config.dataDir), path.basename(icon.file));
    if (!file || !fs.existsSync(file)) throw notFound();
    return reply
      .header("Content-Type", IMAGE_MIME[path.extname(file)] ?? "application/octet-stream")
      .header("X-Content-Type-Options", "nosniff")
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .send(fs.createReadStream(file));
  });

  // Pages that used it show the default icon instead.
  app.delete<{ Params: { id: string } }>("/:id", async (req) => {
    const user = requireUser(req);
    const icon = db.select().from(customIcons).where(eq(customIcons.id, req.params.id)).get();
    if (!icon) throw notFound();
    if (icon.createdBy !== user.id && user.role !== "admin") throw new HttpError(403, "forbidden", t("error.forbidden"));
    db.delete(customIcons).where(eq(customIcons.id, icon.id)).run();
    fs.rmSync(path.join(iconsDir(app.config.dataDir), path.basename(icon.file)), { force: true });
    return { ok: true };
  });
};
