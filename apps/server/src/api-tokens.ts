import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { API_TOKEN_PREFIX, atLeast, type AgentAction, type AgentActivity, type ApiToken, type CreateApiTokenInput } from "@nootion/shared";
import type { Db } from "./db/index.js";
import { agentActivity, apiTokens, pages, users } from "./db/schema.js";
import { getPageRole } from "./permissions.js";
import { hashToken, newToken } from "./auth/tokens.js";

/** What a request made with a personal token may reach. */
export interface TokenScope {
  tokenId: string;
  /** The token's name, shown on what it changed. */
  name: string;
  workspaceIds: string[];
  readOnly: boolean;
}

// The scope of the token the current request was made with; nothing for the app's own requests.
const storage = new AsyncLocalStorage<TokenScope>();

/** Runs `fn` with the permission checks limited to a token's scope. */
export function withTokenScope<T>(scope: TokenScope | null, fn: () => T): T {
  return scope ? storage.run(scope, fn) : fn();
}

export const currentTokenScope = (): TokenScope | undefined => storage.getStore();

/** Whether the current request may reach this space: always, unless made with a token limited to other spaces. */
export function scopeAllows(workspaceId: string): boolean {
  const scope = storage.getStore();
  return !scope || scope.workspaceIds.includes(workspaceId);
}

const toApiToken = (r: typeof apiTokens.$inferSelect): ApiToken => ({
  id: r.id,
  name: r.name,
  prefix: r.prefix,
  workspaceIds: r.workspaceIds,
  readOnly: r.readOnly,
  app: r.clientId !== null,
  expiresAt: r.expiresAt?.toISOString() ?? null,
  lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
});

export function listApiTokens(db: Db, userId: string): ApiToken[] {
  return db.select().from(apiTokens).where(eq(apiTokens.userId, userId)).orderBy(desc(apiTokens.createdAt)).all().map(toApiToken);
}

/** Makes a token; the value returned is the only time it is seen. */
export function createApiToken(db: Db, userId: string, input: CreateApiTokenInput): { token: string; apiToken: ApiToken } {
  const token = API_TOKEN_PREFIX + newToken();
  const row = db
    .insert(apiTokens)
    .values({
      id: randomUUID(),
      userId,
      name: input.name,
      tokenHash: hashToken(token),
      prefix: token.slice(0, API_TOKEN_PREFIX.length + 6),
      workspaceIds: [...new Set(input.workspaceIds)],
      readOnly: input.readOnly,
      expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null,
    })
    .returning()
    .get();
  return { token, apiToken: toApiToken(row) };
}

export function deleteApiToken(db: Db, userId: string, id: string): boolean {
  return (
    db
      .delete(apiTokens)
      .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId)))
      .run().changes > 0
  );
}

/** The user and scope of a token, or null when it is unknown, expired, or its user disabled. */
export function findTokenUser(db: Db, token: string, now = new Date()) {
  if (!token.startsWith(API_TOKEN_PREFIX)) return null;
  const row = db
    .select({ t: apiTokens, user: users })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(eq(apiTokens.tokenHash, hashToken(token)))
    .get();
  if (!row || row.user.disabled || (row.t.expiresAt && row.t.expiresAt <= now)) return null;
  // Written at most once a minute.
  if (!row.t.lastUsedAt || now.getTime() - row.t.lastUsedAt.getTime() > 60_000) {
    db.update(apiTokens).set({ lastUsedAt: now }).where(eq(apiTokens.id, row.t.id)).run();
  }
  const scope: TokenScope = { tokenId: row.t.id, name: row.t.name, workspaceIds: row.t.workspaceIds, readOnly: row.t.readOnly };
  return { user: row.user, scope };
}

