import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { DatabaseData } from "@nootion/shared";
import { eq } from "drizzle-orm";
import { databaseViews } from "../src/db/schema.js";
import { writeContent, type ProseMirrorNode } from "../src/collab.js";
import { purgeOrphanViews, ORPHAN_VIEW_DAYS } from "../src/databases.js";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let boris: Client;
let ws: string;

beforeEach(async () => {
  app = await makeApp();
  boris = await setupAdmin(app);
  ws = await boris.personalWorkspace();
});

const doc = (...content: ProseMirrorNode[]): ProseMirrorNode => ({ type: "doc", content });
const linkedBlock = (pageId: string, linkId: string): ProseMirrorNode => ({ type: "databaseBlock", attrs: { pageId, linked: true, linkId } });

/** A "Tâches" database with a "Projet" text column and three rows. */
async function tasksDb() {
  const d = (await boris.post("/api/databases", { workspaceId: ws, parentId: null, title: "Tâches" })).json().database as DatabaseData;
  const project = (await boris.post(`/api/databases/${d.id}/properties`, { name: "Projet", type: "text", config: {} })).json().property;
  const title = d.properties[0]!.id;
  for (const [name, p] of [
    ["Devis", "Cuisine"],
    ["Carrelage", "Salle de bain"],
    ["Peinture", "Cuisine"],
  ])
    await boris.post(`/api/databases/${d.id}/rows`, { values: { [title]: name, [project.id]: p } });
  return { id: d.id, firstView: d.views[0]!, project: project.id as string };
}

