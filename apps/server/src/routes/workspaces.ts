import type { FastifyPluginAsync } from "fastify";
import type { WorkspaceSummary } from "@nootion/shared";
import { eq } from "drizzle-orm";
import { workspaceMembers, workspaces } from "../db/schema.js";
import { requireUser } from "../http.js";

export const workspaceRoutes: FastifyPluginAsync = async (app) => {
  // Only workspaces the user is a member of are ever listed.
  app.get("/", async (req) => {
    const user = requireUser(req);
    const rows = app.db
      .select({ id: workspaces.id, name: workspaces.name, kind: workspaces.kind, role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.userId, user.id))
      .orderBy(workspaces.createdAt)
      .all();
    const result: WorkspaceSummary[] = rows;
    return { workspaces: result };
  });
};
