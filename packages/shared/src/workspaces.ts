export const WORKSPACE_KINDS = ["personal", "shared"] as const;
export type WorkspaceKind = (typeof WORKSPACE_KINDS)[number];

export const WORKSPACE_ROLES = ["owner", "editor", "commenter", "viewer"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export interface WorkspaceSummary {
  id: string;
  name: string;
  kind: WorkspaceKind;
  role: WorkspaceRole;
}
