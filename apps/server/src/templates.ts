import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import * as Y from "yjs";
import type { Db } from "./db/index.js";
import { attachments, databaseProperties, databaseViews, pages } from "./db/schema.js";
import { attachmentPath } from "./attachments.js";
import { encodeContent, setProsemirrorJSON, writeContent, type Collab, type ProseMirrorNode } from "./collab.js";
import { listDescendants } from "./pages.js";

export interface CopyTarget {
  workspaceId: string;
  parentId: string | null;
  position: number;
  userId: string;
  /** Whether the copy's root is itself a template (making a template from a page). */
  template?: boolean;
}

/**
 * Calendar blocks get a new id, so iCal links of the original don't follow the copy. Dates lose their reminder:
 * it was set for the original.
 */
function renewBlockIds(node: ProseMirrorNode): ProseMirrorNode {
  const attrs =
    (node.type === "calendarBlock" || node.type === "buttonBlock") && node.attrs
      ? { ...node.attrs, id: randomUUID() }
      : node.type === "dateMention" && node.attrs
        ? { ...node.attrs, id: randomUUID(), reminder: null, remindAt: null, remindUser: null }
        : node.attrs;
  return { ...node, ...(attrs ? { attrs } : {}), ...(node.content ? { content: node.content.map(renewBlockIds) } : {}) };
}

/**
 * Copies a page with everything under it: subpages, databases (columns, views, rows, row templates), content and
 * attached files. Every id inside the copy (pages, columns, views, files) is replaced by the new one, wherever it
 * appears: links between pages, cells, view settings, file links. Links to pages outside the copy are kept.
 *
 * With `into`, the root's content goes into that existing page (applying a template), and its subpages under it.
 * Returns the id of the copy's root.
 */
export async function copyTree(
  db: Db,
  collab: Collab,
  dataDir: string,
  sourceId: string,
  target: CopyTarget,
  into?: { pageId: string; title: string; icon: string | null; cover: string | null },
): Promise<string> {
  const root = db.select().from(pages).where(eq(pages.id, sourceId)).get();
  if (!root) throw new Error("Unknown page");
  const below = listDescendants(db, sourceId);
  const sources = [
    root,
    ...db
      .select()
      .from(pages)
      .where(
        inArray(
          pages.id,
          below.map((p) => p.id),
        ),
      )
      .all(),
  ];
  const pageIds = sources.map((p) => p.id);

  const ids = new Map<string, string>(pageIds.map((id) => [id, randomUUID()]));
  if (into) ids.set(sourceId, into.pageId);
  const databases = sources.filter((p) => p.kind === "database").map((p) => p.id);
  const props = databases.length ? db.select().from(databaseProperties).where(inArray(databaseProperties.databaseId, databases)).all() : [];
  const views = databases.length ? db.select().from(databaseViews).where(inArray(databaseViews.databaseId, databases)).all() : [];
  const files = db.select().from(attachments).where(inArray(attachments.pageId, pageIds)).all();
  for (const x of [...props, ...views, ...files]) ids.set(x.id, randomUUID());

  const pattern = new RegExp([...ids.keys()].map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
  const remap = <T>(value: T): T =>
    value === null || value === undefined ? value : (JSON.parse(JSON.stringify(value).replace(pattern, (m) => ids.get(m)!)) as T);

  const contents = new Map<string, ProseMirrorNode>();
  db.transaction((tx) => {
    for (const p of sources) {
      const id = ids.get(p.id)!;
      const content = p.contentJson ? renewBlockIds(remap(p.contentJson as ProseMirrorNode)) : null;
      if (p.id === sourceId && into) {
        if (content) contents.set(id, content);
        continue;
      }
      let encoded: ReturnType<typeof encodeContent> | null = null;
      if (content) {
        const doc = new Y.Doc();
        setProsemirrorJSON(doc, content);
        encoded = encodeContent(doc);
      }
      const isRoot = p.id === sourceId;
      tx.insert(pages)
        .values({
          id,
          workspaceId: target.workspaceId,
          parentId: isRoot ? target.parentId : ids.get(p.parentId!)!,
          kind: p.kind,
          title: p.title,
          icon: p.icon,
          fullWidth: p.fullWidth,
          cover: remap(p.cover),
          coverPosition: p.coverPosition,
          position: isRoot ? target.position : p.position,
          createdBy: target.userId,
          contentState: encoded?.state ?? null,
          contentJson: encoded?.json ?? null,
          contentText: encoded?.text ?? null,
          props: remap(p.props),
          template: isRoot ? (target.template ?? false) : p.template,
          defaultTemplateId: p.defaultTemplateId ? (ids.get(p.defaultTemplateId) ?? null) : null,
        })
        .run();
    }
    for (const prop of props) {
      const config = { ...(prop.config as Record<string, unknown>) };
      // A two-way relation to a database left out of the copy stays one-way.
      if (typeof config.twinPropertyId === "string" && !ids.has(config.twinPropertyId)) config.twinPropertyId = null;
      tx.insert(databaseProperties)
        .values({
          id: ids.get(prop.id)!,
          databaseId: ids.get(prop.databaseId)!,
          name: prop.name,
          type: prop.type,
          config: remap(config),
          position: prop.position,
        })
        .run();
    }
    for (const v of views) {
      tx.insert(databaseViews)
        .values({ id: ids.get(v.id)!, databaseId: ids.get(v.databaseId)!, name: v.name, type: v.type, config: remap(v.config), position: v.position })
        .run();
    }
    for (const f of files) {
      const id = ids.get(f.id)!;
      const from = attachmentPath(dataDir, f.id);
      if (!fs.existsSync(from)) continue;
      fs.copyFileSync(from, attachmentPath(dataDir, id));
      tx.insert(attachments)
        .values({ id, pageId: ids.get(f.pageId)!, filename: f.filename, mimeType: f.mimeType, size: f.size, createdBy: target.userId, text: f.text, textStatus: f.textStatus })
        .run();
    }
    if (into) {
      tx.update(pages)
        .set({
          title: into.title || root.title,
          icon: into.icon ?? root.icon,
          cover: into.cover ?? remap(root.cover),
          coverPosition: into.cover ? undefined : root.coverPosition,
          fullWidth: root.fullWidth,
          updatedAt: new Date(),
        })
        .where(eq(pages.id, into.pageId))
        .run();
    }
  });
  // The page being filled may be open in an editor: its content goes through the live document.
  for (const [pageId, content] of contents) await writeContent(collab, db, pageId, content);
  return ids.get(sourceId)!;
}
