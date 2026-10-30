import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNotNull, lt, notExists, or } from "drizzle-orm";
import { API_TOKEN_PREFIX, type OauthAuthorizeInput } from "@nootion/shared";
import type { Db } from "./db/index.js";
import { apiTokens, oauthClients, oauthCodes, users } from "./db/schema.js";
import { hashToken, newToken } from "./auth/tokens.js";

/** How long an access token given to an app works before the app renews it. */
export const ACCESS_TOKEN_SECONDS = 3600;
const CODE_MS = 10 * 60_000;

/** An OAuth error, answered as RFC 6749 says: `{ error, error_description }`. */
export class OauthError extends Error {
  constructor(
    readonly code: "invalid_request" | "invalid_client" | "invalid_grant" | "unsupported_grant_type" | "invalid_redirect_uri" | "invalid_client_metadata",
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** Where an app may be sent back to: an https address, or the user's own computer (apps such as Claude Code). */
export function allowedRedirect(uri: string): boolean {
  try {
    const url = new URL(uri);
    if (url.hash) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

/** Dynamic client registration (RFC 7591): apps such as Claude's connectors register themselves before connecting. */
export function registerClient(db: Db, input: { name: string; redirectUris: string[] }) {
  const bad = input.redirectUris.find((u) => !allowedRedirect(u));
  if (bad) throw new OauthError("invalid_redirect_uri", `Redirect URI not allowed: ${bad}`);
  // Apps registered over a day ago that never connected are forgotten.
  db.delete(oauthClients)
    .where(
      and(
        lt(oauthClients.createdAt, new Date(Date.now() - 86_400_000)),
        notExists(db.select({ id: apiTokens.id }).from(apiTokens).where(eq(apiTokens.clientId, oauthClients.id))),
        notExists(db.select({ c: oauthCodes.codeHash }).from(oauthCodes).where(eq(oauthCodes.clientId, oauthClients.id))),
      ),
    )
    .run();
  return db.insert(oauthClients).values({ id: randomUUID(), name: input.name, redirectUris: input.redirectUris }).returning().get();
}

export const getClient = (db: Db, id: string) => db.select().from(oauthClients).where(eq(oauthClients.id, id)).get();

/** The user allowed the app: a code, valid for a few minutes, that the app exchanges for its token. */
export function createCode(db: Db, userId: string, input: OauthAuthorizeInput): string {
  const code = newToken();
  db.delete(oauthCodes).where(lt(oauthCodes.expiresAt, new Date())).run();
  db.insert(oauthCodes)
    .values({
      codeHash: hashToken(code),
      clientId: input.clientId,
      userId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      workspaceIds: [...new Set(input.workspaceIds)],
      readOnly: input.readOnly,
      expiresAt: new Date(Date.now() + CODE_MS),
    })
    .run();
  return code;
}

const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

const issue = (readOnly: boolean) => {
  const access = API_TOKEN_PREFIX + newToken();
  const refresh = newToken();
  return {
    access,
    refresh,
    set: {
      tokenHash: hashToken(access),
      prefix: access.slice(0, API_TOKEN_PREFIX.length + 6),
      refreshHash: hashToken(refresh),
      expiresAt: new Date(Date.now() + ACCESS_TOKEN_SECONDS * 1000),
    },
    response: (): TokenResponse => ({
      access_token: access,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_SECONDS,
      refresh_token: refresh,
      scope: readOnly ? "read" : "read write",
    }),
  };
};

/** Exchanges a code for a token (with PKCE): the token is an API token of the user, limited as they chose. */
export function exchangeCode(db: Db, input: { code: string; clientId: string; redirectUri: string; verifier: string }): TokenResponse {
  const row = db
    .select()
    .from(oauthCodes)
    .where(eq(oauthCodes.codeHash, hashToken(input.code)))
    .get();
  // A code works once.
  if (row) db.delete(oauthCodes).where(eq(oauthCodes.codeHash, row.codeHash)).run();
  if (!row || row.expiresAt < new Date() || row.clientId !== input.clientId || row.redirectUri !== input.redirectUri)
    throw new OauthError("invalid_grant", "Unknown, expired or mismatched code.");
  if (s256(input.verifier) !== row.codeChallenge) throw new OauthError("invalid_grant", "PKCE verification failed.");
  const client = getClient(db, row.clientId);
  if (!client) throw new OauthError("invalid_client", "Unknown client.", 401);
  const t = issue(row.readOnly);
  db.insert(apiTokens)
    .values({ id: randomUUID(), userId: row.userId, name: client.name, workspaceIds: row.workspaceIds, readOnly: row.readOnly, clientId: client.id, ...t.set })
    .run();
  return t.response();
}

/** Renews an app's access: both its tokens are replaced, the old ones stop working. */
export function refreshToken(db: Db, input: { refreshToken: string; clientId: string }): TokenResponse {
  const row = db
    .select({ t: apiTokens, disabled: users.disabled })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(and(eq(apiTokens.refreshHash, hashToken(input.refreshToken)), eq(apiTokens.clientId, input.clientId)))
    .get();
  if (!row || row.disabled) throw new OauthError("invalid_grant", "Unknown or revoked refresh token.");
  const t = issue(row.t.readOnly);
  db.update(apiTokens).set(t.set).where(eq(apiTokens.id, row.t.id)).run();
  return t.response();
}

/** Token revocation (RFC 7009): either of an app's tokens disconnects it. Personal tokens are revoked in "My account" only. */
export function revokeToken(db: Db, token: string) {
  const hash = hashToken(token);
  db.delete(apiTokens)
    .where(and(or(eq(apiTokens.tokenHash, hash), eq(apiTokens.refreshHash, hash)), isNotNull(apiTokens.clientId)))
    .run();
}
