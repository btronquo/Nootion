import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { parseBody, requireUser } from "../http.js";
import { requireWorkspaceRole } from "../permissions.js";
import { applyChanges, changesSince, currentSeq, type SyncChange } from "../sync.js";

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
const change = z.union([
  z.object({ entity: z.literal("page"), id, deleted: z.literal(false).optional(), data: page }),
  z.object({ entity: z.enum(["property", "view"]), id, deleted: z.literal(false).optional(), data: column }),
  z.object({ entity: z.enum(["page", "property", "view"]), id, deleted: z.literal(true) }),
]);
const pushInput = z.object({ peer: z.string().min(8).max(100), changes: z.array(change).max(500) });
const pullQuery = z.object({ since: z.coerce.number().int().nonnegative().default(0), peer: z.string().max(100).optional() });

const EDITORS = ["owner", "editor"] as const;
const MEMBERS = ["owner", "editor", "commenter", "viewer"] as const;

/**
 * Sync of a space with the desktop app's local mode (see sync.ts). The app calls these with an OAuth token limited
 * to the space; members can pull, owners and editors can push.
 */
export const syncRoutes: FastifyPluginAsync = async (app) => {
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
    const applied = await applyChanges(app.db, app.collab, req.params.workspaceId, input.peer, input.changes as SyncChange[]);
    return { applied, seq: currentSeq(app.db) };
  });
};
