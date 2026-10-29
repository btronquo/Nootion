import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import yazl from "yazl";
import { WORKSPACE_ROLES } from "@nootion/shared";
import { workspaces } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { exportPagesZip, safeName } from "../export.js";
import { notFound, requireAdmin, requireUser } from "../http.js";
import { listWorkspacePages } from "../pages.js";
import { requirePageRole, requireWorkspaceRole } from "../permissions.js";
import { attachmentHeader } from "./databases.js";

const today = () => new Date().toISOString().slice(0, 10);

/** Markdown exports of pages and workspaces, and the admin's full backup. */
export const exportRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  // A page and its subpages (and databases), as Markdown / CSV files in a zip.
  app.get<{ Params: { id: string } }>("/pages/:id/export", async (req, reply) => {
    const user = requireUser(req);
    const { page } = requirePageRole(db, user.id, req.params.id, "viewer");
    await app.collab.flushPendingStores();
    const zip = exportPagesZip(db, app.config.dataDir, user.id, [page]);
    return reply
      .header("content-type", "application/zip")
      .header("content-disposition", attachmentHeader(`${safeName(page.title)}.zip`))
      .send(zip.outputStream);
  });

  // Every page of a workspace the user can see.
  app.get<{ Params: { id: string } }>("/workspaces/:id/export", async (req, reply) => {
    const user = requireUser(req);
    requireWorkspaceRole(db, user.id, req.params.id, WORKSPACE_ROLES);
    const ws = db.select().from(workspaces).where(eq(workspaces.id, req.params.id)).get();
    if (!ws) throw notFound();
    await app.collab.flushPendingStores();
    const roots = listWorkspacePages(db, ws.id).filter((p) => !p.parentId);
    const zip = exportPagesZip(db, app.config.dataDir, user.id, roots);
    const name = ws.kind === "personal" ? "Espace personnel" : safeName(ws.name);
    return reply
      .header("content-type", "application/zip")
      .header("content-disposition", attachmentHeader(`${name} ${today()}.zip`))
      .send(zip.outputStream);
  });

  // Full backup: a consistent copy of the database and every file of /data. Restoring = unzipping into /data.
  app.get("/admin/backup", async (req, reply) => {
    requireAdmin(req);
    await app.collab.flushPendingStores();
    const dataDir = app.config.dataDir;
    const snapshot = path.join(dataDir, `.backup-${randomBytes(6).toString("hex")}.db`);
    await db.$client.backup(snapshot);
    const zip = new yazl.ZipFile();
    zip.addFile(snapshot, "nootion.db");
    const addDir = (dir: string, prefix: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) addDir(full, `${prefix}/${entry.name}`);
        else if (entry.isFile() && !entry.name.endsWith(".part")) zip.addFile(full, `${prefix}/${entry.name}`);
      }
    };
    for (const dir of ["uploads", "avatars", "plugins", "plugin-data"]) addDir(path.join(dataDir, dir), dir);
    zip.end();
    const cleanup = () => fs.rm(snapshot, { force: true }, () => {});
    zip.outputStream.on("end", cleanup).on("error", cleanup);
    reply.raw.on("close", cleanup);
    return reply
      .header("content-type", "application/zip")
      .header("content-disposition", attachmentHeader(`nootion-sauvegarde-${today()}.zip`))
      .send(zip.outputStream);
  });
};
