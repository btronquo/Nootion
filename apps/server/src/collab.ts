import type { FastifyInstance } from "fastify";
import { Hocuspocus, type WebSocketLike } from "@hocuspocus/server";
import type {} from "@fastify/websocket";
import { eq } from "drizzle-orm";
import * as Y from "yjs";
import { atLeast } from "@nootion/shared";
import type { Db } from "./db/index.js";
import { pages } from "./db/schema.js";
import { findSessionUser, SESSION_COOKIE } from "./auth/sessions.js";
import { getPageRole } from "./permissions.js";
import { recordSnapshot } from "./history.js";
import { syncReminders } from "./reminders.js";

/** Name of the Y.XmlFragment holding the page body (TipTap's default). */
export const CONTENT_FIELD = "default";

interface CollabContext {
  userId: string;
}

export interface ProseMirrorNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: ProseMirrorNode[];
}

/** Converts the Yjs representation written by y-prosemirror back to ProseMirror JSON, without needing the editor schema. */
function yToJson(item: Y.XmlElement | Y.XmlText | Y.XmlFragment): ProseMirrorNode[] {
  if (item instanceof Y.XmlText) {
    return (item.toDelta() as { insert: unknown; attributes?: Record<string, Record<string, unknown> | null> }[])
      .filter((d) => typeof d.insert === "string" && d.insert.length > 0)
      .map((d) => {
        const node: ProseMirrorNode = { type: "text", text: d.insert as string };
        const marks = Object.entries(d.attributes ?? {}).map(([name, attrs]) => {
          const type = name.split("--")[0];
          return attrs && Object.keys(attrs).length ? { type, attrs } : { type };
        });
        if (marks.length) node.marks = marks;
        return node;
      });
  }
  const children = item.toArray().flatMap((c) => yToJson(c as Y.XmlElement | Y.XmlText));
  if (item instanceof Y.XmlElement) {
    const node: ProseMirrorNode = { type: item.nodeName };
    const attrs = item.getAttributes();
    if (Object.keys(attrs).length) node.attrs = attrs;
    if (children.length) node.content = children;
    return [node];
  }
  return children;
}

export function yDocToProsemirrorJSON(doc: Y.Doc, field = CONTENT_FIELD): ProseMirrorNode {
  return { type: "doc", content: yToJson(doc.getXmlFragment(field)) };
}

/** Writes ProseMirror JSON into a Yjs element the way y-prosemirror does (the editor reads it back as is). */
function fillY(parent: Y.XmlFragment | Y.XmlElement, nodes: ProseMirrorNode[]) {
  let run: ProseMirrorNode[] = [];
  const items: (Y.XmlElement | Y.XmlText)[] = [];
  const pending: { el: Y.XmlElement; node: ProseMirrorNode }[] = [];
  const texts: { el: Y.XmlText; run: ProseMirrorNode[] }[] = [];
  const flush = () => {
    if (!run.length) return;
    const el = new Y.XmlText();
    items.push(el);
    texts.push({ el, run });
    run = [];
  };
  for (const node of nodes) {
    if (node.type === "text") {
      if (node.text) run.push(node);
      continue;
    }
    flush();
    const el = new Y.XmlElement(node.type);
    items.push(el);
    pending.push({ el, node });
  }
  flush();
  parent.insert(parent.length, items);
  for (const { el, run } of texts) {
    let at = 0;
    for (const n of run) {
      const attrs = Object.fromEntries((n.marks ?? []).map((m) => [m.type, m.attrs ?? {}]));
      el.insert(at, n.text!, attrs);
      at += n.text!.length;
    }
  }
  for (const { el, node } of pending) {
    for (const [key, value] of Object.entries(node.attrs ?? {})) if (value !== null && value !== undefined) el.setAttribute(key, value as string);
    if (node.content?.length) fillY(el, node.content);
  }
}

/** Replaces the body of a Yjs document with ProseMirror JSON. */
export function setProsemirrorJSON(doc: Y.Doc, json: ProseMirrorNode, field = CONTENT_FIELD) {
  const fragment = doc.getXmlFragment(field);
  doc.transact(() => {
    fragment.delete(0, fragment.length);
    fillY(fragment, json.content ?? []);
  });
}

const BLOCK_TYPES = new Set(["paragraph", "heading", "listItem", "taskItem", "blockquote", "codeBlock", "tableCell", "tableHeader", "callout", "detailsSummary"]);

/** Plain text of a document, one line per block. Used for search. */
export function prosemirrorToText(node: ProseMirrorNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "pageLink" || node.type === "pageMention") return String(node.attrs?.title ?? "");
  if (node.type === "dateMention") return String(node.attrs?.date ?? "").replace("T", " ");
  const inner = (node.content ?? []).map(prosemirrorToText).join(BLOCK_TYPES.has(node.type) ? "" : "\n");
  return inner.replace(/\n{2,}/g, "\n");
}

export function encodeContent(doc: Y.Doc) {
  const json = yDocToProsemirrorJSON(doc);
  return { state: Buffer.from(Y.encodeStateAsUpdate(doc)), json, text: prosemirrorToText(json).trim() };
}

/**
 * Real-time editing server. Each page is one Yjs document named after the page id.
 * Access is checked against the same permission rules as the REST API, per document.
 */
