import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let boris: Client;
let alice: Client;

beforeEach(async () => {
  app = await makeApp();
  boris = await setupAdmin(app);
  alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
});

const favorites = async (c: Client) => (await c.get("/api/favorites")).json().pages.map((p: { title: string }) => p.title);

describe("favorites", () => {
  it("stars pages, in the order chosen, for each user", async () => {
    const ws = await boris.personalWorkspace();
    const a = await boris.createPage(ws, "A");
    const b = await boris.createPage(ws, "B");
    const c = await boris.createPage(ws, "C", a);
    for (const id of [b, c, a]) expect((await boris.put(`/api/favorites/${id}`, {})).statusCode).toBe(200);
    // Starring twice changes nothing.
    await boris.put(`/api/favorites/${b}`, {});
    expect(await favorites(boris)).toEqual(["B", "C", "A"]);

    expect((await boris.post("/api/favorites/order", { pageIds: [a, b, c] })).statusCode).toBe(200);
    expect(await favorites(boris)).toEqual(["A", "B", "C"]);
    await boris.delete(`/api/favorites/${b}`);
    expect(await favorites(boris)).toEqual(["A", "C"]);
    expect(await favorites(alice)).toEqual([]);
  });

  it("only stars readable pages, and hides those trashed or unshared", async () => {
    const ws = await boris.personalWorkspace();
    const a = await boris.createPage(ws, "A");
    const b = await boris.createPage(ws, "B", a);
    // Alice can't see Boris's pages.
    expect((await alice.put(`/api/favorites/${a}`, {})).statusCode).toBe(404);

    await boris.put(`/api/pages/${a}/shares`, { userId: await alice.id(), role: "viewer" });
    expect((await alice.put(`/api/favorites/${b}`, {})).statusCode).toBe(200);
    expect(await favorites(alice)).toEqual(["B"]);
    await boris.delete(`/api/pages/${a}/shares/${await alice.id()}`);
    expect(await favorites(alice)).toEqual([]);

    await boris.put(`/api/favorites/${b}`, {});
    await boris.delete(`/api/pages/${a}`);
    expect(await favorites(boris)).toEqual([]);
    // Restored with its parent, it is a favorite again.
    await boris.post(`/api/pages/${a}/restore`);
    expect(await favorites(boris)).toEqual(["B"]);
  });
});
