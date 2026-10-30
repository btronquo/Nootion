import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { attachmentPath, sendAttachment, uploadsDir } from "../attachments.js";
import { attachments } from "../db/schema.js";
import { HttpError, notFound, requireUser } from "../http.js";
import { requirePageRole } from "../permissions.js";
import { t } from "@nootion/shared";

export const attachmentRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;
  const dataDir = app.config.dataDir;

  app.post<{ Params: { id: string } }>("/pages/:id/attachments", async (req) => {
    const user = requireUser(req);
    requirePageRole(db, user.id, req.params.id, "editor");
    const file = await req.file();
    if (!file) throw new HttpError(400, "no_file", t("error.noFile"));
    const id = randomUUID();
    fs.mkdirSync(uploadsDir(dataDir), { recursive: true });
    const dest = attachmentPath(dataDir, id);
    const tmp = `${dest}.part`;
    try {
      await pipeline(file.file, fs.createWriteStream(tmp));
      if (file.file.truncated) throw new HttpError(413, "too_large", t("error.fileTooLarge", { max: app.config.maxUploadMb }));
      fs.renameSync(tmp, dest);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    const size = fs.statSync(dest).size;
    const filename = (file.filename || "file").replace(/[\\/\r\n]/g, "_").slice(0, 255);
    const row = db
      .insert(attachments)
      .values({ id, pageId: req.params.id, filename, mimeType: file.mimetype || "application/octet-stream", size, createdBy: user.id })
      .returning()
      .get();
    app.extractor.wake();
    return { attachment: { id: row.id, filename: row.filename, mimeType: row.mimeType, size: row.size, url: `/api/attachments/${row.id}` } };
  });

  app.get<{ Params: { id: string }; Querystring: { download?: string } }>("/attachments/:id", async (req, reply) => {
    const user = requireUser(req);
    const a = db.select().from(attachments).where(eq(attachments.id, req.params.id)).get();
    if (!a) throw notFound();
    requirePageRole(db, user.id, a.pageId, "viewer");
    return sendAttachment(reply, dataDir, a, req.query.download !== undefined);
  });
};
