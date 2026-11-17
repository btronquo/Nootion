import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { createGroupInput, groupMemberInput, t, updateGroupInput } from "@nootion/shared";
import { groups, users } from "../db/schema.js";
import { HttpError, parseBody, requireAdmin, requireUser } from "../http.js";
import { addGroupMembers, assertNameFree, createGroup, listGroupDetails, listGroups, removeGroupMembers, requireGroup } from "../groups.js";

/** GET /api/groups: every group, to share a space or a page with it or mention it (guests are refused, see guests.ts). */
export const groupRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    const user = requireUser(req);
    return { groups: listGroups(app.db, user.id) };
  });
};

/** /api/admin/groups: administrators make groups and choose who is in them. */
export const groupAdminRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;
  app.addHook("preHandler", async (req) => {
    requireAdmin(req);
  });

  app.get("/", async (req) => ({ groups: listGroupDetails(db, requireUser(req).id) }));

  app.post("/", async (req) => {
    const admin = requireAdmin(req);
    const input = parseBody(createGroupInput, req.body);
    const group = createGroup(db, { name: input.name, description: input.description, createdBy: admin.id });
    return { group: listGroupDetails(db, admin.id).find((g) => g.id === group.id)! };
  });

  app.patch<{ Params: { id: string } }>("/:id", async (req) => {
    const input = parseBody(updateGroupInput, req.body);
    const group = requireGroup(db, req.params.id);
    if (input.name !== undefined) assertNameFree(db, input.name, group.id);
    const set: Partial<typeof groups.$inferInsert> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.description !== undefined) set.description = input.description;
    if (Object.keys(set).length) db.update(groups).set(set).where(eq(groups.id, group.id)).run();
    return { ok: true };
  });

  // The spaces and pages shared with the group stop being open to its members; nothing else is deleted.
  app.delete<{ Params: { id: string } }>("/:id", async (req) => {
    const group = requireGroup(db, req.params.id);
    db.delete(groups).where(eq(groups.id, group.id)).run();
    return { ok: true };
  });

  app.put<{ Params: { id: string } }>("/:id/members", async (req) => {
    const input = parseBody(groupMemberInput, req.body);
    const group = requireGroup(db, req.params.id);
    const target = db.select({ role: users.role, disabled: users.disabled }).from(users).where(eq(users.id, input.userId)).get();
    if (!target || target.disabled) throw new HttpError(404, "user_not_found", t("error.userNotFound"));
    if (target.role === "guest") throw new HttpError(400, "guest_no_group", t("error.guestNoGroup"));
    addGroupMembers(db, group.id, [input.userId]);
    return { ok: true };
  });

  app.delete<{ Params: { id: string; userId: string } }>("/:id/members/:userId", async (req) => {
    const group = requireGroup(db, req.params.id);
    removeGroupMembers(db, group.id, [req.params.userId]);
    return { ok: true };
  });
};
