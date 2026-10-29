import { t, type PageRole, type WorkspaceRole, type WorkspaceSummary } from "@nootion/shared";

export const pageRoleLabel = (role: PageRole) =>
  ({ full: t("role.page.full"), editor: t("role.page.editor"), commenter: t("role.page.commenter"), viewer: t("role.page.viewer") })[role];

export const workspaceRoleLabel = (role: WorkspaceRole) =>
  ({ owner: t("role.workspace.owner"), editor: t("role.workspace.editor"), commenter: t("role.workspace.commenter"), viewer: t("role.workspace.viewer") })[role];

/** The personal space is named in the reader's language, whatever it was called when created. */
export const workspaceName = (ws: Pick<WorkspaceSummary, "kind" | "name">) => (ws.kind === "personal" ? t("workspace.personal") : ws.name);
