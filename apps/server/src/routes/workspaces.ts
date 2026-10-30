import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import {
  atLeast,
  createWorkspaceInput,
  setMemberInput,
  updateWorkspaceInput,
  type TrashedPage,
  type WorkspaceMember,
  type WorkspaceSummary,
} from "@nootion/shared";
import { and, count, desc, eq, isNotNull, ne } from "drizzle-orm";
import { pages, users, workspaceMembers, workspaces } from "../db/schema.js";
import { scopeAllows } from "../api-tokens.js";
import { HttpError, notFound, parseBody, requireUser } from "../http.js";
import { getPageRole, getWorkspaceRole, requireWorkspaceRole } from "../permissions.js";
import { listWorkspacePages, toSummary } from "../pages.js";
import { t } from "@nootion/shared";
import { homePageOf } from "../home.js";

const ANY_ROLE = ["owner", "editor", "commenter", "viewer"] as const;

export const workspaceRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  const getWorkspace = (id: string) => db.select().from(workspaces).where(eq(workspaces.id, id)).get();

  const requireSharedOwner = (userId: string, workspaceId: string) => {
    requireWorkspaceRole(db, userId, workspaceId, ["owner"]);
    const ws = getWorkspace(workspaceId)!;
    if (ws.kind === "personal") throw new HttpError(400, "personal_workspace", t("error.personalWorkspace"));
    return ws;
  };

  const ownerCount = (workspaceId: string, exceptUserId: string) =>
    db
      .select({ n: count() })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, "owner"), ne(workspaceMembers.userId, exceptUserId)))
      .get()?.n ?? 0;

  // Only workspaces the user is a member of are ever listed.
  app.get("/", async (req) => {
    const user = requireUser(req);
    const rows = db
      .select({ id: workspaces.id, name: workspaces.name, kind: workspaces.kind, role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.userId, user.id))
      .orderBy(workspaces.createdAt)
      .all();
    // Personal space first, then shared spaces.
    const result: WorkspaceSummary[] = [...rows.filter((r) => r.kind === "personal"), ...rows.filter((r) => r.kind === "shared")]
      // With a personal token: its spaces only, with the role it has there.
      .filter((r) => scopeAllows(r.id))
      .map((r) => ({ ...r, role: getWorkspaceRole(db, user.id, r.id) ?? r.role }));
    return { workspaces: result };
  });

  app.post("/", async (req) => {
    const user = requireUser(req);
    const input = parseBody(createWorkspaceInput, req.body);
    const id = randomUUID();
    db.transaction((tx) => {
      tx.insert(workspaces).values({ id, name: input.name, kind: "shared", createdBy: user.id }).run();
      tx.insert(workspaceMembers).values({ workspaceId: id, userId: user.id, role: "owner" }).run();
    });
    const workspace: WorkspaceSummary = { id, name: input.name, kind: "shared", role: "owner" };
    return { workspace };
  });

  app.patch<{ Params: { id: string } }>("/:id", async (req) => {
    const user = requireUser(req);
    const input = parseBody(updateWorkspaceInput, req.body);
    requireSharedOwner(user.id, req.params.id);
    db.update(workspaces).set({ name: input.name }).where(eq(workspaces.id, req.params.id)).run();
    return { ok: true };
  });

  // Deletes the workspace and every page in it.
  app.delete<{ Params: { id: string } }>("/:id", async (req) => {
    const user = requireUser(req);
    requireSharedOwner(user.id, req.params.id);
    db.delete(workspaces).where(eq(workspaces.id, req.params.id)).run();
    return { ok: true };
  });

  // Deletes every page of the workspace, trash included, for good. The workspace and its members stay.
  app.delete<{ Params: { id: string } }>("/:id/content", async (req) => {
    const user = requireUser(req);
    requireWorkspaceRole(db, user.id, req.params.id, ["owner"]);
    const deleted = db.delete(pages).where(eq(pages.workspaceId, req.params.id)).run().changes;
    return { ok: true, deleted };
  });

  app.get<{ Params: { id: string } }>("/:id/members", async (req) => {
    const user = requireUser(req);
    requireWorkspaceRole(db, user.id, req.params.id, ANY_ROLE);
    const members: WorkspaceMember[] = db
      .select({ userId: users.id, name: users.name, email: users.email, role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, req.params.id))
      .orderBy(users.name)
      .all();
    return { members };
  });

  // Adds a member or changes their role.
  app.put<{ Params: { id: string } }>("/:id/members", async (req) => {
    const user = requireUser(req);
    const input = parseBody(setMemberInput, req.body);
    requireSharedOwner(user.id, req.params.id);
    const target = db.select().from(users).where(eq(users.id, input.userId)).get();
    if (!target || target.disabled) throw new HttpError(404, "user_not_found", t("error.userNotFound"));
    if (input.role !== "owner" && ownerCount(req.params.id, input.userId) === 0) {
      throw new HttpError(409, "last_owner", t("error.lastOwner"));
    }
    db.insert(workspaceMembers)
      .values({ workspaceId: req.params.id, userId: input.userId, role: input.role })
      .onConflictDoUpdate({ target: [workspaceMembers.workspaceId, workspaceMembers.userId], set: { role: input.role } })
      .run();
    return { ok: true };
  });

  // Removes a member. Owners can remove anyone; any member can leave.
  app.delete<{ Params: { id: string; userId: string } }>("/:id/members/:userId", async (req) => {
    const user = requireUser(req);
    if (req.params.userId === user.id) {
      requireWorkspaceRole(db, user.id, req.params.id, ANY_ROLE);
      if (getWorkspace(req.params.id)!.kind === "personal") throw new HttpError(400, "personal_workspace", t("error.leavePersonal"));
    } else {
      requireSharedOwner(user.id, req.params.id);
    }
    if (ownerCount(req.params.id, req.params.userId) === 0) {
      throw new HttpError(409, "last_owner", t("error.lastOwner"));
    }
    db.delete(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, req.params.id), eq(workspaceMembers.userId, req.params.userId)))
      .run();
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>("/:id/pages", async (req) => {
    const user = requireUser(req);
    requireWorkspaceRole(db, user.id, req.params.id, ANY_ROLE);
    // The home page is reached from "Home", not from the tree.
    const home = homePageOf(db, user.id);
    return { pages: listWorkspacePages(db, req.params.id).filter((p) => p.id !== home).map(toSummary) };
  });

  // Pages put in the trash in this workspace that the user is allowed to restore or delete.
  app.get<{ Params: { id: string } }>("/:id/trash", async (req) => {
    const user = requireUser(req);
    if (!getWorkspace(req.params.id)) throw notFound();
    const rows = db
      .select()
      .from(pages)
      .where(and(eq(pages.workspaceId, req.params.id), isNotNull(pages.deletedAt)))
      .orderBy(desc(pages.deletedAt))
      .all();
    const pagesOut: TrashedPage[] = rows
      .filter((p) => atLeast(getPageRole(db, user.id, p.id, { includeTrashed: true }), "full"))
      .map((p) => ({ id: p.id, title: p.title, icon: p.icon, deletedAt: p.deletedAt!.toISOString() }));
    return { pages: pagesOut };
  });
};

