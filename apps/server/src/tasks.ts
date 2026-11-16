import * as Y from "yjs";
import { and, eq, gte, inArray, type SQL } from "drizzle-orm";
import { atLeast, dayString, nextTaskDay, parseTaskRepeat, TASKS_DONE_DAYS, type PageRole, type TaskEntry, type TasksResponse } from "@nootion/shared";
import type { Db } from "./db/index.js";
import { pagePermissions, pages, pageTasks, workspaceMembers } from "./db/schema.js";
import { CONTENT_FIELD, prosemirrorToText, type ProseMirrorNode } from "./collab.js";
import { getChain, isTrashed, roleFromChain } from "./permissions.js";
import { scopeAllows } from "./api-tokens.js";

export interface FoundTask {
  position: number;
  blockId: string | null;
  text: string;
  checked: boolean;
  date: string | null;
  mentions: string[];
  repeat: string | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;
const TEXT_MAX = 500;

const isChecked = (v: unknown) => v === true || v === "true";

/** The to-dos of a page's content, in their order (a to-do nested in another comes after it). */
export function findTasks(content: ProseMirrorNode | null | undefined): FoundTask[] {
  const out: FoundTask[] = [];
  const walk = (node: ProseMirrorNode) => {
    if (node.type === "taskItem") {
      // Its own line: the first block in it (the to-dos nested under it are theirs).
      const line = node.content?.[0];
      const inline = line && line.type !== "taskList" ? (line.content ?? []) : [];
      let date: string | null = null;
      const mentions: string[] = [];
      for (const c of inline) {
        if (c.type === "dateMention" && !date && typeof c.attrs?.date === "string" && DATE.test(c.attrs.date)) date = c.attrs.date;
        if (c.type === "userMention" && typeof c.attrs?.userId === "string" && c.attrs.userId && !mentions.includes(c.attrs.userId))
          mentions.push(c.attrs.userId);
      }
      const text = line
        ? prosemirrorToText({ ...line, content: inline.filter((c) => c.type !== "dateMention") })
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, TEXT_MAX)
        : "";
      const repeat = parseTaskRepeat(node.attrs?.repeat) ? String(node.attrs!.repeat) : null;
      out.push({
        position: out.length,
        blockId: typeof node.attrs?.blockId === "string" && node.attrs.blockId ? node.attrs.blockId : null,
        text,
        checked: isChecked(node.attrs?.checked),
        date,
        mentions,
        repeat,
      });
    }
    for (const c of node.content ?? []) walk(c);
  };
  if (content) walk(content);
  return out;
}

/** The key the list gives a to-do: its block id when no other to-do of the page has the same, else its rank. */
export function taskKey(task: FoundTask, all: FoundTask[]): string {
  if (task.blockId && all.filter((t) => t.blockId === task.blockId).length === 1) return `b:${task.blockId}`;
  return `i:${task.position}`;
}

export function findTaskByKey(all: FoundTask[], key: string): FoundTask | undefined {
  if (key.startsWith("b:")) {
    const matches = all.filter((t) => t.blockId === key.slice(2));
    return matches.length === 1 ? matches[0] : undefined;
  }
  if (key.startsWith("i:")) return all[Number(key.slice(2))];
  return undefined;
}

type TaskRow = typeof pageTasks.$inferSelect;

/**
 * Writes the to-dos of a page again from its content. The moment a to-do was checked is carried over from the
 * previous rows (the same block id, else the same text); a to-do seen checked for the first time gets "now",
 * except on the first reading of a page (the existing to-dos weren't checked just now).
 */
export function rebuildPageTasks(db: Db, pageId: string, content: ProseMirrorNode | null, now = new Date()) {
  const found = findTasks(content);
  const old = db.select().from(pageTasks).where(eq(pageTasks.pageId, pageId)).all();
  const firstTime = old.length === 0;
  const byBlock = new Map<string, TaskRow>();
  const byText = new Map<string, TaskRow[]>();
  for (const r of old) {
    if (r.blockId) byBlock.set(r.blockId, r);
    byText.set(r.text, [...(byText.get(r.text) ?? []), r]);
  }
  const used = new Set<TaskRow>();
  const rows = found.map((f) => {
    let prev = f.blockId ? byBlock.get(f.blockId) : undefined;
    if (prev && used.has(prev)) prev = undefined;
    if (!prev) prev = byText.get(f.text)?.find((r) => !used.has(r));
    if (prev) used.add(prev);
    const checkedAt = !f.checked ? null : prev ? (prev.checked ? prev.checkedAt : now) : firstTime ? null : now;
    return { pageId, ...f, checkedAt };
  });
  db.transaction((tx) => {
    tx.delete(pageTasks).where(eq(pageTasks.pageId, pageId)).run();
    // A few hundred at a time: SQLite limits the values of one statement.
    for (let i = 0; i < rows.length; i += 200)
      tx.insert(pageTasks)
        .values(rows.slice(i, i + 200))
        .run();
  });
}

