import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { taskDateGroup, type TaskEntry, type TasksResponse } from "@nootion/shared";
import { pages, pageTasks } from "../src/db/schema.js";
import { readContent, writeContent, type ProseMirrorNode } from "../src/collab.js";
import { findTasks } from "../src/tasks.js";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let boris: Client;
let borisId: string;
let ws: string;

beforeEach(async () => {
  app = await makeApp();
  boris = await setupAdmin(app);
  borisId = await boris.id();
  ws = await boris.personalWorkspace();
});

afterEach(async () => {
  await app.close();
});

const text = (s: string): ProseMirrorNode => ({ type: "text", text: s });
const todo = (checked: boolean, inline: ProseMirrorNode[], attrs: Record<string, unknown> = {}, nested?: ProseMirrorNode): ProseMirrorNode => ({
  type: "taskItem",
  attrs: { checked, ...attrs },
  content: [{ type: "paragraph", content: inline }, ...(nested ? [nested] : [])],
});
const list = (...items: ProseMirrorNode[]): ProseMirrorNode => ({ type: "taskList", content: items });
const doc = (...blocks: ProseMirrorNode[]): ProseMirrorNode => ({ type: "doc", content: blocks });
const date = (d: string): ProseMirrorNode => ({ type: "dateMention", attrs: { id: `d-${d}`, date: d } });
const person = (userId: string, name: string): ProseMirrorNode => ({ type: "userMention", attrs: { id: `m-${userId}`, userId, name } });

const tasksOf = async (c: Client, query = ""): Promise<TasksResponse> => {
  const res = await c.get(`/api/tasks${query}`);
  expect(res.statusCode).toBe(200);
  return res.json();
};
const check = (c: Client, task: TaskEntry, checked = true) =>
  c.post("/api/tasks/check", { pageId: task.pageId, key: task.key, text: task.text, checked, today: "2026-11-15" });

describe("finding to-dos", () => {
  it("reads each to-do's own line, date, mentions and repeat, nested ones after their parent", () => {
    const found = findTasks(
      doc(
        { type: "paragraph", content: [text("Pas une tâche")] },
        list(
          todo(
            false,
            [text("Appeler "), person("u1", "Alice"), text(" "), date("2026-11-20T09:00")],
            { repeat: "1w", blockId: "b1" },
            list(todo(true, [text("Sous-tâche")])),
          ),
          todo(false, [text("Écrire le devis")]),
        ),
      ),
    );
    expect(found).toEqual([
      { position: 0, blockId: "b1", text: "Appeler @Alice", checked: false, date: "2026-11-20T09:00", mentions: ["u1"], repeat: "1w" },
      { position: 1, blockId: null, text: "Sous-tâche", checked: true, date: null, mentions: [], repeat: null },
      { position: 2, blockId: null, text: "Écrire le devis", checked: false, date: null, mentions: [], repeat: null },
    ]);
  });

  it("groups by date", () => {
    expect(taskDateGroup(null, "2026-11-15")).toBe("none");
    expect(taskDateGroup("2026-11-14", "2026-11-15")).toBe("overdue");
    expect(taskDateGroup("2026-11-15T18:00", "2026-11-15")).toBe("today");
    expect(taskDateGroup("2026-11-22", "2026-11-15")).toBe("week");
    expect(taskDateGroup("2026-11-23", "2026-11-15")).toBe("later");
  });
});

