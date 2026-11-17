import { randomUUID } from "node:crypto";
import { and, count, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { t, type GroupDetail, type GroupSummary } from "@nootion/shared";
import type { Db, DbLike } from "./db/index.js";
import { groupMembers, groups, pageGroupPermissions, pages, users, workspaceGroupMembers, workspaces } from "./db/schema.js";
import { HttpError } from "./http.js";
import { avatarUrl } from "./users.js";

/**
 * Groups of people: made by administrators (Administration › Groups) or by the company's directory through SCIM.
 * A space or a page shared with a group counts for everyone in it; permissions.ts reads that through the
 * effective_workspace_members and effective_page_permissions views. Guests are never in a group.
 */

export type GroupRow = typeof groups.$inferSelect;

export const groupNotFound = () => new HttpError(404, "group_not_found", t("error.groupNotFound"));

export function findGroup(db: Db, id: string): GroupRow | undefined {
  return db.select().from(groups).where(eq(groups.id, id)).get();
}

export function requireGroup(db: Db, id: string): GroupRow {
  const g = findGroup(db, id);
  if (!g) throw groupNotFound();
  return g;
}

/** Two groups can't have the same name (whatever the case): people pick them by name. */
export function assertNameFree(db: Db, name: string, exceptId?: string) {
  const taken = db
    .select({ id: groups.id })
    .from(groups)
    .where(and(sql`lower(${groups.name}) = ${name.toLowerCase()}`, ...(exceptId ? [ne(groups.id, exceptId)] : [])))
    .get();
  if (taken) throw new HttpError(409, "group_name_taken", t("error.groupNameTaken"));
}

export function createGroup(db: Db, input: { name: string; description?: string; createdBy?: string | null; scimExternalId?: string | null; scim?: boolean }) {
  assertNameFree(db, input.name);
  return db
    .insert(groups)
    .values({
      id: randomUUID(),
      name: input.name,
      description: input.description ?? "",
      createdBy: input.createdBy ?? null,
      scimExternalId: input.scimExternalId ?? null,
      scim: input.scim ?? false,
    })
    .returning()
    .get();
}

/** Adds people to a group. Guests and unknown accounts are left out; returns those added. */
export function addGroupMembers(db: DbLike, groupId: string, userIds: string[]): string[] {
  if (!userIds.length) return [];
  const ok = db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, userIds), ne(users.role, "guest")))
    .all()
    .map((u) => u.id);
  for (const userId of ok) db.insert(groupMembers).values({ groupId, userId }).onConflictDoNothing().run();
  return ok;
}

export function removeGroupMembers(db: Db, groupId: string, userIds: string[]) {
  if (!userIds.length) return;
  db.delete(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), inArray(groupMembers.userId, userIds)))
    .run();
}

/** Makes the group's members exactly these people (guests left out). */
export function setGroupMembers(db: Db, groupId: string, userIds: string[]) {
  db.transaction((tx) => {
    tx.delete(groupMembers).where(eq(groupMembers.groupId, groupId)).run();
    addGroupMembers(tx, groupId, [...new Set(userIds)]);
  });
}

export function groupMemberIds(db: Db, groupId: string): string[] {
  return db
    .select({ id: groupMembers.userId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId))
    .all()
    .map((r) => r.id);
}

/** How many people each group has (disabled accounts not counted). */
export function memberCounts(db: Db, groupIds?: string[]): Map<string, number> {
  const rows = db
    .select({ id: groupMembers.groupId, n: count() })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(and(eq(users.disabled, false), ...(groupIds ? [inArray(groupMembers.groupId, groupIds.length ? groupIds : [""])] : [])))
    .groupBy(groupMembers.groupId)
    .all();
  return new Map(rows.map((r) => [r.id, r.n]));
}

/** Every group, for sharing and mentions. */
export function listGroups(db: Db, userId: string): GroupSummary[] {
  const counts = memberCounts(db);
  const mine = new Set(
    db
      .select({ id: groupMembers.groupId })
      .from(groupMembers)
      .where(eq(groupMembers.userId, userId))
      .all()
      .map((r) => r.id),
  );
  return db
    .select()
    .from(groups)
    .orderBy(sql`lower(${groups.name})`)
    .all()
    .map((g) => ({ id: g.id, name: g.name, description: g.description, memberCount: counts.get(g.id) ?? 0, mine: mine.has(g.id), scim: g.scim }));
}

/** Every group with its members and what it opens, for administrators. */
export function listGroupDetails(db: Db, userId: string): GroupDetail[] {
  const summaries = listGroups(db, userId);
  const rows = new Map(
    db
      .select()
      .from(groups)
      .all()
      .map((g) => [g.id, g]),
  );
  const members = db
    .select({ groupId: groupMembers.groupId, id: users.id, name: users.name, email: users.email, avatar: users.avatar })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(eq(users.disabled, false))
    .orderBy(sql`lower(${users.name})`)
    .all();
  const spaces = db
    .select({ groupId: workspaceGroupMembers.groupId, id: workspaces.id, name: workspaces.name, role: workspaceGroupMembers.role })
    .from(workspaceGroupMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceGroupMembers.workspaceId))
    .orderBy(workspaces.name)
    .all();
  const shared = db
    .select({ groupId: pageGroupPermissions.groupId, id: pages.id, title: pages.title, role: pageGroupPermissions.role })
    .from(pageGroupPermissions)
    .innerJoin(pages, eq(pages.id, pageGroupPermissions.pageId))
    .where(isNull(pages.deletedAt))
    .orderBy(pages.title)
    .all();
  return summaries.map((g) => ({
    ...g,
    members: members.filter((m) => m.groupId === g.id).map((m) => ({ id: m.id, name: m.name, email: m.email, avatarUrl: avatarUrl(m) })),
    spaces: spaces.filter((s) => s.groupId === g.id).map(({ id, name, role }) => ({ id, name, role })),
    pages: shared.filter((p) => p.groupId === g.id).map(({ id, title, role }) => ({ id, title, role })),
    createdAt: rows.get(g.id)!.createdAt.toISOString(),
  }));
}
