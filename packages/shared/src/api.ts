import { z } from "zod";

/** A personal API token, as listed in "My account" (the token itself is only shown once). */
export interface ApiToken {
  id: string;
  name: string;
  /** The token's first characters, to recognise it. */
  prefix: string;
  /** The spaces it can reach. */
  workspaceIds: string[];
  readOnly: boolean;
  /** Given to an app connected with OAuth (such as a Claude connector), which renews it by itself. */
  app: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

/** Every personal token starts with this. */
export const API_TOKEN_PREFIX = "nt_";

export const createApiTokenInput = z.object({
  name: z.string().trim().min(1).max(100),
  workspaceIds: z.array(z.string().min(1)).min(1).max(100),
  readOnly: z.boolean(),
  /** Days before it stops working, or null for never. */
  expiresInDays: z.number().int().min(1).max(3650).nullable(),
});
export type CreateApiTokenInput = z.infer<typeof createApiTokenInput>;

/** Something an app or agent changed with one of the user's tokens. */
export interface AgentActivity {
  id: string;
  /** The token's name. */
  agent: string;
  action: AgentAction;
  pageId: string | null;
  /** The page or row as it is now; null when it was deleted for good or is out of reach. */
  pageTitle: string | null;
  pageIcon: string | null;
  createdAt: string;
}

export const AGENT_ACTIONS = [
  "page.create",
  "page.update",
  "page.trash",
  "page.move",
  "page.restore",
  "page.template",
  "page.restoreVersion",
  "content.replace",
  "content.append",
  "file.upload",
  "database.create",
  "database.update",
  "row.create",
  "row.update",
  "row.trash",
] as const;
export type AgentAction = (typeof AGENT_ACTIONS)[number];

/** Read and read-write access asked by apps connecting with OAuth. */
export const OAUTH_SCOPES = ["read", "write"] as const;

export const oauthAuthorizeInput = z.object({
  clientId: z.string().min(1).max(200),
  redirectUri: z.string().min(1).max(2000),
  codeChallenge: z.string().min(43).max(128),
  state: z.string().max(2000).optional(),
  workspaceIds: z.array(z.string().min(1)).min(1).max(100),
  readOnly: z.boolean(),
});
export type OauthAuthorizeInput = z.infer<typeof oauthAuthorizeInput>;