describe("tasks", () => {
  it("lists the open to-dos of every page, and checks one from the list", async () => {
    const a = await boris.createPage(ws, "Maison");
    const b = await boris.createPage(ws, "Travail");
    await writeContent(app.collab, app.db, a, doc(list(todo(false, [text("Réparer le robinet")]), todo(true, [text("Payer la facture")]))));
    await writeContent(app.collab, app.db, b, doc(list(todo(false, [text("Préparer la réunion "), date("2026-11-20")]))));

    let res = await tasksOf(boris);
    expect(res.tasks.map((t) => t.text).sort()).toEqual(["Préparer la réunion", "Réparer le robinet"]);
    // A to-do already checked before the list existed isn't "done lately".
    expect(res.done).toEqual([]);
    const robinet = res.tasks.find((t) => t.text === "Réparer le robinet")!;
    expect(robinet).toMatchObject({ pageId: a, pageTitle: "Maison", key: "i:0", canEdit: true, checked: false, date: null });
    expect(res.tasks.find((t) => t.pageId === b)!.date).toBe("2026-11-20");

    expect((await check(boris, robinet)).statusCode).toBe(200);
    // Checked in the page itself.
    const content = readContent(app.collab, app.db, a);
    expect(findTasks(content)[0]!.checked).toBe(true);
    res = await tasksOf(boris);
    expect(res.tasks.map((t) => t.text)).toEqual(["Préparer la réunion"]);
    expect(res.done.map((t) => t.text)).toEqual(["Réparer le robinet"]);

    // Unchecked from "Done lately".
    expect((await check(boris, res.done[0]!, false)).statusCode).toBe(200);
    res = await tasksOf(boris);
    expect(res.tasks.map((t) => t.text).sort()).toEqual(["Préparer la réunion", "Réparer le robinet"]);
    expect(res.done).toEqual([]);
  });

  it("notes when a to-do is checked in its page", async () => {
    const page = await boris.createPage(ws, "Courses");
    await writeContent(app.collab, app.db, page, doc(list(todo(false, [text("Pain")]), todo(false, [text("Lait")]))));
    expect((await tasksOf(boris)).tasks).toHaveLength(2);
    await writeContent(app.collab, app.db, page, doc(list(todo(true, [text("Pain")]), todo(false, [text("Lait")]))));
    const res = await tasksOf(boris);
    expect(res.tasks.map((t) => t.text)).toEqual(["Lait"]);
    expect(res.done.map((t) => t.text)).toEqual(["Pain"]);
    expect(res.done[0]!.checkedAt).toBeTruthy();
  });

  it("refuses to check a to-do that changed in its page meanwhile", async () => {
    const page = await boris.createPage(ws, "Liste");
    await writeContent(app.collab, app.db, page, doc(list(todo(false, [text("Un")]), todo(false, [text("Deux")]))));
    const [one] = (await tasksOf(boris)).tasks;
    // Someone adds a to-do before it: its rank now points at another one.
    await writeContent(app.collab, app.db, page, doc(list(todo(false, [text("Zéro")]), todo(false, [text("Un")]), todo(false, [text("Deux")]))));
    const res = await check(boris, one!);
    expect(res.statusCode).toBe(409);
    expect(findTasks(readContent(app.collab, app.db, page)).every((t) => !t.checked)).toBe(true);
  });

  it("finds a to-do by its block id even when it moved", async () => {
    const page = await boris.createPage(ws, "Liste");
    await writeContent(app.collab, app.db, page, doc(list(todo(false, [text("Un")], { blockId: "abc" }))));
    const [one] = (await tasksOf(boris)).tasks;
    expect(one!.key).toBe("b:abc");
    await writeContent(app.collab, app.db, page, doc(list(todo(false, [text("Avant")]), todo(false, [text("Un")], { blockId: "abc" }))));
    expect((await check(boris, one!)).statusCode).toBe(200);
    expect(findTasks(readContent(app.collab, app.db, page)).map((t) => t.checked)).toEqual([false, true]);
  });

  it("gives a repeating to-do the day it unchecks", async () => {
    const page = await boris.createPage(ws, "Routine");
    await writeContent(app.collab, app.db, page, doc(list(todo(false, [text("Arroser "), date("2026-11-15")], { repeat: "1w" }))));
    const [task] = (await tasksOf(boris)).tasks;
    expect(task!.repeat).toBe("1w");
    await check(boris, task!);
    const item = readContent(app.collab, app.db, page).content![0]!.content![0]!;
    expect(item.attrs).toMatchObject({ checked: true, repeat: "1w", repeatAt: "2026-11-22" });
  });

  it("filters by space, mentions and dates", async () => {
    const team = (await boris.post("/api/workspaces", { name: "Équipe" })).json().workspace.id as string;
    const mine = await boris.createPage(ws, "Perso");
    const shared = await boris.createPage(team, "Projet");
    await writeContent(app.collab, app.db, mine, doc(list(todo(false, [text("Courses")]))));
    await writeContent(
      app.collab,
      app.db,
      shared,
      doc(list(todo(false, [text("Relire "), person(borisId, "Boris")]), todo(false, [text("Livrer "), date("2026-12-01")]))),
    );
    expect((await tasksOf(boris)).tasks).toHaveLength(3);
    expect((await tasksOf(boris, `?workspaceId=${team}`)).tasks.map((t) => t.text).sort()).toEqual(["Livrer", "Relire @Boris"]);
    const me = await tasksOf(boris, "?mine=1");
    expect(me.tasks.map((t) => t.text)).toEqual(["Relire @Boris"]);
    expect(me.tasks[0]!.mentionsMe).toBe(true);
    expect((await tasksOf(boris, "?dated=1")).tasks.map((t) => t.text)).toEqual(["Livrer"]);
  });

  it("only lists the pages one can read, and checks only those one can edit", async () => {
    const alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "motdepasse-alice" });
    const aliceId = await alice.id();
    const priv = await boris.createPage(ws, "Privé");
    const lu = await boris.createPage(ws, "Partagé en lecture");
    await writeContent(app.collab, app.db, priv, doc(list(todo(false, [text("Secret")]))));
    await writeContent(app.collab, app.db, lu, doc(list(todo(false, [text("Visible")]))));
    expect((await tasksOf(alice)).tasks).toEqual([]);

    await boris.put(`/api/pages/${lu}/shares`, { userId: aliceId, role: "viewer" });
    const [visible] = (await tasksOf(alice)).tasks;
    expect(visible).toMatchObject({ text: "Visible", canEdit: false });
    expect((await check(alice, visible!)).statusCode).toBe(404);
    // A page out of reach can't be checked either.
    expect((await alice.post("/api/tasks/check", { pageId: priv, key: "i:0", text: "Secret", checked: true })).statusCode).toBe(404);
  });

  it("leaves out pages in the trash and templates", async () => {
    const page = await boris.createPage(ws, "Jetée");
    const tpl = await boris.createPage(ws, "Modèle");
    await writeContent(app.collab, app.db, page, doc(list(todo(false, [text("A")]))));
    await writeContent(app.collab, app.db, tpl, doc(list(todo(false, [text("B")]))));
    app.db.update(pages).set({ template: true }).where(eq(pages.id, tpl)).run();
    expect((await boris.delete(`/api/pages/${page}`)).statusCode).toBe(200);
    expect((await tasksOf(boris)).tasks).toEqual([]);
  });

  it("reads the to-dos of pages written before the upgrade", async () => {
    const page = await boris.createPage(ws, "Ancienne");
    await writeContent(app.collab, app.db, page, doc(list(todo(false, [text("Vieille tâche")]))));
    // As after the migration: no rows yet, the page marked to read.
    app.db.delete(pageTasks).run();
    app.db.$client.prepare("INSERT OR IGNORE INTO page_tasks_stale (page_id) VALUES (?)").run(page);
    expect((await tasksOf(boris)).tasks.map((t) => t.text)).toEqual(["Vieille tâche"]);
  });
});
