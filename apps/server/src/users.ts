import { randomUUID } from "node:crypto";
import type { PublicUser, UserRole } from "@nootion/shared";
import type { Db } from "./db/index.js";
import { users, workspaceMembers, workspaces } from "./db/schema.js";
import { hashPassword } from "./auth/password.js";

export type UserRow = typeof users.$inferSelect;

export function toPublicUser(u: UserRow): PublicUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    disabled: u.disabled,
    createdAt: u.createdAt.toISOString(),
  };
}

/** Creates a user together with their private personal workspace. */
export async function createUser(
  db: Db,
  input: { name: string; email: string; password: string; role: UserRole },
): Promise<UserRow> {
  const passwordHash = await hashPassword(input.password);
  return db.transaction((tx) => {
    const user = tx
      .insert(users)
      .values({ id: randomUUID(), name: input.name, email: input.email, passwordHash, role: input.role })
      .returning()
      .get();
    const workspaceId = randomUUID();
    tx.insert(workspaces).values({ id: workspaceId, name: "Espace personnel", kind: "personal", createdBy: user.id }).run();
    tx.insert(workspaceMembers).values({ workspaceId, userId: user.id, role: "owner" }).run();
    return user;
  });
}
