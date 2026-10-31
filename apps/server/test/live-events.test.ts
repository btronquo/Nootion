import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { ServerResponse } from "node:http";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let boris: Client;
let alice: Client;
let eve: Client;
let space: string;

/** A fake open tab: keeps what it is sent. */
function tab(userId: string) {
  const got: unknown[] = [];
  const res = { write: (chunk: string) => void got.push(JSON.parse(chunk.replace(/^data: /, ""))), end() {} } as unknown as ServerResponse;
  app.liveEvents.connect(userId, res);
  return got;
}

beforeEach(async () => {
  app = await makeApp();
  boris = await setupAdmin(app);
  alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
  eve = await inviteUser(app, boris, { name: "Eve", email: "eve@example.com", password: "eve-password" });
  space = (await boris.post("/api/workspaces", { name: "Famille" })).json().workspace.id;
  await boris.put(`/api/workspaces/${space}/members`, { userId: await alice.id(), role: "editor" });
  app.liveEvents.flush();
});
afterEach(() => app.close());

describe("live events", () => {
  it("tells the members of a space when its page tree changes, and no one else", async () => {
    const aliceTab = tab(await alice.id());
    const eveTab = tab(await eve.id());
    const page = await boris.createPage(space, "Vacances");
    app.liveEvents.flush();
    expect(aliceTab).toEqual([{ type: "pages", workspaceId: space }]);
    expect(eveTab).toEqual([]);

    // A rename, a move to the trash.
    await boris.patch(`/api/pages/${page}`, { title: "Vacances 2027" });
    await boris.delete(`/api/pages/${page}`);
    app.liveEvents.flush();
    expect(aliceTab).toHaveLength(2);
  });

  it("doesn't speak of database rows, and tells people of new access", async () => {
    const eveId = await eve.id();
    const eveTab = tab(eveId);
    const db = (await boris.post("/api/databases", { workspaceId: space, parentId: null, title: "Tâches" })).json().database.id;
    await boris.put(`/api/pages/${db}/shares`, { userId: eveId, role: "viewer" });
    app.liveEvents.flush();
    expect(eveTab).toContainEqual({ type: "access" });
    eveTab.length = 0;
    expect((await boris.post(`/api/databases/${db}/rows`, {})).statusCode).toBe(200);
    app.liveEvents.flush();
    expect(eveTab).toEqual([]);
  });

  it("streams the events to the signed-in person", async () => {
    await app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = app.server.address() as { port: number };
    const res = await fetch(`http://127.0.0.1:${port}/api/events`, { headers: { cookie: alice.cookie } });
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const reader = res.body!.getReader();
    await reader.read();
    await boris.createPage(space, "Courses");
    app.liveEvents.flush();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain(`"workspaceId":"${space}"`);
    await reader.cancel();
    expect((await fetch(`http://127.0.0.1:${port}/api/events`)).status).toBe(401);
  });
});
