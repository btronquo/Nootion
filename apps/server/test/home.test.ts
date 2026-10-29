import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let boris: Client;

beforeEach(async () => {
  app = await makeApp();
  boris = await setupAdmin(app);
});

const home = async (c: Client) => (await c.get("/api/home")).json().pageId as string;

describe("home page", () => {
  it("is created once, with widgets, and kept out of the tree and the trash", async () => {
    const id = await home(boris);
    expect(await home(boris)).toBe(id);
    const page = (await boris.get(`/api/pages/${id}`)).json().page;
    expect(page).toMatchObject({ title: "Accueil", home: true, role: "full" });
    const json = app.db.$client.prepare("SELECT content_json FROM pages WHERE id = ?").get(id) as { content_json: string };
    expect(JSON.parse(json.content_json).content.map((n: { type: string }) => n.type)).toEqual(["recentPages", "upcomingEvents", "favoritesList", "paragraph"]);

    const ws = await boris.personalWorkspace();
    const other = await boris.createPage(ws, "Notes");
    expect((await boris.get(`/api/pages/${other}`)).json().page.home).toBe(false);
    const tree = (await boris.get(`/api/workspaces/${ws}/pages`)).json().pages.map((p: { id: string }) => p.id);
    expect(tree).toEqual([other]);
    expect((await boris.delete(`/api/pages/${id}`)).statusCode).toBe(400);
  });

  it("belongs to each user", async () => {
    const alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "motdepasse-alice" });
    const mine = await home(boris);
    const hers = await home(alice);
    expect(hers).not.toBe(mine);
    expect((await alice.get(`/api/pages/${mine}`)).statusCode).toBe(404);
  });

  it("lists recently visited pages, newest first, without the home page or pages gone", async () => {
    const ws = await boris.personalWorkspace();
    const a = await boris.createPage(ws, "A");
    const b = await boris.createPage(ws, "B");
    const c = await boris.createPage(ws, "C");
    await boris.patch(`/api/pages/${b}`, { cover: "gradient:ocean" });
    for (const id of [a, b, c, await home(boris), a]) {
      await boris.get(`/api/pages/${id}`);
      await new Promise((r) => setTimeout(r, 5));
    }
    let recent = (await boris.get("/api/recent")).json().pages;
    expect(recent.map((p: { title: string }) => p.title)).toEqual(["A", "C", "B"]);
    expect(recent[2]).toMatchObject({ cover: "gradient:ocean", coverPosition: 50 });
    expect(typeof recent[0].visitedAt).toBe("string");

    await boris.delete(`/api/pages/${c}`);
    recent = (await boris.get("/api/recent?limit=1")).json().pages;
    expect(recent.map((p: { title: string }) => p.title)).toEqual(["A"]);
    expect((await boris.get("/api/recent")).json().pages.map((p: { title: string }) => p.title)).toEqual(["A", "B"]);
  });
});