const linked = async (c: Client, dbId: string, pageId: string, blockId: string) => {
  const res = await c.get(`/api/databases/${dbId}?page=${pageId}&block=${blockId}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().database as DatabaseData;
};
const original = async (c: Client, dbId: string) => (await c.get(`/api/databases/${dbId}`)).json().database as DatabaseData;

describe("linked views", () => {
  it("shows a database in another page with views of its own", async () => {
    const tasks = await tasksDb();
    const kitchen = await boris.createPage(ws, "Cuisine");
    await writeContent(app.collab, app.db, kitchen, doc(linkedBlock(tasks.id, "lv1")));

    // First seen: one view, a copy of the database's first one.
    let data = await linked(boris, tasks.id, kitchen, "lv1");
    expect(data.linked).toEqual({ pageId: kitchen, blockId: "lv1", canEditViews: true });
    expect(data.views).toHaveLength(1);
    expect(data.views[0]).toMatchObject({ name: tasks.firstView.name, type: "table" });
    expect(data.views[0]!.id).not.toBe(tasks.firstView.id);
    expect(data.rows).toHaveLength(3);

    // Filtered on the project, here only.
    const own = data.views[0]!;
    const filters = [{ propertyId: tasks.project, operator: "is", value: "Cuisine" }];
    expect((await boris.patch(`/api/databases/${tasks.id}/views/${own.id}`, { config: { filters } })).statusCode).toBe(200);
    const board = await boris.post(`/api/databases/${tasks.id}/views`, { name: "Tableau", type: "board", owner: { pageId: kitchen, blockId: "lv1" } });
    expect(board.statusCode, board.body).toBe(200);

    data = await linked(boris, tasks.id, kitchen, "lv1");
    expect(data.views.map((v) => v.name)).toEqual([own.name, "Tableau"]);
    expect(data.views[0]!.config.filters).toEqual(filters);
    // The database's own views haven't changed.
    const base = await original(boris, tasks.id);
    expect(base.views.map((v) => v.id)).toEqual([tasks.firstView.id]);
    expect(base.views[0]!.config.filters).toBeUndefined();
    expect(base.linked).toBeUndefined();

    // Another block (or page) has its own.
    const other = await linked(boris, tasks.id, kitchen, "lv2");
    expect(other.views.map((v) => v.id)).not.toContain(own.id);

    // The API and exports find the view by its id.
    const q = await boris.post(`/api/databases/${tasks.id}/query`, { viewId: own.id });
    expect(
      q
        .json()
        .rows.map((r: { title: string }) => r.title)
        .sort(),
    ).toEqual(["Devis", "Peinture"]);
    const csv = await boris.get(`/api/databases/${tasks.id}/export?viewId=${own.id}`);
    expect(csv.body).toContain("Devis");
    expect(csv.body).not.toContain("Carrelage");

    // The last view of a linked view stays, like a database's.
    await boris.delete(`/api/databases/${tasks.id}/views/${board.json().view.id}`);
    expect((await boris.delete(`/api/databases/${tasks.id}/views/${own.id}`)).statusCode).toBe(400);
  });

  it("lets the page's editors change its views, not the database's", async () => {
    const tasks = await tasksDb();
    const alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
    const aliceId = await alice.id();
    const kitchen = await boris.createPage(ws, "Cuisine");
    await writeContent(app.collab, app.db, kitchen, doc(linkedBlock(tasks.id, "lv1")));
    await boris.put(`/api/pages/${kitchen}/shares`, { userId: aliceId, role: "editor" });

    // Without access to the database, nothing is shown.
    expect((await alice.get(`/api/databases/${tasks.id}?page=${kitchen}&block=lv1`)).statusCode).toBe(404);

    // Reader of the database, editor of the page: the linked view's views are hers to change.
    await boris.put(`/api/pages/${tasks.id}/shares`, { userId: aliceId, role: "viewer" });
    const data = await linked(alice, tasks.id, kitchen, "lv1");
    expect(data.role).toBe("viewer");
    expect(data.linked?.canEditViews).toBe(true);
    expect((await alice.patch(`/api/databases/${tasks.id}/views/${data.views[0]!.id}`, { name: "Mes tâches" })).statusCode).toBe(200);
    expect((await alice.post(`/api/databases/${tasks.id}/views`, { name: "Liste", type: "list", owner: { pageId: kitchen, blockId: "lv1" } })).statusCode).toBe(
      200,
    );
    // Not the database's own, nor its rows.
    expect((await alice.patch(`/api/databases/${tasks.id}/views/${tasks.firstView.id}`, { name: "Non" })).statusCode).toBe(404);
    expect((await alice.post(`/api/databases/${tasks.id}/views`, { name: "Non", type: "list" })).statusCode).toBe(404);
    expect((await alice.post(`/api/databases/${tasks.id}/rows`, { values: {} })).statusCode).toBe(404);

    // Reader of the page: she sees it, and can't change it.
    await boris.put(`/api/pages/${kitchen}/shares`, { userId: aliceId, role: "viewer" });
    expect((await linked(alice, tasks.id, kitchen, "lv1")).linked?.canEditViews).toBe(false);
    expect((await alice.patch(`/api/databases/${tasks.id}/views/${data.views[0]!.id}`, { name: "Non" })).statusCode).toBe(404);
  });

  it("keeps a removed block's views for a while, then purges them; deleting the page deletes them", async () => {
    const tasks = await tasksDb();
    const kitchen = await boris.createPage(ws, "Cuisine");
    await writeContent(app.collab, app.db, kitchen, doc(linkedBlock(tasks.id, "lv1")));
    const own = (await linked(boris, tasks.id, kitchen, "lv1")).views[0]!;
    const orphanedAt = () => app.db.select({ o: databaseViews.orphanedAt }).from(databaseViews).where(eq(databaseViews.id, own.id)).get()?.o;

    // Block removed: marked, not deleted (undo brings it back with its views).
    await writeContent(app.collab, app.db, kitchen, doc({ type: "paragraph" }));
    expect(orphanedAt()).toEqual(expect.any(Number));
    await writeContent(app.collab, app.db, kitchen, doc(linkedBlock(tasks.id, "lv1")));
    expect(orphanedAt()).toBeNull();
    expect(purgeOrphanViews(app.db)).toBe(0);

    await writeContent(app.collab, app.db, kitchen, doc({ type: "paragraph" }));
    expect(purgeOrphanViews(app.db, Date.now() + (ORPHAN_VIEW_DAYS - 1) * 86_400_000)).toBe(0);
    expect(purgeOrphanViews(app.db, Date.now() + (ORPHAN_VIEW_DAYS + 1) * 86_400_000)).toBe(1);
    expect(orphanedAt()).toBeUndefined();

    // The page deleted for good takes its linked views along.
    const office = await boris.createPage(ws, "Bureau");
    await writeContent(app.collab, app.db, office, doc(linkedBlock(tasks.id, "lv9")));
    const view = (await linked(boris, tasks.id, office, "lv9")).views[0]!;
    await boris.delete(`/api/pages/${office}`);
    expect((await boris.delete(`/api/pages/${office}/permanent`)).statusCode).toBe(200);
    expect(app.db.select().from(databaseViews).where(eq(databaseViews.id, view.id)).get()).toBeUndefined();
    // The database is untouched.
    expect((await original(boris, tasks.id)).rows).toHaveLength(3);
  });

  it("copies a linked view's filters with its page", async () => {
    const tasks = await tasksDb();
    const project = await boris.createPage(ws, "Projet");
    await writeContent(app.collab, app.db, project, doc(linkedBlock(tasks.id, "lv1")));
    const own = (await linked(boris, tasks.id, project, "lv1")).views[0]!;
    const filters = [{ propertyId: tasks.project, operator: "is", value: "Cuisine" }];
    await boris.patch(`/api/databases/${tasks.id}/views/${own.id}`, { config: { filters } });

    const copy = (await boris.post(`/api/pages/${project}/duplicate`)).json().page.id as string;
    const copied = await linked(boris, tasks.id, copy, "lv1");
    expect(copied.views).toHaveLength(1);
    expect(copied.views[0]!.id).not.toBe(own.id);
    expect(copied.views[0]!.config.filters).toEqual(filters);
    // Still one database, with the same rows.
    expect(copied.rows).toHaveLength(3);
    expect((await original(boris, tasks.id)).views).toHaveLength(1);
  });

  it("follows the page's lock, not the database's", async () => {
    const tasks = await tasksDb();
    const kitchen = await boris.createPage(ws, "Cuisine");
    await writeContent(app.collab, app.db, kitchen, doc(linkedBlock(tasks.id, "lv1")));
    const own = (await linked(boris, tasks.id, kitchen, "lv1")).views[0]!;

    // The database locked: its own views are frozen, the linked view's are not.
    await boris.patch(`/api/pages/${tasks.id}`, { locked: true });
    expect((await boris.patch(`/api/databases/${tasks.id}/views/${tasks.firstView.id}`, { name: "Non" })).statusCode).toBe(423);
    expect((await boris.patch(`/api/databases/${tasks.id}/views/${own.id}`, { name: "Cuisine" })).statusCode).toBe(200);
    await boris.patch(`/api/pages/${tasks.id}`, { locked: false });

    // The page locked: the linked view's views are frozen with it.
    await boris.patch(`/api/pages/${kitchen}`, { locked: true });
    expect((await linked(boris, tasks.id, kitchen, "lv1")).linked?.canEditViews).toBe(false);
    expect((await boris.patch(`/api/databases/${tasks.id}/views/${own.id}`, { name: "Non" })).statusCode).toBe(423);
  });
});
