import { and, isNull, ne, sql } from "drizzle-orm";
import type { Backlink } from "@nootion/shared";
import type { Db } from "./db/index.js";
import { pages } from "./db/schema.js";
import { prosemirrorToText, type ProseMirrorNode } from "./collab.js";
import { getPageRole, getChain, isTrashed } from "./permissions.js";
import { toSummary } from "./pages.js";

const EXCERPT = 160;

/** Whether a node is (or holds) a link to the page: a page link or mention, or a text link to /page/<id>. */
function linksTo(node: ProseMirrorNode, pageId: string): boolean {
  if ((node.type === "pageLink" || node.type === "pageMention") && node.attrs?.pageId === pageId) return true;
  if (node.marks?.some((m) => m.type === "link" && typeof m.attrs?.href === "string" && m.attrs.href.includes(`/page/${pageId}`))) return true;
  return (node.content ?? []).some((c) => linksTo(c, pageId));
}

/** Text of the first block that holds the link. */
function excerpt(node: ProseMirrorNode, pageId: string): string | null {
  for (const child of node.content ?? []) {
    if (!linksTo(child, pageId)) continue;
    const isTextBlock = (child.content ?? []).some((c) => c.type === "text" || c.type === "pageLink" || c.type === "pageMention");
    if (isTextBlock || !child.content?.length) {
      const text = prosemirrorToText(child).replace(/\s+/g, " ").trim();
      return text.length > EXCERPT ? `${text.slice(0, EXCERPT - 1)}…` : text;
    }
    return excerpt(child, pageId);
  }
  return null;
}

/** Pages the user can read that link to or mention a page, most recently edited first. */
export function listBacklinks(db: Db, userId: string, pageId: string): Backlink[] {
  // Page ids are unique strings: a quick text search narrows down the pages, then their content is checked.
  const candidates = db
    .select()
    .from(pages)
    .where(and(ne(pages.id, pageId), isNull(pages.deletedAt), sql`instr(${pages.contentJson}, ${pageId}) > 0`))
    .orderBy(sql`${pages.updatedAt} desc`)
    .all();
  const result: Backlink[] = [];
  for (const p of candidates) {
    const content = p.contentJson as ProseMirrorNode | null;
    if (!content || !linksTo(content, pageId)) continue;
    if (!getPageRole(db, userId, p.id) || isTrashed(getChain(db, p.id))) continue;
    result.push({ ...toSummary(p), excerpt: excerpt(content, pageId) ?? "" });
  }
  return result;
}