export function createCollab(db: Db) {
  const sockets = new Set<WebSocketLike & { close(code?: number, reason?: string): void }>();
  // Who edited each open page since its last version.
  const editors = new Map<string, Set<string>>();
  const hocuspocus = new Hocuspocus<CollabContext>({
    debounce: 1500,
    maxDebounce: 10000,
    quiet: true,

    async onAuthenticate({ context, documentName, connectionConfig }) {
      const role = getPageRole(db, context.userId, documentName);
      if (!atLeast(role, "viewer")) throw new Error("forbidden");
      // Viewers and commenters receive updates but cannot send any.
      connectionConfig.readOnly = !atLeast(role, "editor");
    },

    async onLoadDocument({ document, documentName }) {
      const row = db.select({ state: pages.contentState, json: pages.contentJson }).from(pages).where(eq(pages.id, documentName)).get();
      if (row?.state) Y.applyUpdate(document, new Uint8Array(row.state));
      // The content as it was before anyone edits it, if the history doesn't have it yet.
      if (row?.json) recordSnapshot(db, documentName, { content: row.json as ProseMirrorNode });
      return document;
    },

    async onChange({ documentName, context }) {
      const userId = (context as CollabContext | undefined)?.userId;
      if (!userId) return;
      let set = editors.get(documentName);
      if (!set) editors.set(documentName, (set = new Set()));
      set.add(userId);
    },

    async onStoreDocument({ document, documentName }) {
      const { state, json, text } = encodeContent(document);
      db.update(pages)
        .set({ contentState: state, contentJson: json, contentText: text, updatedAt: new Date() })
        .where(eq(pages.id, documentName))
        .run();
      syncReminders(db, documentName, json);
      // A version every few minutes while people edit.
      if (recordSnapshot(db, documentName, { content: json, authors: editors.get(documentName) })) editors.delete(documentName);
    },

    // And one when the last of them leaves.
    async beforeUnloadDocument({ document, documentName }) {
      recordSnapshot(db, documentName, { content: encodeContent(document).json, authors: editors.get(documentName), force: true });
      editors.delete(documentName);
    },
  });
  return Object.assign(hocuspocus, {
    sockets,
    /**
     * Drops every live socket. Clients reconnect within a second and are authenticated again,
     * so anyone who just lost access is cut off while everybody else keeps editing.
     */
    revalidateAll() {
      for (const socket of sockets) socket.close(4000, "revalidate");
    },
  });
}

export type Collab = ReturnType<typeof createCollab>;

/** Mounts the WebSocket endpoint `/collab`. The session cookie authenticates the socket. */
export async function registerCollabRoute(app: FastifyInstance, collab: Collab) {
  app.get("/collab", { websocket: true }, (socket, req) => {
    // Browsers send cookies on cross-site WebSocket handshakes: only accept our own origin.
    const origin = req.headers.origin;
    const allowed = [app.config.appUrl, `${req.protocol}://${req.host}`];
    const token = req.cookies[SESSION_COOKIE];
    const user = token ? findSessionUser(app.db, token) : null;
    if ((origin && !allowed.includes(origin)) || !user) {
      socket.close(4401, "unauthorized");
      return;
    }
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    const request = new Request(`http://localhost${req.url}`, { headers });
    const connection = collab.handleConnection(socket, request, { userId: user.id });
    collab.sockets.add(socket);
    socket.on("message", (data: Buffer) => connection.handleMessage(new Uint8Array(data)));
    socket.on("pong", () => connection.touch());
    socket.on("close", (code: number, reason: Buffer) => {
      collab.sockets.delete(socket);
      connection.handleClose({ code, reason: reason.toString() });
    });
  });
}

/**
 * Changes a page's content, through the live editing server when someone has it open, else on its stored state
 * (devices that edited offline still merge their changes with it).
 */
export async function editContent(collab: Collab, db: Db, pageId: string, change: (doc: Y.Doc) => void) {
  if (collab.documents.has(pageId)) {
    const connection = await collab.openDirectConnection(pageId);
    await connection.transact(change);
    await connection.disconnect();
    return;
  }
  const y = new Y.Doc();
  const row = db.select({ state: pages.contentState }).from(pages).where(eq(pages.id, pageId)).get();
  if (row?.state) Y.applyUpdate(y, new Uint8Array(row.state));
  change(y);
  const { state, json, text } = encodeContent(y);
  db.update(pages)
    .set({ contentState: state, contentJson: json, contentText: text })
    .where(eq(pages.id, pageId))
    .run();
  syncReminders(db, pageId, json);
}

/** Replaces a page's content. */
export async function writeContent(collab: Collab, db: Db, pageId: string, doc: ProseMirrorNode) {
  await editContent(collab, db, pageId, (d) => setProsemirrorJSON(d, doc));
}

/** Adds blocks at the end of a page. */
export async function appendContent(collab: Collab, db: Db, pageId: string, nodes: ProseMirrorNode[]) {
  await editContent(collab, db, pageId, (d) => d.transact(() => fillY(d.getXmlFragment(CONTENT_FIELD), nodes)));
}

/** A page's content as it is now, with what people are typing included. */
export function readContent(collab: Collab, db: Db, pageId: string): ProseMirrorNode {
  const live = collab.documents.get(pageId);
  if (live) return yDocToProsemirrorJSON(live);
  const row = db.select({ json: pages.contentJson }).from(pages).where(eq(pages.id, pageId)).get();
  return (row?.json as ProseMirrorNode | null) ?? { type: "doc", content: [] };
}
