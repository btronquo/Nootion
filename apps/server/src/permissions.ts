import { and, eq, inArray, sql } from "drizzle-orm";
import { atLeast, maxRole, WORKSPACE_ROLE_TO_PAGE_ROLE, type PageKind, type PageRole, type WorkspaceRole } from "@nootion/shared";
import type { Db } from "./db/index.js";
import { effectivePagePermissions, effectiveWorkspaceMembers, groupMembers } from "./db/schema.js";
import { notFound } from "./http.js";
import { getPageMeta } from "./pages.js";
import { currentTokenScope, scopeAllows } from "./api-tokens.js";

/**
 * Single source of truth for who can see what. Every route that touches a page goes through here.
 *
 * Effective role on a page = the best of:
 *  - the user's role in the page's workspace (mapped to a page role), given to them or to one of their groups,
 *  - any share granted to the user or to one of their groups on the page or on one of its ancestors (shares are
 *    inherited).
 * A page in the trash (itself or through an ancestor) is invisible unless explicitly asked for.
 */

export interface ChainEntry {
  id: string;
  parentId: string | null;
  workspaceId: string;
  kind: PageKind;
  title: string;
  icon: string | null;
  deletedAt: number | null;
}

/** The page followed by its ancestors, up to the root. Empty if the page does not exist. */
export function getChain(db: Db, pageId: string): ChainEntry[] {
  return db.all<ChainEntry>(sql`
    WITH RECURSIVE chain(id, parent_id, workspace_id, kind, title, icon, deleted_at, depth) AS (
      SELECT id, parent_id, workspace_id, kind, title, icon, deleted_at, 0 FROM pages WHERE id = ${pageId}
      UNION ALL
      SELECT p.id, p.parent_id, p.workspace_id, p.kind, p.title, p.icon, p.deleted_at, chain.depth + 1
      FROM pages p JOIN chain ON p.id = chain.parent_id
      WHERE chain.depth < 1000
    )
    SELECT id, parent_id AS parentId, workspace_id AS workspaceId, kind, title, icon, deleted_at AS deletedAt
    FROM chain ORDER BY depth
  `);
}

const WORKSPACE_RANK: Record<WorkspaceRole, number> = { viewer: 1, commenter: 2, editor: 3, owner: 4 };

/** The better of two space roles. */
export function bestWorkspaceRole(a: WorkspaceRole | null, b: WorkspaceRole | null): WorkspaceRole | null {
  if (!a) return b;
  if (!b) return a;
  return WORKSPACE_RANK[a] >= WORKSPACE_RANK[b] ? a : b;
}

export function getWorkspaceRole(db: Db, userId: string, workspaceId: string): WorkspaceRole | null {
  // A request made with a personal token only reaches the token's spaces, and only reads with a read-only one.
  if (!scopeAllows(workspaceId)) return null;
  // Given to the person, or to one of their groups: the best one counts.
  const rows = db
    .select({ role: effectiveWorkspaceMembers.role })
    .from(effectiveWorkspaceMembers)
    .where(and(eq(effectiveWorkspaceMembers.workspaceId, workspaceId), eq(effectiveWorkspaceMembers.userId, userId)))
    .all();
  const role = rows.reduce<WorkspaceRole | null>((best, r) => bestWorkspaceRole(best, r.role), null);
  if (role && currentTokenScope()?.readOnly) return "viewer";
  return role;
}

/** The spaces a user is in, by themselves or through a group. */
export function memberWorkspaceIds(db: Db, userId: string): string[] {
  return db
    .selectDistinct({ id: effectiveWorkspaceMembers.workspaceId })
    .from(effectiveWorkspaceMembers)
    .where(eq(effectiveWorkspaceMembers.userId, userId))
    .all()
    .map((r) => r.id);
}

/** The pages shared with a user, or with one of their groups (their subpages not listed). */
export function sharedPageIdsOf(db: Db, userId: string): string[] {
  return db
    .selectDistinct({ id: effectivePagePermissions.pageId })
    .from(effectivePagePermissions)
    .where(eq(effectivePagePermissions.userId, userId))
    .all()
    .map((r) => r.id);
}

/** The groups a user is in. */
export function groupIdsOf(db: Db, userId: string): string[] {
  return db
    .select({ id: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.userId, userId))
    .all()
    .map((r) => r.id);
}

export function roleFromChain(db: Db, userId: string, chain: ChainEntry[]): PageRole | null {
  if (chain.length === 0 || !scopeAllows(chain[0].workspaceId)) return null;
  const wsRole = getWorkspaceRole(db, userId, chain[0].workspaceId);
  let role: PageRole | null = wsRole ? WORKSPACE_ROLE_TO_PAGE_ROLE[wsRole] : null;
  const shares = db
    .select({ role: effectivePagePermissions.role })
    .from(effectivePagePermissions)
    .where(and(eq(effectivePagePermissions.userId, userId), inArray(effectivePagePermissions.pageId, chain.map((c) => c.id))))
    .all();
  for (const s of shares) role = maxRole(role, s.role);
  if (role && currentTokenScope()?.readOnly) return "viewer";
  return role;
}

export function isTrashed(chain: ChainEntry[]): boolean {
  return chain.some((c) => c.deletedAt !== null);
}

export function getPageRole(db: Db, userId: string, pageId: string, opts: { includeTrashed?: boolean } = {}): PageRole | null {
  const chain = getChain(db, pageId);
  if (chain.length === 0) return null;
  if (!opts.includeTrashed && isTrashed(chain)) return null;
  return roleFromChain(db, userId, chain);
}

/**
 * Throws 404 (never 403, so existence is not leaked) unless the user has at least `min` on the page.
 * Returns the page row, its chain and the user's role.
 */
export function requirePageRole(db: Db, userId: string, pageId: string, min: PageRole, opts: { includeTrashed?: boolean } = {}) {
  const chain = getChain(db, pageId);
  if (chain.length === 0) throw notFound();
  if (!opts.includeTrashed && isTrashed(chain)) throw notFound();
  const role = roleFromChain(db, userId, chain);
  if (!atLeast(role, "viewer")) throw notFound();
  if (!atLeast(role, min)) throw notFound();
  const page = getPageMeta(db, pageId)!;
  return { page, chain, role: role! };
}

/** Same rule for workspaces: non-members get a 404. */
export function requireWorkspaceRole(db: Db, userId: string, workspaceId: string, allowed: readonly WorkspaceRole[]): WorkspaceRole {
  const role = getWorkspaceRole(db, userId, workspaceId);
  if (!role || !allowed.includes(role)) throw notFound();
  return role;
}

export const CAN_CREATE_ROOT_PAGES: readonly WorkspaceRole[] = ["owner", "editor"];
