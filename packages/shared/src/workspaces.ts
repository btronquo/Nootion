import { z } from "zod";

export const WORKSPACE_KINDS = ["personal", "shared"] as const;
export type WorkspaceKind = (typeof WORKSPACE_KINDS)[number];

/** owner: manages the workspace and its members. editor: full access to every page. */
export const WORKSPACE_ROLES = ["owner", "editor", "commenter", "viewer"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export interface WorkspaceSummary {
  id: string;
  name: string;
  kind: WorkspaceKind;
  role: WorkspaceRole;
}

export interface WorkspaceMember {
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
}

export const workspaceNameSchema = z.string().trim().min(1).max(100);
export const createWorkspaceInput = z.object({ name: workspaceNameSchema });
export const updateWorkspaceInput = z.object({ name: workspaceNameSchema });
export const setMemberInput = z.object({ userId: z.string().min(1), role: z.enum(WORKSPACE_ROLES) });
