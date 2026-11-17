import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { DatabaseData } from "@nootion/shared";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

// The app refreshes an open database every few seconds: "not modified" while nothing it shows changed.
let app: FastifyInstance;
let boris: Client;

beforeEach(async () => {
  app = await makeApp();
  boris = await setupAdmin(app);
});

async function createDb(c: Client, title: string): Promise<DatabaseData> {
  const res = await c.post("/api/databases", { workspaceId: await c.personalWorkspace(), parentId: null, title });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().database;
}

/** The database's version tag, checking that asking again with it answers 304 without a body. */
async function version(c: Client, id: string): Promise<string> {
  const res = await c.get(`/api/databases/${id}`);
  expect(res.statusCode).toBe(200);
  const tag = res.headers.etag as string;
  expect(tag).toMatch(/^W\/"/);
  const again = await c.request("GET", `/api/databases/${id}`, undefined, { "if-none-match": tag });
  expect(again.statusCode).toBe(304);
  expect(again.body).toBe("");
  return tag;
}

describe("database version", () => {
  it("changes with rows, cells, columns, views, trash and order", async () => {
    const d = await createDb(boris, "Habitudes");
    const v0 = await version(boris, d.id);
    expect(await version(boris, d.id)).toBe(v0);

    const row = (await boris.post(`/api/databases/${d.id}/rows`, { values: {}, title: "Lundi" })).json().row;
    const row2 = (await boris.post(`/api/databases/${d.id}/rows`, { values: {}, title: "Mardi" })).json().row;
    const v1 = await version(boris, d.id);
    expect(v1).not.toBe(v0);

    const sport = (await boris.post(`/api/databases/${d.id}/properties`, { name: "Sport", type: "checkbox", config: {} })).json().property;
    const v2 = await version(boris, d.id);
    expect(v2).not.toBe(v1);

    await boris.patch(`/api/databases/${d.id}/rows/${row.id}`, { values: { [sport.id]: true } });
    const v3 = await version(boris, d.id);
    expect(v3).not.toBe(v2);

    await boris.patch(`/api/databases/${d.id}/properties/${sport.id}`, { name: "Course" });
    const v4 = await version(boris, d.id);
    expect(v4).not.toBe(v3);

    await boris.patch(`/api/databases/${d.id}/views/${d.views[0]!.id}`, { config: { sorts: [{ propertyId: sport.id, direction: "asc" }] } });
    const v5 = await version(boris, d.id);
    expect(v5).not.toBe(v4);

    await boris.post(`/api/databases/${d.id}/rows/${row2.id}/move`, { after: null });
    const v6 = await version(boris, d.id);
    expect(v6).not.toBe(v5);

    await boris.post(`/api/databases/${d.id}/rows/delete`, { ids: [row.id] });
    const v7 = await version(boris, d.id);
    expect(v7).not.toBe(v6);
    expect((await boris.get(`/api/databases/${d.id}`)).json().database.rows.map((r: { title: string }) => r.title)).toEqual(["Mardi"]);
  });

  it("changes when a related database changes", async () => {
    const tasks = await createDb(boris, "Tâches");
    const projects = await createDb(boris, "Projets");
    const project = (await boris.post(`/api/databases/${projects.id}/rows`, { values: {}, title: "Site" })).json().row;
    const rel = (await boris.post(`/api/databases/${tasks.id}/properties`, { name: "Projet", type: "relation", config: { databaseId: projects.id } })).json()
      .property;
    await boris.post(`/api/databases/${tasks.id}/rows`, { values: { [rel.id]: [project.id] }, title: "Maquette" });
    const v1 = await version(boris, tasks.id);

    // The related row's title shows in the relation cell.
    await boris.patch(`/api/databases/${projects.id}/rows/${project.id}`, { values: {}, title: "Site web" });
    const v2 = await version(boris, tasks.id);
    expect(v2).not.toBe(v1);
    expect((await boris.get(`/api/databases/${tasks.id}`)).json().database.related[project.id].title).toBe("Site web");

    // Someone who can't open the database is never told it is unchanged.
    const alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password", locale: "en" });
    const res = await alice.request("GET", `/api/databases/${tasks.id}`, undefined, { "if-none-match": v2 });
    expect(res.statusCode).toBe(404);
  });

  it("moves every minute when a formula reads the clock", async () => {
    const d = await createDb(boris, "Échéances");
    await boris.post(`/api/databases/${d.id}/properties`, { name: "Maintenant", type: "formula", config: { expression: "now()" } });
    const realNow = Date.now;
    try {
      const v1 = await version(boris, d.id);
      Date.now = () => realNow() + 61_000;
      expect(await version(boris, d.id)).not.toBe(v1);
    } finally {
      Date.now = realNow;
    }
  });
});
