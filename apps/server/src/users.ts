import { randomUUID } from "node:crypto";
import path from "node:path";
import { isLocale, t, type Locale, type PublicUser, type UserRole } from "@nootion/shared";
import { sql } from "drizzle-orm";
import type { Db } from "./db/index.js";
import { users, workspaceMembers, workspaces } from "./db/schema.js";
import { hashPassword } from "./auth/password.js";

export type UserRow = typeof users.$inferSelect;

export const avatarsDir = (dataDir: string) => path.join(dataDir, "avatars");

/** The file name changes with every upload, so it doubles as a cache buster. */
export const avatarUrl = (u: Pick<UserRow, "id" | "avatar">) => (u.avatar ? `/api/users/${u.id}/avatar?v=${u.avatar}` : null);

export function toPublicUser(u: UserRow): PublicUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    avatarUrl: avatarUrl(u),
    role: u.role,
    disabled: u.disabled,
    locale: isLocale(u.locale) ? u.locale : "en",
    twoFactor: !!u.totpSecret,
    createdAt: u.createdAt.toISOString(),
  };
}

/** Creates a user together with their private personal workspace. */
export async function createUser(
  db: Db,
  input: { name: string; email: string; password: string; role: UserRole; locale: Locale },
): Promise<UserRow> {
  const passwordHash = await hashPassword(input.password);
  return db.transaction((tx) => {
    const user = tx
      .insert(users)
      .values({ id: randomUUID(), name: input.name, email: input.email, passwordHash, role: input.role, locale: input.locale })
      .returning()
      .get();
    const workspaceId = randomUUID();
    tx.insert(workspaces).values({ id: workspaceId, name: t("workspace.personal"), kind: "personal", createdBy: user.id }).run();
    tx.insert(workspaceMembers).values({ workspaceId, userId: user.id, role: "owner" }).run();
    return user;
  });
}

/**
 * Who a user sees in the directory: the people they work with, not every account of the server. That is the members
 * of the shared spaces they belong to, the people their pages are shared with, and, for pages shared with them, the
 * people of those pages (their space's members and the others they are shared with). Administrators see everyone (null).
 */
export function knownUserIds(db: Db, user: Pick<UserRow, "id" | "role">): Set<string> | null {
  if (user.role === "admin") return null;
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
  const known = new Set<string>([user.id]);
  const add = (list: string[]) => list.forEach((id) => known.add(id));
  // Spaces the user belongs to, and those of the pages shared with them.
  const mine = ids(db.all<{ id: string }>(sql`SELECT workspace_id AS id FROM workspace_members WHERE user_id = ${user.id}`));
  const guestOf = ids(
    db.all<{ id: string }>(sql`SELECT DISTINCT p.workspace_id AS id FROM page_permissions pp JOIN pages p ON p.id = pp.page_id WHERE pp.user_id = ${user.id}`),
  );
  const spaces = [...new Set([...mine, ...guestOf])];
  if (!spaces.length) return known;
  const list = sql.join(
    spaces.map((id) => sql`${id}`),
    sql`, `,
  );
  add(ids(db.all<{ id: string }>(sql`SELECT DISTINCT user_id AS id FROM workspace_members WHERE workspace_id IN (${list})`)));
  add(ids(db.all<{ id: string }>(sql`SELECT DISTINCT pp.user_id AS id FROM page_permissions pp JOIN pages p ON p.id = pp.page_id WHERE p.workspace_id IN (${list})`)));
  return known;
}
