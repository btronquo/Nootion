import { randomBytes } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { and, desc, eq, gte, inArray, like, lt, or, sql, type SQL } from "drizzle-orm";
import { AUDIT_CATEGORIES, type AuditAction, type AuditEvent, type AuditQuery } from "@nootion/shared";
import type { Db } from "./db/index.js";
import { auditEvents, users } from "./db/schema.js";
import { getInstanceSettings } from "./settings.js";

type Person = { id: string; name: string; email: string };

export interface AuditEntry {
  action: AuditAction;
  /** Who did it; the signed-in person by default. `null` for someone unknown (a failed sign-in). */
  actor?: Person | null;
  target?: { type: "page" | "workspace" | "user" | "group" | "invitation" | "token" | "settings" | "form"; id?: string | null; label?: string | null };
  /** Small facts about the change (a role, the settings changed): never page content. */
  details?: Record<string, unknown>;
}

let lastMs = 0;
let seq = 0;
/**
 * A UUID (version 7) that sorts in the order lines were written: the time in milliseconds, then a counter for lines
 * written in the same millisecond, then random bits. The log is listed by time then id, so lines of the same
 * millisecond keep their order.
 */
export function timeOrderedId(): string {
  let ms = Date.now();
  if (ms <= lastMs) {
    ms = lastMs;
    seq++;
    // 4096 lines in one millisecond: borrow the next one.
    if (seq > 0xfff) ((ms = ++lastMs), (seq = 0));
  } else {
    lastMs = ms;
    seq = 0;
  }
  const b = randomBytes(16);
  b.writeUIntBE(ms, 0, 6);
  b[6] = 0x70 | (seq >> 8);
  b[7] = seq & 0xff;
  b[8] = 0x80 | (b[8]! & 0x3f);
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Adds a line to the activity log. Called by the routes concerned after the change is made; it never makes a
 * request fail (the log is a record, not a gate).
 */
export function audit(db: Db, req: FastifyRequest | null, entry: AuditEntry): void {
  const actor = entry.actor === undefined ? (req?.user ?? null) : entry.actor;
  const details = { ...entry.details };
  // Done by an app with a personal token: the token's name says which one.
  if (req?.tokenScope) details.token = req.tokenScope.name;
  try {
    db.insert(auditEvents)
      .values({
        id: timeOrderedId(),
        actorId: actor?.id ?? null,
        actorName: actor?.name ?? null,
        actorEmail: actor?.email ?? null,
        action: entry.action,
        targetType: entry.target?.type ?? null,
        targetId: entry.target?.id ?? null,
        targetLabel: entry.target?.label ?? null,
        details: Object.keys(details).length ? details : null,
        ip: req?.ip ?? null,
      })
      .run();
  } catch (err) {
    req?.log.warn({ err, action: entry.action }, "Couldn't write to the activity log");
  }
}

/** A person, as the log names them: looked up by id. */
export function personTarget(db: Db, userId: string): { type: "user"; id: string; label: string | null } {
  const u = db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId)).get();
  return { type: "user", id: userId, label: u ? `${u.name} <${u.email}>` : null };
}

/** A part of the settings, as the log names it ("server" for Administration › Security). */
export const settingsTarget = (section: "server" | "mail" | "sso" | "backups" | "plugins", id?: string) => ({
  type: "settings" as const,
  id: id ?? section,
  label: id ? `${section}:${id}` : section,
});

/** The keys whose value differs between two objects, for "settings changed" (values are left out: some are secrets). */
export function changedKeys(before: object | null | undefined, after: object | null | undefined): string[] {
  const a = (before ?? {}) as Record<string, unknown>;
  const b = (after ?? {}) as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).sort();
}

function toEvent(r: typeof auditEvents.$inferSelect): AuditEvent {
  return {
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    actor: r.actorId || r.actorName || r.actorEmail ? { id: r.actorId, name: r.actorName, email: r.actorEmail } : null,
    action: r.action,
    target: r.targetType ? { type: r.targetType, id: r.targetId, label: r.targetLabel } : null,
    details: r.details ?? null,
    ip: r.ip,
  };
}

