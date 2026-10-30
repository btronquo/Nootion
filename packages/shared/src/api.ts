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
