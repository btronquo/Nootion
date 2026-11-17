import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { workspaceMembers, workspaces } from "../src/db/schema.js";
import { applyChanges, changesSince, type SyncChange } from "../src/sync.js";
import { Client, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let boris: Client;
let ws: string;

beforeEach(async () => {
  app = await makeApp();
  boris = await setupAdmin(app);
  ws = await boris.personalWorkspace();
});

afterEach(async () => {
  await app.close();
});

const newDatabase = async (workspaceId = ws, title = "Factures") =>
  (await boris.post("/api/databases", { workspaceId, parentId: null, title })).json().database as { id: string; properties: { id: string }[] };
const detail = async (id: string, c = boris) => (await c.get(`/api/pages/${id}`)).json().page;

describe("database pages", () => {
  it("keeps a description under the title of a database, and only of a database", async () => {
    const d = await newDatabase();
    expect((await detail(d.id)).description).toBe("");
    expect((await boris.patch(`/api/pages/${d.id}`, { description: "Une ligne par facture.\nPayées en vert." })).statusCode).toBe(200);
    expect((await detail(d.id)).description).toBe("Une ligne par facture.\nPayées en vert.");

    const page = await boris.createPage(ws, "Notes");
    const res = await boris.patch(`/api/pages/${page}`, { description: "x" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("not_a_database");
    expect((await boris.patch(`/api/pages/${d.id}`, { description: "x".repeat(2001) })).statusCode).toBe(400);
  });

  it("keeps the description of a locked database", async () => {
    const d = await newDatabase();
    await boris.patch(`/api/pages/${d.id}`, { locked: true });
    expect((await boris.patch(`/api/pages/${d.id}`, { description: "Changée" })).statusCode).toBe(423);
    expect((await boris.patch(`/api/pages/${d.id}`, { locked: false, description: "Changée" })).statusCode).toBe(200);
    expect((await detail(d.id)).description).toBe("Changée");
  });

  it("says which ancestors are databases, so that the breadcrumb shows them as such", async () => {
    const d = await newDatabase();
    const row = (await boris.post(`/api/databases/${d.id}/rows`, { values: { [d.properties[0].id]: "EDF" } })).json().row.id;
    expect((await detail(row)).breadcrumb).toEqual([expect.objectContaining({ id: d.id, kind: "database", title: "Factures" })]);
  });

  it("shows the description on a public link", async () => {
    const d = await newDatabase();
    await boris.patch(`/api/pages/${d.id}`, { description: "Publique" });
    const token = (await boris.put(`/api/pages/${d.id}/public-link`, {})).json().link.token;
    expect((await app.inject({ method: "GET", url: `/api/public/${token}/pages/${d.id}` })).json().page.description).toBe("Publique");
  });

  it("carries the description and the lock through the desktop sync, both ways", async () => {
    const local = await makeApp();
    const onLocal = await setupAdmin(local);
    const shared = (await boris.post("/api/workspaces", { name: "Famille" })).json().workspace.id;
    const me = await onLocal.id();
    local.db.insert(workspaces).values({ id: shared, name: "Famille", kind: "shared", createdBy: me }).run();
    local.db.insert(workspaceMembers).values({ workspaceId: shared, userId: me, role: "owner" }).run();
    const d = await newDatabase(shared, "Courses");
    await boris.patch(`/api/pages/${d.id}`, { description: "Pour la semaine" });

    const res = await boris.get(`/api/sync/${shared}/changes?since=0&peer=local-peer-0001`);
    await applyChanges(local.db, local.collab, shared, "server", (res.json() as { changes: SyncChange[] }).changes);
    expect((await detail(d.id, onLocal)).description).toBe("Pour la semaine");

    // Changed and locked on the computer: the same on the server after the next push.
    await onLocal.patch(`/api/pages/${d.id}`, { description: "Pour le mois" });
    await onLocal.patch(`/api/pages/${d.id}`, { locked: true });
    const mine = changesSince(local.db, shared, 0, "server", 10_000);
    expect((await boris.post(`/api/sync/${shared}/push`, { peer: "local-peer-0001", changes: mine.changes })).statusCode).toBe(200);
    expect(await detail(d.id)).toMatchObject({ description: "Pour le mois", locked: true });
    await local.close();
  });
});
