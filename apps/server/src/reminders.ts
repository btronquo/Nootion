import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";
import webpush from "web-push";
import { atLeast, type Reminder } from "@nootion/shared";
import type { Db } from "./db/index.js";
import { pages, pushSubscriptions, reminders } from "./db/schema.js";
import { prosemirrorToText, type ProseMirrorNode } from "./collab.js";
import { getPageRole } from "./permissions.js";

interface Found {
  mentionId: string;
  userId: string;
  date: string;
  remindAt: Date;
  text: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;

/** The line of text a date is in, without the dates themselves (shown apart). */
const lineText = (block: ProseMirrorNode) =>
  prosemirrorToText({ ...block, content: (block.content ?? []).filter((c) => c.type !== "dateMention") })
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);

/** Dates with a reminder in a page's content, with the line of text each one is in. */
export function findReminders(content: ProseMirrorNode | null | undefined): Found[] {
  const out: Found[] = [];
  const walk = (node: ProseMirrorNode, block: ProseMirrorNode) => {
    if (node.type === "dateMention") {
      const a = node.attrs ?? {};
      const remindAt = typeof a.remindAt === "string" ? new Date(a.remindAt) : null;
      if (
        typeof a.id === "string" &&
        a.id &&
        typeof a.remindUser === "string" &&
        a.remindUser &&
        typeof a.date === "string" &&
        DATE.test(a.date) &&
        remindAt &&
        !isNaN(+remindAt)
      )
        out.push({ mentionId: a.id, userId: a.remindUser, date: a.date, remindAt, text: lineText(block) });
      return;
    }
    const inline = node.content?.some((c) => c.type === "text" || c.type === "dateMention");
    for (const c of node.content ?? []) walk(c, inline ? node : c);
  };
  if (content) walk(content, content);
  return out;
}

/**
 * Brings the reminders of a page in line with its content: new dates get one, changed dates start again,
 * removed ones go. Pages used as templates have none.
 */
export function syncReminders(db: Db, pageId: string, content: ProseMirrorNode | null | undefined) {
  const page = db.select({ template: pages.template }).from(pages).where(eq(pages.id, pageId)).get();
  const found = page && !page.template ? findReminders(content) : [];
  const existing = new Map(
    db
      .select()
      .from(reminders)
      .where(eq(reminders.pageId, pageId))
      .all()
      .map((r) => [r.mentionId, r]),
  );
  if (!found.length && !existing.size) return;
  db.transaction((tx) => {
    const seen = new Set<string>();
    for (const f of found) {
      // A date copied and pasted keeps its id: the first one counts.
      if (seen.has(f.mentionId)) continue;
      seen.add(f.mentionId);
      const old = existing.get(f.mentionId);
      if (!old) {
        tx.insert(reminders)
          .values({ id: randomUUID(), pageId, ...f })
          .run();
      } else if (old.remindAt.getTime() !== f.remindAt.getTime() || old.userId !== f.userId) {
        tx.update(reminders)
          .set({ ...f, notifiedAt: null, dismissedAt: null })
          .where(eq(reminders.id, old.id))
          .run();
      } else if (old.text !== f.text || old.date !== f.date) {
        tx.update(reminders).set({ text: f.text, date: f.date }).where(eq(reminders.id, old.id)).run();
      }
    }
    const gone = [...existing.values()].filter((r) => !seen.has(r.mentionId)).map((r) => r.id);
    if (gone.length) tx.delete(reminders).where(inArray(reminders.id, gone)).run();
  });
}

/** A user's reminders still to deal with, on pages they can still open, soonest first. */
export function listReminders(db: Db, userId: string, now = new Date()): Reminder[] {
  const rows = db
    .select({ r: reminders, title: pages.title, icon: pages.icon })
    .from(reminders)
    .innerJoin(pages, eq(pages.id, reminders.pageId))
    .where(and(eq(reminders.userId, userId), isNull(reminders.dismissedAt)))
    .orderBy(asc(reminders.remindAt))
    .all();
  return rows
    .filter(({ r }) => atLeast(getPageRole(db, userId, r.pageId), "viewer"))
    .map(({ r, title, icon }) => ({
      id: r.id,
      pageId: r.pageId,
      pageTitle: title,
      pageIcon: icon,
      date: r.date,
      remindAt: r.remindAt.toISOString(),
      text: r.text,
      due: r.remindAt <= now,
    }));
}

/** The server's keys for Web Push, made on first use and kept in the data folder. */
export function vapidKeys(dataDir: string): { publicKey: string; privateKey: string } {
  const file = path.join(dataDir, "vapid.json");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    const keys = webpush.generateVAPIDKeys();
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
    return keys;
  }
}

/** Reminders older than this when first seen (the server was stopped, a date set in the past) aren't pushed. */
const TOO_LATE = 24 * 3600_000;

export type PushSender = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<unknown>;

/**
 * Background job that sends reminders as they fall due to every device of their user that accepted notifications.
 * The app also shows them itself while it is open.
 */
export function createNotifier(db: Db, opts: { dataDir: string; appUrl: string; log: { warn: (o: unknown, msg: string) => void }; send?: PushSender }) {
  let send = opts.send;
  const sender = (): PushSender => {
    if (send) return send;
    const keys = vapidKeys(opts.dataDir);
    // Push services want a way to reach the server's owner: its https address, or a placeholder address.
    const subject = opts.appUrl.startsWith("https://") ? opts.appUrl : `mailto:nootion@${new URL(opts.appUrl).hostname || "localhost"}`;
    return (send = (sub, payload) => webpush.sendNotification(sub, payload, { vapidDetails: { subject, ...keys }, TTL: 3600 }));
  };

  /** Sends a notification to every device of a user. */
  async function push(userId: string, payload: { title: string; body: string; url: string; tag: string }) {
    for (const s of db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)).all()) {
      try {
        await sender()({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload));
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // The device unsubscribed or the browser was reset.
        if (status === 404 || status === 410) db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, s.endpoint)).run();
        else opts.log.warn({ err }, "Couldn't send a notification");
      }
    }
  }

  let running = false;
  async function tick(now = new Date()) {
    if (running) return;
    running = true;
    try {
      const due = db
        .select({ r: reminders, title: pages.title, icon: pages.icon })
        .from(reminders)
        .innerJoin(pages, eq(pages.id, reminders.pageId))
        .where(and(lte(reminders.remindAt, now), isNull(reminders.notifiedAt), isNull(reminders.dismissedAt)))
        .all();
      for (const { r, title, icon } of due) {
        db.update(reminders).set({ notifiedAt: now }).where(eq(reminders.id, r.id)).run();
        if (now.getTime() - r.remindAt.getTime() > TOO_LATE || !atLeast(getPageRole(db, r.userId, r.pageId), "viewer")) continue;
        await push(r.userId, { title: `${icon ? `${icon} ` : ""}${title || "Nootion"}`, body: r.text || r.date.replace("T", " "), url: `/page/${r.pageId}`, tag: r.id });
      }
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => void tick(), 30_000);
  timer.unref();
  return {
    publicKey: () => vapidKeys(opts.dataDir).publicKey,
    tick,
    push,
    stop: () => clearInterval(timer),
  };
}

export type Notifier = ReturnType<typeof createNotifier>;
