import type { PageRole, WorkspaceRole } from "@nootion/shared";

export const PAGE_ROLE_LABELS: Record<PageRole, string> = {
  full: "Accès complet",
  editor: "Peut modifier",
  commenter: "Peut commenter",
  viewer: "Peut lire",
};

export const WORKSPACE_ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: "Propriétaire",
  editor: "Éditeur",
  commenter: "Commentateur",
  viewer: "Lecteur",
};
