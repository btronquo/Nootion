import { and, eq, gt, lt } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { sessions, users } from "../db/schema.js";
import { hashToken, newToken } from "./tokens.js";

export const SESSION_COOKIE = "nootion_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createSession(db: Db, userId: string): { token: string; expiresAt: Date } {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  db.insert(sessions).values({ tokenHash: hashToken(token), userId, expiresAt }).run();
  return { token, expiresAt };
}

export function findSessionUser(db: Db, token: string) {
  const row = db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .get();
  if (!row || row.user.disabled) return null;
  return row.user;
}

export function deleteSession(db: Db, token: string): void {
  db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token))).run();
}

export function deleteUserSessions(db: Db, userId: string): void {
  db.delete(sessions).where(eq(sessions.userId, userId)).run();
}

export function purgeExpiredSessions(db: Db): void {
  db.delete(sessions).where(lt(sessions.expiresAt, new Date())).run();
}
