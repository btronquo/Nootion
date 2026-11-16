import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { atLeast, t, type SyncedBlockInfo, type SyncedBlockSummary } from "@nootion/shared";
import type { Db } from "./db/index.js";
import { pages } from "./db/schema.js";
import { getChain, getPageRole, isTrashed, roleFromChain } from "./permissions.js";
import { nextPosition } from "./pages.js";
import { readContent, writeContent, type Collab, type ProseMirrorNode } from "./collab.js";

/**
 * Synced blocks: the same blocks shown in several pages.
 *
 * The content lives in a hidden page of its own (kind "block"), child of the page where the block was made, so that
 * live editing, history, permissions, the trash and the desktop sync work as for any page. Each page that shows it
 * holds a node `syncedBlock { sourceId }`, whose view edits that hidden page. Reading a copy needs access to the page
 * where the content lives: anyone else sees "No access to this content".
 */
export const SYNCED_NODE = "syncedBlock";

/** Creates the hidden page of a new synced block under `hostId`, with `content` (blocks of the editor's JSON). */
export async function createSyncedBlock(
  collab: Collab,
  db: Db,
  host: { id: string; workspaceId: string },
  userId: string,
  content: ProseMirrorNode[] | undefined,
): Promise<string> {
  const id = randomUUID();
  db.insert(pages)
    .values({
      id,
      workspaceId: host.workspaceId,
      parentId: host.id,
      kind: "block",
      title: "",
      position: nextPosition(db, host.workspaceId, host.id),
      createdBy: userId,
    })
    .run();
  await writeContent(collab, db, id, { type: "doc", content: content?.length ? content : [{ type: "paragraph" }] });
  return id;
}

/** Whether a node is (or holds) a synced block showing `id`. */
function shows(node: ProseMirrorNode, id: string): boolean {
  if (node.type === SYNCED_NODE && node.attrs?.sourceId === id) return true;
  return (node.content ?? []).some((c) => shows(c, id));
}

/** Pages (live, readable by the user) that show the synced block, most recently edited first. */
export function syncedBlockPages(db: Db, userId: string, id: string): SyncedBlockInfo["pages"] {
  // Page ids are unique strings: a quick text search narrows down the pages, then their content is checked.
  const candidates = db
    .select({ id: pages.id, title: pages.title, icon: pages.icon, kind: pages.kind, content: pages.contentJson })
    .from(pages)
    .where(and(isNull(pages.deletedAt), sql`${pages.kind} <> 'block'`, sql`instr(${pages.contentJson}, ${id}) > 0`))
    .orderBy(sql`${pages.updatedAt} desc`)
    .all();
  return candidates
    .filter((p) => p.content && shows(p.content as ProseMirrorNode, id) && atLeast(getPageRole(db, userId, p.id), "viewer"))
    .map((p) => ({ id: p.id, title: p.title, icon: p.icon }));
}

/** What a page showing the synced block needs: its content, where it lives and where else it is shown. Null: no access. */
export function syncedBlockInfo(collab: Collab, db: Db, userId: string, id: string): SyncedBlockInfo | null {
  const chain = getChain(db, id);
  const block = chain[0] ? db.select({ kind: pages.kind, locked: pages.locked }).from(pages).where(eq(pages.id, id)).get() : undefined;
  if (!block || block.kind !== "block" || isTrashed(chain)) return null;
  const role = roleFromChain(db, userId, chain);
  if (!role || !atLeast(role, "viewer")) return null;
  const host = chain[1];
  return {
    id,
    host: host ? { id: host.id, title: host.title, icon: host.icon } : { id, title: "", icon: null },
    role,
    locked: block.locked,
    content: readContent(collab, db, id),
    pages: syncedBlockPages(db, userId, id),
  };
}

/** Synced blocks the user can read, for "/synced": those whose text or host page matches `query`, latest first. */
export function listSyncedBlocks(db: Db, userId: string, query: string, limit = 30): SyncedBlockSummary[] {
  const q = query.trim().toLowerCase();
  const rows = db
    .select({ id: pages.id, text: pages.contentText, updatedAt: pages.updatedAt, parentId: pages.parentId })
    .from(pages)
    .where(and(eq(pages.kind, "block"), isNull(pages.deletedAt)))
    .orderBy(sql`${pages.updatedAt} desc`)
    .limit(2000)
    .all();
  const out: SyncedBlockSummary[] = [];
  for (const r of rows) {
    const chain = getChain(db, r.id);
    const host = chain[1];
    if (!host || isTrashed(chain) || !atLeast(roleFromChain(db, userId, chain), "viewer")) continue;
    const text = (r.text ?? "")
      .trim()
      .replace(/\s*\n\s*/g, " · ")
      .replace(/\s+/g, " ");
    if (q && !text.toLowerCase().includes(q) && !host.title.toLowerCase().includes(q)) continue;
    // Never used: an empty block nobody wrote in, left by a "/synced" given up at once.
    if (!text && !syncedBlockPages(db, userId, r.id).length) continue;
    out.push({ id: r.id, host: { id: host.id, title: host.title, icon: host.icon }, preview: text.slice(0, 160), updatedAt: r.updatedAt.toISOString() });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Content with the synced blocks replaced by their own content (exports, public pages, Markdown through the API).
 * `canRead` says whether the content of a synced block may be shown; the others become a line saying so.
 */
export function inlineSyncedBlocks(db: Db, node: ProseMirrorNode, canRead: (id: string) => boolean, seen: string[] = []): ProseMirrorNode {
  if (!node.content) return node;
  const content: ProseMirrorNode[] = [];
  for (const child of node.content) {
    if (child.type !== SYNCED_NODE) {
      content.push(inlineSyncedBlocks(db, child, canRead, seen));
      continue;
    }
    const id = typeof child.attrs?.sourceId === "string" ? child.attrs.sourceId : null;
    const row = id ? db.select({ kind: pages.kind, json: pages.contentJson }).from(pages).where(eq(pages.id, id)).get() : undefined;
    // A synced block that shows itself, deep down, stops there.
    if (!id || !row || row.kind !== "block" || seen.includes(id) || !canRead(id)) {
      content.push({ type: "paragraph", content: [{ type: "text", text: t("synced.noAccess"), marks: [{ type: "italic" }] }] });
      continue;
    }
    const inner = inlineSyncedBlocks(db, (row.json as ProseMirrorNode | null) ?? { type: "doc", content: [] }, canRead, [...seen, id]);
    content.push(...(inner.content ?? []));
  }
  return { ...node, content };
}

/** Whether the user can read a synced block's content (live, and shared with them). */
export const canReadSynced = (db: Db, userId: string) => (id: string) => atLeast(getPageRole(db, userId, id), "viewer");