/** The cursor of a line: its time and id, so that lines of the same millisecond aren't skipped. */
const cursorOf = (e: { createdAt: Date; id: string }) => Buffer.from(`${e.createdAt.getTime()}:${e.id}`).toString("base64url");

function parseCursor(cursor: string): { at: number; id: string } | null {
  const [at, id] = Buffer.from(cursor, "base64url").toString().split(":");
  return Number.isFinite(Number(at)) && id ? { at: Number(at), id } : null;
}

/** Midnight UTC of a "YYYY-MM-DD" day; the browser sends days, and the log is read in whole days. */
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

function conditions(q: Omit<AuditQuery, "limit" | "before">, tzOffsetMin = 0): SQL[] {
  const where: SQL[] = [];
  if (q.action) where.push(eq(auditEvents.action, q.action));
  else if (q.category) where.push(inArray(auditEvents.action, [...AUDIT_CATEGORIES[q.category]]));
  if (q.actorId) where.push(eq(auditEvents.actorId, q.actorId));
  // The days are the reader's: shifted by their time zone.
  const shift = tzOffsetMin * 60_000;
  if (q.from) where.push(gte(auditEvents.createdAt, new Date(day(q.from).getTime() + shift)));
  if (q.to) where.push(lt(auditEvents.createdAt, new Date(day(q.to).getTime() + 86_400_000 + shift)));
  if (q.q) {
    const pattern = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const has = (col: AnySQLiteColumn) => sql`${col} like ${pattern} escape '\\'`;
    where.push(
      or(has(auditEvents.actorName), has(auditEvents.actorEmail), has(auditEvents.targetLabel), has(auditEvents.ip), like(auditEvents.action, pattern))!,
    );
  }
  return where;
}

/** A page of the log, latest first. */
export function listAuditEvents(db: Db, q: AuditQuery, tzOffsetMin = 0): { events: AuditEvent[]; next: string | null } {
  const where = conditions(q, tzOffsetMin);
  const cursor = q.before ? parseCursor(q.before) : null;
  if (cursor) {
    const at = new Date(cursor.at);
    where.push(or(lt(auditEvents.createdAt, at), and(eq(auditEvents.createdAt, at), lt(auditEvents.id, cursor.id)))!);
  }
  const rows = db
    .select()
    .from(auditEvents)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(q.limit + 1)
    .all();
  const more = rows.length > q.limit;
  const page = rows.slice(0, q.limit);
  return { events: page.map(toEvent), next: more ? cursorOf(page[page.length - 1]!) : null };
}

/** Every line matching the filters, latest first, for the CSV export. */
export function* allAuditEvents(db: Db, q: Omit<AuditQuery, "limit" | "before">, tzOffsetMin = 0): Generator<AuditEvent> {
  let before: string | undefined;
  for (;;) {
    const { events, next } = listAuditEvents(db, { ...q, limit: 200, before }, tzOffsetMin);
    yield* events;
    if (!next) return;
    before = next;
  }
}

/** Lines older than the chosen time go; called every hour. */
export function purgeOldAuditEvents(db: Db, now = Date.now()): number {
  const days = getInstanceSettings(db).auditRetentionDays;
  if (!days) return 0;
  return db
    .delete(auditEvents)
    .where(lt(auditEvents.createdAt, new Date(now - days * 86_400_000)))
    .run().changes;
}

/** The people who appear in the log, for its "who" filter (including people since deleted, by name). */
export function auditActors(db: Db): { id: string; name: string; email: string }[] {
  return db
    .selectDistinct({ id: auditEvents.actorId, name: auditEvents.actorName, email: auditEvents.actorEmail })
    .from(auditEvents)
    .where(sql`${auditEvents.actorId} is not null`)
    .all()
    .reduce<{ id: string; name: string; email: string }[]>((all, r) => {
      if (!all.some((a) => a.id === r.id)) all.push({ id: r.id!, name: r.name ?? "", email: r.email ?? "" });
      return all;
    }, [])
    .sort((a, b) => a.name.localeCompare(b.name));
}
