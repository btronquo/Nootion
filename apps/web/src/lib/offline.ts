import { useSyncExternalStore } from "react";
import type { CellValue, DatabaseData, DatabaseRow, PageDetail } from "@nootion/shared";
import { api, ApiError, isOfflineError, isOnline } from "./api";

/**
 * Changes made while the server can't be reached: database cells and page settings (title, icon, width).
 * They are kept in this browser, shown at once, and sent in order when the connection comes back.
 * Each one overwrites the value on the server: the last change of a cell wins.
 * Page content doesn't go through here: it is a Yjs document, kept on the device and merged by the editor.
 */
export interface QueuedChange {
  path: string;
  method: "PATCH";
  body: Record<string, unknown>;
}

const QUEUE_KEY = "nootion-offline-queue";
const USER_KEY = "nootion-offline-user";

function load(): QueuedChange[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as QueuedChange[];
  } catch {
    return [];
  }
}

let queue = load();
let failures: string[] = [];
let state = { pending: queue.length, failures };
const listeners = new Set<() => void>();

function changed() {
  try {
    if (queue.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    else localStorage.removeItem(QUEUE_KEY);
  } catch {
    // Storage full or blocked: the queue still lives until the page is closed.
  }
  state = { pending: queue.length, failures };
  listeners.forEach((l) => l());
}

/** Number of changes waiting for the server, and the errors of those it refused. */
export function useOfflineQueue() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export function dismissFailures() {
  failures = [];
  changed();
}

function enqueue(change: QueuedChange) {
  // Several edits of the same row or page in a row make one request.
  const last = queue[queue.length - 1];
  if (last && last.path === change.path) {
    const values = last.body.values && change.body.values ? { values: { ...(last.body.values as object), ...(change.body.values as object) } } : {};
    queue[queue.length - 1] = { ...last, body: { ...last.body, ...change.body, ...values } };
  } else queue.push(change);
  changed();
}

/**
 * Sends a change, or keeps it for later when the server can't be reached.
 * Returns the server's answer, or null when the change was queued.
 */
export async function sendOrQueue<T>(path: string, body: Record<string, unknown>): Promise<T | null> {
  // Earlier changes go first, so the order is kept.
  if (!isOnline() || queue.length) {
    enqueue({ path, method: "PATCH", body });
    void flush();
    return null;
  }
  try {
    return await api<T>(path, { method: "PATCH", body });
  } catch (e) {
    if (!isOfflineError(e)) throw e;
    enqueue({ path, method: "PATCH", body });
    return null;
  }
}

let flushing: Promise<void> | null = null;
let onFlushed: () => void = () => {};

/** Called once queued changes have reached the server, to reload what they changed. */
export function setFlushedHandler(fn: () => void) {
  onFlushed = fn;
}

/** Sends the queued changes in order. Stops at the first one that can't reach the server. */
export function flush(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    while (queue.length) {
      const change = queue[0];
      try {
        await api(change.path, { method: change.method, body: change.body });
      } catch (e) {
        if (isOfflineError(e)) break;
        // Refused (deleted row, access taken away…): dropped, and the user is told.
        failures = [...failures, e instanceof ApiError ? e.message : String(e)];
      }
      queue = queue.slice(1);
      sent++;
      changed();
    }
    if (sent) onFlushed();
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/** Tries again when the device comes back online, and every few seconds while changes are waiting. */
export function startOfflineSync() {
  window.addEventListener("online", () => void flush());
  window.setInterval(() => {
    if (queue.length) void flush();
    // Tells whether the server is back, even when nothing on screen asks it.
    else if (!isOnline() && navigator.onLine) void api("/health").catch(() => {});
  }, 10_000);
  void flush();
}

const ROW_PATH = /^\/databases\/([^/]+)\/rows\/([^/]+)$/;
const PAGE_PATH = /^\/pages\/([^/]+)$/;

/** Queued values of a row, by property. */
function queuedValues(databaseId: string, rowId: string): Record<string, CellValue> | null {
  let out: Record<string, CellValue> | null = null;
  for (const c of queue) {
    const m = ROW_PATH.exec(c.path);
    if (m && m[1] === databaseId && m[2] === rowId) out = { ...(out ?? {}), ...(c.body.values as Record<string, CellValue>) };
  }
  return out;
}

/** A row with the changes still waiting for the server. */
export function withQueuedRow(databaseId: string, row: DatabaseRow, titleProp?: string): DatabaseRow {
  const values = queuedValues(databaseId, row.id);
  if (!values) return row;
  const title = titleProp && titleProp in values ? String(values[titleProp] ?? "") : row.title;
  return { ...row, title, values: { ...row.values, ...values } };
}

/** A database with the cell changes still waiting for the server. */
export function withQueuedChanges(data: DatabaseData): DatabaseData {
  if (!queue.length) return data;
  const titleProp = data.properties.find((p) => p.type === "title")?.id;
  return { ...data, rows: data.rows.map((r) => withQueuedRow(data.id, r, titleProp)) };
}

/** Page lists (sidebar) with the titles and icons changed offline. */
export function withQueuedPages<T extends { id: string; title: string; icon: string | null }>(pages: T[]): T[] {
  if (!queue.some((c) => PAGE_PATH.test(c.path))) return pages;
  return pages.map((p) => {
    let out = p;
    for (const c of queue) {
      const m = PAGE_PATH.exec(c.path);
      if (m && m[1] === p.id) out = { ...out, ...("title" in c.body ? { title: c.body.title } : {}), ...("icon" in c.body ? { icon: c.body.icon } : {}) };
    }
    return out;
  });
}

/** A page with the settings changes still waiting for the server. */
export function withQueuedPage(page: PageDetail): PageDetail {
  let out = page;
  for (const c of queue) {
    const m = PAGE_PATH.exec(c.path);
    if (m && m[1] === page.id) out = { ...out, ...(c.body as Partial<PageDetail>) };
  }
  return out;
}

/**
 * Removes everything kept on this device for offline use: queued changes, saved answers of the server
 * and page contents. Done at sign-out and when another account signs in on this browser.
 */
export async function clearOfflineData() {
  queue = [];
  failures = [];
  changed();
  try {
    localStorage.removeItem(USER_KEY);
  } catch {
    // Nothing saved.
  }
  await Promise.all([
    "caches" in window ? caches.delete("nootion-api") : null,
    indexedDB.databases?.().then((dbs) => Promise.all(dbs.filter((d) => d.name?.startsWith(PAGE_DB_PREFIX)).map((d) => deleteDb(d.name!)))),
  ]).catch(() => {});
}

export const PAGE_DB_PREFIX = "nootion-page-";

const deleteDb = (name: string) =>
  new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });

/** Clears the data of another account before this one uses the offline copy. */
export async function claimOfflineData(userId: string) {
  let owner: string | null = null;
  try {
    owner = localStorage.getItem(USER_KEY);
  } catch {
    // Unknown owner: cleared below.
  }
  if (owner === userId) return;
  await clearOfflineData();
  try {
    localStorage.setItem(USER_KEY, userId);
  } catch {
    // Checked again next time.
  }
}