// What a token can do: work with pages, databases, files and search. Not: the account, sharing, public links,
// deleting for good, administration, other tokens.
const ALLOWED: [methods: string, path: RegExp][] = [
  ["GET", /^\/api\/auth\/me$/],
  ["GET", /^\/api\/users$/],
  ["GET", /^\/api\/workspaces$/],
  ["GET", /^\/api\/workspaces\/[^/]+\/pages$/],
  ["GET", /^\/api\/search$/],
  ["GET", /^\/api\/attachments\/[^/]+$/],
  ["POST", /^\/api\/pages\/[^/]+\/attachments$/],
  ["GET POST", /^\/api\/pages$/],
  ["GET PATCH DELETE", /^\/api\/pages\/(?!shared$)[^/]+$/],
  ["GET PUT POST", /^\/api\/pages\/[^/]+\/content$/],
  ["POST", /^\/api\/pages\/[^/]+\/(move|restore|apply-template)$/],
  ["GET", /^\/api\/pages\/[^/]+\/(backlinks|history(\/[^/]+)?)$/],
  ["POST", /^\/api\/pages\/[^/]+\/history\/[^/]+\/restore$/],
  ["GET POST", /^\/api\/databases$/],
  ["GET POST PUT PATCH DELETE", /^\/api\/databases\/[^/]+(\/.*)?$/],
];
// Reading with a request body: allowed to read-only tokens.
const READS = [/^\/api\/databases\/[^/]+\/query$/];

/** Why a token can't make this request, or null when it can. */
export function tokenRefusal(scope: TokenScope, method: string, url: string): "not_allowed" | "read_only" | null {
  const path = url.split("?")[0]!;
  const m = method === "HEAD" ? "GET" : method;
  if (!ALLOWED.some(([methods, re]) => methods.split(" ").includes(m) && re.test(path))) return "not_allowed";
  if (scope.readOnly && m !== "GET" && !READS.some((re) => re.test(path))) return "read_only";
  return null;
}

// What a change made with a token is, by method and route.
const ACTIONS: Record<string, AgentAction> = {
  "POST /api/pages": "page.create",
  "PATCH /api/pages/:id": "page.update",
  "DELETE /api/pages/:id": "page.trash",
  "POST /api/pages/:id/move": "page.move",
  "POST /api/pages/:id/restore": "page.restore",
  "POST /api/pages/:id/apply-template": "page.template",
  "POST /api/pages/:id/history/:versionId/restore": "page.restoreVersion",
  "PUT /api/pages/:id/content": "content.replace",
  "POST /api/pages/:id/content": "content.append",
  "POST /api/pages/:id/attachments": "file.upload",
  "POST /api/databases": "database.create",
  "POST /api/databases/:id/rows": "row.create",
  "PATCH /api/databases/:id/rows/:rowId": "row.update",
  "POST /api/databases/:id/rows/delete": "row.trash",
};

/** What a successful request made with a token changed, or null when it only read. */
export function agentAction(method: string, route: string | undefined): AgentAction | null {
  if (!route || method === "GET" || method === "HEAD" || route === "/api/databases/:id/query") return null;
  return ACTIONS[`${method} ${route}`] ?? (route.startsWith("/api/databases/") ? "database.update" : null);
}

/** Keeps the last 1000 changes made with a user's tokens. */
export function recordActivity(db: Db, entry: { userId: string; agent: string; action: AgentAction; pageId: string | null }) {
  db.insert(agentActivity).values({ id: randomUUID(), ...entry }).run();
  const old = db
    .select({ id: agentActivity.id })
    .from(agentActivity)
    .where(eq(agentActivity.userId, entry.userId))
    .orderBy(desc(agentActivity.createdAt))
    .limit(1000)
    .offset(1000)
    .all();
  if (old.length)
    db.delete(agentActivity)
      .where(inArray(agentActivity.id, old.map((r) => r.id)))
      .run();
}

export function listActivity(db: Db, userId: string, limit = 100): AgentActivity[] {
  const rows = db.select().from(agentActivity).where(eq(agentActivity.userId, userId)).orderBy(desc(agentActivity.createdAt)).limit(limit).all();
  const ids = [...new Set(rows.flatMap((r) => (r.pageId ? [r.pageId] : [])))];
  const found = new Map(
    ids.length
      ? db
          .select({ id: pages.id, title: pages.title, icon: pages.icon })
          .from(pages)
          .where(inArray(pages.id, ids))
          .all()
          .filter((p) => atLeast(getPageRole(db, userId, p.id), "viewer"))
          .map((p) => [p.id, p])
      : [],
  );
  return rows.map((r) => ({
    id: r.id,
    agent: r.agent,
    action: r.action as AgentAction,
    pageId: r.pageId,
    pageTitle: r.pageId ? (found.get(r.pageId)?.title ?? null) : null,
    pageIcon: r.pageId ? (found.get(r.pageId)?.icon ?? null) : null,
    createdAt: r.createdAt.toISOString(),
  }));
}
