import { randomUUID } from "node:crypto";
import { t } from "@nootion/shared";
import { and, eq, sql } from "drizzle-orm";
import type { Db, DbLike } from "./db/index.js";
import { invitations, pagePermissions, workspaceMembers, workspaces } from "./db/schema.js";
import { HttpError } from "./http.js";
import { getChain, isTrashed } from "./permissions.js";
import { getInstanceSettings } from "./settings.js";
import type { UserRow } from "./users.js";

/**
 * Guests: people from outside invited on a page. They have an account like anyone, but no space of their own, and
 * only reach the pages shared with them (permissions.ts already decides page by page). What they may not do besides
 * is listed here, refused on the server for every request.
 */

export const isGuest = (user: Pick<UserRow, "role"> | null | undefined) => user?.role === "guest";

/** Administrators can turn guests off: no new ones, and those who exist can't sign in until it is on again. */
export const guestsAllowed = (db: Db) => getInstanceSettings(db).allowGuests;

/**
 * What a guest may not do, by method and path: create a space, have a home page or an inbox (they live in a space of
 * one's own), make API tokens or connect apps, look people up, share a page or publish it, invite other guests,
 * import files.
 */
const GUEST_DENIED: { methods: string[] | "*"; path: RegExp }[] = [
  { methods: ["POST"], path: /^\/api\/workspaces\/?$/ },
  { methods: "*", path: /^\/api\/(home|inbox|demo)\/?$/ },
  { methods: "*", path: /^\/api\/tokens(\/|$)/ },
  { methods: ["POST"], path: /^\/api\/oauth\/authorize\/?$/ },
  { methods: ["POST"], path: /^\/api\/desktop\/sync\/link\/?$/ },
  { methods: "*", path: /^\/api\/users\/lookup\/?$/ },
  { methods: ["PUT", "DELETE"], path: /^\/api\/pages\/[^/]+\/(shares|public-link)(\/|$)/ },
  { methods: "*", path: /^\/api\/pages\/[^/]+\/guests(\/|$)/ },
  { methods: "*", path: /^\/api\/import\// },
];

/** Whether a guest is refused this request. */
export function guestRefused(method: string, url: string): boolean {
  const path = url.split("?")[0]!;
  return GUEST_DENIED.some((d) => (d.methods === "*" || d.methods.includes(method)) && d.path.test(path));
}

export const guestForbidden = () => new HttpError(403, "guest_forbidden", t("error.guestForbidden"));
export const guestsOff = () => new HttpError(403, "guests_off", t("error.guestsOff"));

/**
 * The people a guest sees in the directory: those the pages shared with them are shared with (on the page itself or
 * above it), and those who shared them. Never the members of the space the page is in.
 */
export function guestKnownUserIds(db: Db, guestId: string): Set<string> {
  const known = new Set<string>([guestId]);
  const grants = db
    .select({ pageId: pagePermissions.pageId, grantedBy: pagePermissions.grantedBy })
    .from(pagePermissions)
    .where(eq(pagePermissions.userId, guestId))
    .all();
  const pageIds = new Set<string>();
  for (const g of grants) {
    if (g.grantedBy) known.add(g.grantedBy);
    for (const c of getChain(db, g.pageId)) pageIds.add(c.id);
  }
  if (!pageIds.size) return known;
  const list = sql.join(
    [...pageIds].map((id) => sql`${id}`),
    sql`, `,
  );
  for (const r of db.all<{ id: string; by: string | null }>(sql`SELECT user_id AS id, granted_by AS by FROM page_permissions WHERE page_id IN (${list})`)) {
    known.add(r.id);
    if (r.by) known.add(r.by);
  }
  return known;
}

/** A guest becoming a member gets the space of their own they didn't have. */
export function ensurePersonalWorkspace(db: DbLike, userId: string) {
  const has = db
    .select({ id: workspaces.id })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaces.kind, "personal")))
    .get();
  if (has) return;
  const workspaceId = randomUUID();
  db.insert(workspaces).values({ id: workspaceId, name: t("workspace.personal"), kind: "personal", createdBy: userId }).run();
  db.insert(workspaceMembers).values({ workspaceId, userId, role: "owner" }).run();
}

type Invitation = typeof invitations.$inferSelect;

/** Whether a guest's invitation can still be used: guests allowed, and its page still there (not in the trash). */
export function guestInvitationUsable(db: Db, inv: Invitation): boolean {
  if (inv.role !== "guest") return true;
  if (!guestsAllowed(db) || !inv.pageId) return false;
  const chain = getChain(db, inv.pageId);
  return chain.length > 0 && !isTrashed(chain);
}

/** Once the guest's account exists: the page they were invited on is shared with them. */
export function grantInvitedPage(db: Db, inv: Invitation, userId: string) {
  if (inv.role !== "guest" || !inv.pageId) return;
  const role = inv.pageRole ?? "viewer";
  db.insert(pagePermissions)
    .values({ pageId: inv.pageId, userId, role, grantedBy: inv.createdBy })
    .onConflictDoUpdate({ target: [pagePermissions.pageId, pagePermissions.userId], set: { role } })
    .run();
}
