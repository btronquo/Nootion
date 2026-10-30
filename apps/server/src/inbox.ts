import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { t, type CaptureInput, type InboxItem } from "@nootion/shared";
import type { Db } from "./db/index.js";
import { pages, users, workspaceMembers, workspaces } from "./db/schema.js";
import { linkChildPage, writeContent, type Collab } from "./collab.js";
import { parseMarkdown } from "./markdown-in.js";
import { getPageRole } from "./permissions.js";
import { nextPosition, toSummary } from "./pages.js";

const TITLE_MAX = 200;

/** Id of the user's inbox, created (or created again, if it was deleted) at the top of their personal workspace. */
export function ensureInbox(db: Db, userId: string): string {
  const user = db.select({ inboxPageId: users.inboxPageId }).from(users).where(eq(users.id, userId)).get();
  if (user?.inboxPageId && getPageRole(db, userId, user.inboxPageId)) return user.inboxPageId;
  const personal = db
    .select({ id: workspaces.id })
    .from(workspaces)
    .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaces.kind, "personal")))
    .get();
  if (!personal) throw new Error("No personal workspace");
  const id = randomUUID();
  db.transaction((tx) => {
    tx.insert(pages)
      .values({ id, workspaceId: personal.id, parentId: null, title: t("inbox.title"), icon: "📥", position: -1, createdBy: userId })
      .run();
    tx.update(users).set({ inboxPageId: id }).where(eq(users.id, userId)).run();
  });
  return id;
}

/** The notes still in the inbox, the newest first. */
export function inboxItems(db: Db, inboxId: string): InboxItem[] {
  return db
    .select({ id: pages.id, title: pages.title, icon: pages.icon, createdAt: pages.createdAt })
    .from(pages)
    .where(and(eq(pages.parentId, inboxId), isNull(pages.deletedAt)))
    .orderBy(desc(pages.createdAt))
    .all()
    .map((p) => ({ ...p, createdAt: p.createdAt.toISOString() }));
}

/** Splits a note: its title (given, or its first line) and the Markdown of the rest, with the link at the end. */
export function splitNote(input: CaptureInput): { title: string; markdown: string } {
  let title = input.title?.trim() ?? "";
  let body = input.text.replace(/\r\n?/g, "\n");
  if (!title) {
    const lines = body.split("\n");
    const first = lines.findIndex((l) => l.trim());
    if (first >= 0) {
      title = lines[first]!.replace(/^\s*(#{1,6}\s+|[-*]\s+(\[[ x]\]\s+)?)/, "").trim();
      body = lines.slice(first + 1).join("\n");
    }
  }
  const url = input.url?.trim();
  if (!title && url) title = url;
  if (title.length > TITLE_MAX) {
    body = `${title}\n\n${body}`;
    title = `${title.slice(0, TITLE_MAX - 1)}…`;
  }
  const markdown = [body.trim(), url && url !== title && !body.includes(url) ? `<${url}>` : ""].filter(Boolean).join("\n\n");
  return { title, markdown };
}

/** Drops a note in the user's inbox, as a subpage they file later by moving it. */
export async function capture(db: Db, collab: Collab, userId: string, input: CaptureInput) {
  const inboxId = ensureInbox(db, userId);
  const inbox = db.select({ workspaceId: pages.workspaceId }).from(pages).where(eq(pages.id, inboxId)).get()!;
  const { title, markdown } = splitNote(input);
  const page = db
    .insert(pages)
    .values({
      id: randomUUID(),
      workspaceId: inbox.workspaceId,
      parentId: inboxId,
      title,
      position: nextPosition(db, inbox.workspaceId, inboxId),
      createdBy: userId,
    })
    .returning()
    .get();
  if (markdown) await writeContent(collab, db, page.id, parseMarkdown(markdown));
  await linkChildPage(collab, db, inboxId, page);
  return toSummary(page);
}