/**
 * Reads again the to-dos of the pages the triggers marked, at most `max` of them. Templates have none (the pages made
 * from them do). Returns how many pages were done.
 */
export function refreshPageTasks(db: Db, max = 500): number {
  const client = db.$client;
  const stale = client
    .prepare(
      `SELECT s.page_id AS id, p.content_json AS json, p.template AS template
         FROM page_tasks_stale s LEFT JOIN pages p ON p.id = s.page_id
        LIMIT ?`,
    )
    .all(max) as { id: string; json: string | null; template: number | null }[];
  if (!stale.length) return 0;
  const done = client.prepare(`DELETE FROM page_tasks_stale WHERE page_id = ?`);
  for (const r of stale) {
    let content: ProseMirrorNode | null = null;
    if (r.json && !r.template && r.json.includes('"taskItem"')) {
      try {
        content = JSON.parse(r.json) as ProseMirrorNode;
      } catch {
        content = null;
      }
    }
    if (r.template !== null) rebuildPageTasks(db, r.id, content);
    done.run(r.id);
  }
  return stale.length;
}

/** Keeps the to-dos up to date in the background, a batch at a time (all existing pages after the upgrade). */
export function createTaskIndexer(db: Db, log?: { error: (obj: unknown, msg?: string) => void }) {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  const run = () => {
    timer = null;
    if (stopped) return;
    let more = false;
    try {
      more = refreshPageTasks(db, 200) === 200;
    } catch (err) {
      log?.error({ err }, "tasks index");
    }
    timer = setTimeout(run, more ? 0 : 5000);
    timer.unref();
  };
  return {
    wake() {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, 0);
      timer.unref();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/** The pages a user may be able to read: those of their spaces, and those shared with them with their subpages. */
function sharedPageIds(db: Db, userId: string): string[] {
  const grants = db.select({ pageId: pagePermissions.pageId }).from(pagePermissions).where(eq(pagePermissions.userId, userId)).all();
  const ids = new Set<string>();
  for (const { pageId } of grants) {
    ids.add(pageId);
    const sub = db.$client
      .prepare(
        `WITH RECURSIVE sub(id, depth) AS (
           SELECT id, 0 FROM pages WHERE parent_id = ?
           UNION ALL
           SELECT p.id, sub.depth + 1 FROM pages p JOIN sub ON p.parent_id = sub.id WHERE sub.depth < 1000
         ) SELECT id FROM sub`,
      )
      .all(pageId) as { id: string }[];
    for (const s of sub) ids.add(s.id);
  }
  return [...ids];
}

const MAX_TASKS = 2000;
const MAX_DONE = 100;

/**
 * Every to-do of the pages the user can read, outside the trash and templates: those still to do, and those checked
 * in the last days. Filters: a space, only those mentioning the user, only those with a date.
 */
export function listTasks(db: Db, userId: string, filters: { workspaceId?: string; mine?: boolean; dated?: boolean } = {}, now = new Date()): TasksResponse {
  // Pages changed since the last reading first: the list is always up to date.
  while (refreshPageTasks(db, 500) === 500);

  const spaces = db
    .select({ id: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId))
    .all()
    .map((w) => w.id)
    .filter((id) => !filters.workspaceId || id === filters.workspaceId);
  const sharedIds = sharedPageIds(db, userId);

  const since = new Date(now.getTime() - TASKS_DONE_DAYS * 86_400_000);
  const select = {
    task: pageTasks,
    title: pages.title,
    icon: pages.icon,
    workspaceId: pages.workspaceId,
    updatedAt: pages.updatedAt,
    locked: pages.locked,
  };
  const inReach = (ids: string[], column: typeof pages.workspaceId | typeof pages.id) => (ids.length ? inArray(column, ids) : undefined);
  const read = (cond: SQL | undefined) => {
    const out: { task: TaskRow; title: string; icon: string | null; workspaceId: string; updatedAt: Date; locked: boolean }[] = [];
    for (const reach of [inReach(spaces, pages.workspaceId), inReach(sharedIds, pages.id)]) {
      if (!reach) continue;
      out.push(
        ...db
          .select(select)
          .from(pageTasks)
          .innerJoin(pages, eq(pages.id, pageTasks.pageId))
          .where(and(reach, eq(pages.template, false), cond))
          .all(),
      );
    }
    return out;
  };
  const open = read(eq(pageTasks.checked, false));
  const done = read(and(eq(pageTasks.checked, true), gte(pageTasks.checkedAt, since)));

  // Who may read and edit each page, worked out once per page.
  const roles = new Map<string, PageRole | null>();
  const roleOf = (pageId: string) => {
    if (!roles.has(pageId)) {
      const chain = getChain(db, pageId);
      roles.set(pageId, chain.length && !isTrashed(chain) && scopeAllows(chain[0]!.workspaceId) ? roleFromChain(db, userId, chain) : null);
    }
    return roles.get(pageId) ?? null;
  };

  const seen = new Set<string>();
  const toEntries = (rows: typeof open) => {
    const keysOf = new Map<string, Map<number, string>>();
    const keys = (pageId: string) => {
      let m = keysOf.get(pageId);
      if (!m) {
        // Block ids shared by several to-dos of the page (copied and pasted) don't find one: those use their rank.
        const all = db.select().from(pageTasks).where(eq(pageTasks.pageId, pageId)).all();
        const found = all.map((r) => ({ ...r, mentions: r.mentions ?? [] }));
        m = new Map(found.map((f) => [f.position, taskKey(f, found)]));
        keysOf.set(pageId, m);
      }
      return m;
    };
    const out: (TaskEntry & { updatedAt: number; position: number })[] = [];
    for (const r of rows) {
      const id = `${r.task.pageId}:${r.task.position}`;
      if (seen.has(id)) continue;
      seen.add(id);
      if (filters.workspaceId && r.workspaceId !== filters.workspaceId) continue;
      const mentionsMe = (r.task.mentions ?? []).includes(userId);
      if (filters.mine && !mentionsMe) continue;
      if (filters.dated && !r.task.date) continue;
      const role = roleOf(r.task.pageId);
      if (!atLeast(role, "viewer")) continue;
      out.push({
        pageId: r.task.pageId,
        pageTitle: r.title,
        pageIcon: r.icon,
        workspaceId: r.workspaceId,
        key: keys(r.task.pageId).get(r.task.position) ?? `i:${r.task.position}`,
        text: r.task.text,
        checked: r.task.checked,
        date: r.task.date,
        mentionsMe,
        repeat: r.task.repeat,
        checkedAt: r.task.checkedAt?.toISOString() ?? null,
        // A locked page's to-dos are shown, but are checked only once it is unlocked.
        canEdit: atLeast(role, "editor") && !r.locked,
        updatedAt: r.updatedAt.getTime(),
        position: r.task.position,
      });
    }
    return out;
  };

  const tasks = toEntries(open).sort((a, b) => b.updatedAt - a.updatedAt || a.pageId.localeCompare(b.pageId) || a.position - b.position);
  const recent = toEntries(done).sort((a, b) => (b.checkedAt ?? "").localeCompare(a.checkedAt ?? ""));
  const strip = ({ updatedAt: _u, position: _p, ...e }: TaskEntry & { updatedAt: number; position: number }): TaskEntry => e;
  return { tasks: tasks.slice(0, MAX_TASKS).map(strip), done: recent.slice(0, MAX_DONE).map(strip), truncated: tasks.length > MAX_TASKS };
}

/** The to-do elements of a page's Yjs document, in the order findTasks gives them. */
function yTaskItems(doc: Y.Doc): Y.XmlElement[] {
  const out: Y.XmlElement[] = [];
  const walk = (el: Y.XmlFragment | Y.XmlElement) => {
    for (const child of el.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue;
      if (child.nodeName === "taskItem") out.push(child);
      walk(child);
    }
  };
  walk(doc.getXmlFragment(CONTENT_FIELD));
  return out;
}

/**
 * Checks or unchecks a to-do in its page's document. A repeating to-do checked gets the day it unchecks, as in the
 * editor (after today, or after its date when that is later). Returns false when the to-do isn't there any more.
 */
export function setTaskChecked(doc: Y.Doc, task: FoundTask, checked: boolean, today = dayString(new Date())): boolean {
  const el = yTaskItems(doc)[task.position];
  if (!el) return false;
  doc.transact(() => {
    el.setAttribute("checked", checked as unknown as string);
    const rule = parseTaskRepeat(el.getAttribute("repeat"));
    if (checked && rule) {
      const day = task.date?.slice(0, 10);
      el.setAttribute("repeatAt", nextTaskDay(rule, day && day > today ? day : today));
    } else if (el.getAttribute("repeatAt") !== undefined) {
      el.removeAttribute("repeatAt");
    }
  });
  return true;
}

/** Notes at once in the list that a to-do was checked from it (the page's content is saved a moment later). */
export function noteTaskChecked(db: Db, pageId: string, position: number, checked: boolean, now = new Date()) {
  db.update(pageTasks)
    .set({ checked, checkedAt: checked ? now : null })
    .where(and(eq(pageTasks.pageId, pageId), eq(pageTasks.position, position)))
    .run();
}
