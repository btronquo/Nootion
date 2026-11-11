import fs from "node:fs";
import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { t } from "@nootion/shared";
import { attachmentPath, uploadsDir } from "../attachments.js";
import { attachments } from "../db/schema.js";
import { HttpError, parseBody, requireUser } from "../http.js";
import { requireWorkspaceRole } from "../permissions.js";
import { applyChanges, changesSince, currentSeq, isAttachmentId, type SyncChange } from "../sync.js";

const id = z.string().min(1).max(100);
const ms = z.number().int().nonnegative();
const page = z.object({
  id,
  workspaceId: id,
  parentId: id.nullable(),
  kind: z.enum(["page", "database", "row"]),
  title: z.string().max(2000),
  icon: z.string().max(10_000).nullable(),
  fullWidth: z.boolean(),
  cover: z.string().max(10_000).nullable(),
  coverPosition: z.number().int().min(0).max(100),
  position: z.number().int(),
  createdBy: id.nullable(),
  createdAt: ms,
  deletedAt: ms.nullable(),
  deletedBy: id.nullable(),
  props: z.record(z.string(), z.unknown()).nullable(),
  template: z.boolean(),
  defaultTemplateId: id.nullable(),
  fieldClock: z.record(z.string(), ms),
  content: z.string().nullable(),
});
const column = z.object({
  id,
  databaseId: id,
  name: z.string().max(500),
  type: z.string().max(100),
  config: z.record(z.string(), z.unknown()),
  position: z.number().int(),
  createdAt: ms,
  syncClock: ms,
});
const attachment = z.object({
  id,
  pageId: id,
  filename: z.string().min(1).max(255),
  mimeType: z.string().max(255),
  size: z.number().int().nonnegative(),
  createdBy: id.nullable(),
  createdAt: ms,
});
const thread = z.object({
  id,
  pageId: id,
  anchorStart: z.string().max(10_000).nullable(),
  anchorEnd: z.string().max(10_000).nullable(),
  quote: z.string().max(10_000),
  resolvedAt: ms.nullable(),
  resolvedBy: id.nullable(),
  createdAt: ms,
  syncClock: ms,
});
const comment = z.object({
  id,
  threadId: id,
  authorId: id,
  body: z.string().min(1).max(10_000),
  editedAt: ms.nullable(),
  createdAt: ms,
  syncClock: ms,
});
const notDeleted = z.literal(false).optional();
const change = z.union([
  z.object({ entity: z.literal("page"), id, deleted: notDeleted, data: page }),
  z.object({ entity: z.enum(["property", "view"]), id, deleted: notDeleted, data: column }),
  z.object({ entity: z.literal("attachment"), id, deleted: notDeleted, data: attachment }),
  z.object({ entity: z.literal("thread"), id, deleted: notDeleted, data: thread }),
  z.object({ entity: z.literal("comment"), id, deleted: notDeleted, data: comment }),
  z.object({ entity: z.enum(["page", "property", "view", "attachment", "thread", "comment"]), id, deleted: z.literal(true) }),
]);
const pushInput = z.object({ peer: z.string().min(8).max(100), changes: z.array(change).max(500) });
const pullQuery = z.object({ since: z.coerce.number().int().nonnegative().default(0), peer: z.string().max(100).optional() });

const EDITORS = ["owner", "editor"] as const;
const MEMBERS = ["owner", "editor", "commenter", "viewer"] as const;

/**
 * Sync of a space with the desktop app's local mode (see sync.ts). The app calls these with an OAuth token limited
 * to the space; members can pull, owners and editors can push. Attached files are uploaded one by one before the
 * push that adds them, and downloaded from /api/attachments/:id.
 */
export const syncRoutes: FastifyPluginAsync = async (app) => {
  const maxBytes = app.config.maxUploadMb * 1024 * 1024;
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: maxBytes }, (_req, body, done) => done(null, body));

  app.get<{ Params: { workspaceId: string } }>("/:workspaceId/changes", async (req) => {
    const user = requireUser(req);
    requireWorkspaceRole(app.db, user.id, req.params.workspaceId, MEMBERS);
    const q = parseBody(pullQuery, req.query);
    return changesSince(app.db, req.params.workspaceId, q.since, q.peer ?? null);
  });

  app.post<{ Params: { workspaceId: string } }>("/:workspaceId/push", { bodyLimit: 64 * 1024 * 1024 }, async (req) => {
    const user = requireUser(req);
    requireWorkspaceRole(app.db, user.id, req.params.workspaceId, EDITORS);
    const input = parseBody(pushInput, req.body);
    const changes = input.changes as SyncChange[];
    const applied = await applyChanges(app.db, app.collab, req.params.workspaceId, input.peer, changes, {
      dataDir: app.config.dataDir,
      pusher: user.id,
    });
    if (changes.some((c) => c.entity === "attachment" && !c.deleted)) app.extractor.wake();
    return { applied, seq: currentSeq(app.db) };
  });

  // The file of an attachment added on the computer, under its id; the push that follows adds the attachment.
  app.put<{ Params: { workspaceId: string; id: string }; Body: Buffer }>("/:workspaceId/attachments/:id", async (req) => {
    const user = requireUser(req);
    requireWorkspaceRole(app.db, user.id, req.params.workspaceId, EDITORS);
    const { id } = req.params;
    if (!isAttachmentId(id)) throw new HttpError(400, "invalid_id", "Invalid id");
    if (!Buffer.isBuffer(req.body)) throw new HttpError(400, "no_file", t("error.noFile"));
    // An attachment never changes: one that exists keeps its file.
    if (app.db.select({ id: attachments.id }).from(attachments).where(eq(attachments.id, id)).get()) return { ok: true };
    fs.mkdirSync(uploadsDir(app.config.dataDir), { recursive: true });
    const dest = attachmentPath(app.config.dataDir, id);
    fs.writeFileSync(`${dest}.part`, req.body);
    fs.renameSync(`${dest}.part`, dest);
    return { ok: true };
  });
};
