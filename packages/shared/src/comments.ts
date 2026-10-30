import { z } from "zod";

/**
 * Comments on pages. A thread is about a passage of the page (its anchor, two Yjs relative positions that follow the
 * text as it is edited) or about the whole page. A comment's body is plain text where `<@userId>` mentions someone.
 */
export interface CommentInfo {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
}

export interface CommentThread {
  id: string;
  pageId: string;
  /** Where the passage starts and ends, as encoded Yjs relative positions (base64). Null for the whole page. */
  anchor: { start: string; end: string } | null;
  /** The passage as it was when the thread started. */
  quote: string;
  resolvedAt: string | null;
  resolvedByName: string | null;
  comments: CommentInfo[];
}

/** A mention or a reply that concerns the user. */
export interface CommentNotification {
  id: string;
  kind: "mention" | "reply";
  pageId: string;
  pageTitle: string;
  pageIcon: string | null;
  threadId: string;
  actorName: string;
  /** The comment's text, mentions written as names. */
  excerpt: string;
  createdAt: string;
  read: boolean;
}

const body = z.string().trim().min(1).max(10_000);
const position = z.string().min(1).max(2000);

export const createThreadInput = z.object({
  body,
  anchor: z.object({ start: position, end: position }).nullable().default(null),
  quote: z.string().max(1000).default(""),
});
export const commentBodyInput = z.object({ body });
export const resolveThreadInput = z.object({ resolved: z.boolean() });

const MENTION = /<@([A-Za-z0-9-]{1,64})>/g;

/** The ids of the people a comment mentions. */
export function commentMentions(text: string): string[] {
  return [...new Set([...text.matchAll(MENTION)].map((m) => m[1]!))];
}

/** A comment's text with mentions written as "@Name". */
export function commentPlainText(text: string, nameOf: (userId: string) => string | undefined): string {
  return text.replace(MENTION, (_, id: string) => `@${nameOf(id) ?? "?"}`);
}
