import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { appendContent, readContent } from "../src/collab.js";
import { syncChanges, workspaceMembers, workspaces } from "../src/db/schema.js";
import { applyChanges, changesSince, type SyncChange } from "../src/sync.js";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

// "server" is a Nootion server; "local" the desktop app's own Nootion, with the same space.
let server: FastifyInstance;
let local: FastifyInstance;
let onServer: Client;
let onLocal: Client;
let ws: string;
let pulled = 0;
let pushed = 0;
const PEER = "local-peer-0001";

async function sync(): Promise<{ pulled: number; pushed: number }> {
  let fromServer = 0;
  for (;;) {
    const res = await onServer.get(`/api/sync/${ws}/changes?since=${pulled}&peer=${PEER}`);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { seq: number; more: boolean; changes: SyncChange[] };
    fromServer += await applyChanges(local.db, local.collab, ws, "server", body.changes);
    pulled = body.seq;
    if (!body.more) break;
  }
  const mine = changesSince(local.db, ws, pushed, "server", 10_000);
  const res = await onServer.post(`/api/sync/${ws}/push`, { peer: PEER, changes: mine.changes });
  expect(res.statusCode, res.body).toBe(200);
  pushed = mine.seq;
  return { pulled: fromServer, pushed: res.json().applied };
}

const doc = (text: string) => [{ type: "paragraph", content: [{ type: "text", text }] }];
const textOf = (app: FastifyInstance, id: string) => JSON.stringify(readContent(app.collab, app.db, id));

beforeEach(async () => {
  pulled = pushed = 0;
  server = await makeApp();
  onServer = await setupAdmin(server);
  local = await makeApp();
  onLocal = await setupAdmin(local);
  // The space exists on both sides, with the same id (the desktop app creates it when linking).
  const shared = await onServer.post("/api/workspaces", { name: "Famille" });
  ws = shared.json().workspace.id;
  const me = await onLocal.id();
  local.db.insert(workspaces).values({ id: ws, name: "Famille", kind: "shared", createdBy: me }).run();
  local.db.insert(workspaceMembers).values({ workspaceId: ws, userId: me, role: "owner" }).run();
});

describe("sync between a server and the desktop app", () => {
  it("brings pages, content, databases, columns, views and rows from the server", async () => {
    const page = (await onServer.post("/api/pages", { workspaceId: ws, title: "Courses", parentId: null })).json().page.id;
    await onServer.put(`/api/pages/${page}/content`, { markdown: "Lait, œufs" });
    const d = (await onServer.post("/api/databases", { workspaceId: ws, parentId: null, title: "Factures" })).json().database;
    const amount = (await onServer.post(`/api/databases/${d.id}/properties`, { name: "Montant", type: "number" })).json().property;
    await onServer.post(`/api/databases/${d.id}/rows`, { values: { [d.properties[0].id]: "EDF", [amount.id]: 120 } });

    await sync();

    expect((await onLocal.get(`/api/pages/${page}`)).json().page.title).toBe("Courses");
    expect(textOf(local, page)).toContain("Lait, œufs");
    const there = (await onLocal.get(`/api/databases/${d.id}`)).json().database;
    expect(there.properties.map((p: { name: string }) => p.name)).toContain("Montant");
    expect(there.views).toHaveLength(1);
    expect(there.rows).toEqual([expect.objectContaining({ title: "EDF", values: expect.objectContaining({ [amount.id]: 120 }) })]);
  });

  it("merges changes made on both sides while apart", async () => {
    const d = (await onServer.post("/api/databases", { workspaceId: ws, parentId: null, title: "Tâches" })).json().database;
    const a = (await onServer.post(`/api/databases/${d.id}/properties`, { name: "A", type: "text" })).json().property;
    const b = (await onServer.post(`/api/databases/${d.id}/properties`, { name: "B", type: "text" })).json().property;
    const row = (await onServer.post(`/api/databases/${d.id}/rows`, { values: { [d.properties[0].id]: "Ligne" } })).json().row;
    const page = (await onServer.post("/api/pages", { workspaceId: ws, title: "Notes", parentId: null })).json().page.id;
    await sync();

    // Apart: each side changes something different, and both write in the same page.
    await onLocal.patch(`/api/pages/${page}`, { title: "Notes de la maison" });
    await onLocal.patch(`/api/databases/${d.id}/rows/${row.id}`, { values: { [b.id]: "écrit sur l'ordinateur" } });
    await appendContent(local.collab, local.db, page, doc("Paragraphe de l'ordinateur"));
    await onServer.patch(`/api/databases/${d.id}/rows/${row.id}`, { values: { [a.id]: "écrit sur le serveur" } });
    await appendContent(server.collab, server.db, page, doc("Paragraphe du serveur"));

    await sync();
    await sync();

    for (const [client, app] of [
      [onServer, server],
      [onLocal, local],
    ] as const) {
      expect((await client.get(`/api/pages/${page}`)).json().page.title).toBe("Notes de la maison");
      const values = (await client.get(`/api/databases/${d.id}`)).json().database.rows[0].values;
      expect(values[a.id]).toBe("écrit sur le serveur");
      expect(values[b.id]).toBe("écrit sur l'ordinateur");
      expect(textOf(app, page)).toContain("Paragraphe de l'ordinateur");
      expect(textOf(app, page)).toContain("Paragraphe du serveur");
    }
  });

  it("keeps the latest change of a cell edited on both sides", async () => {
    const d = (await onServer.post("/api/databases", { workspaceId: ws, parentId: null, title: "Budget" })).json().database;
    const row = (await onServer.post(`/api/databases/${d.id}/rows`, { values: { [d.properties[0].id]: "Avant" } })).json().row;
    await sync();
    await onServer.patch(`/api/databases/${d.id}/rows/${row.id}`, { values: { [d.properties[0].id]: "Serveur" } });
    await new Promise((r) => setTimeout(r, 5));
    await onLocal.patch(`/api/databases/${d.id}/rows/${row.id}`, { values: { [d.properties[0].id]: "Ordinateur, plus tard" } });
    await sync();
    await sync();
    for (const client of [onServer, onLocal]) {
      expect((await client.get(`/api/databases/${d.id}`)).json().database.rows[0].title).toBe("Ordinateur, plus tard");
    }
  });

  it("sends pages made on the computer, and deletions both ways", async () => {
    const mine = (await onLocal.post("/api/pages", { workspaceId: ws, title: "Écrit hors ligne", parentId: null })).json().page.id;
    const theirs = (await onServer.post("/api/pages", { workspaceId: ws, title: "À jeter", parentId: null })).json().page.id;
    await sync();
    expect((await onServer.get(`/api/pages/${mine}`)).json().page.title).toBe("Écrit hors ligne");

    // To the trash, then deleted for good on the server.
    await onServer.delete(`/api/pages/${theirs}`);
    await sync();
    expect((await onLocal.get(`/api/pages/${theirs}`)).statusCode).toBe(404);
    expect((await onServer.delete(`/api/pages/${theirs}/permanent`)).statusCode).toBe(200);
    await sync();
    expect(
      local.db
        .select()
        .from(syncChanges)
        .where(eq(syncChanges.entityId, theirs))
        .all()
        .some((c) => c.deleted),
    ).toBe(true);
  });

  it("doesn't send changes back where they came from", async () => {
    const page = (await onServer.post("/api/pages", { workspaceId: ws, title: "Une page", parentId: null })).json().page.id;
    await onServer.put(`/api/pages/${page}/content`, { markdown: "Texte" });
    await onLocal.post("/api/pages", { workspaceId: ws, title: "Une autre", parentId: null });
    await sync();
    await sync();
    expect(await sync()).toEqual({ pulled: 0, pushed: 0 });
  });

  it("is closed to people outside the space", async () => {
    const alice = await inviteUser(server, onServer, { name: "Alice", email: "alice@example.com", password: "alice-password" });
    expect((await alice.get(`/api/sync/${ws}/changes`)).statusCode).toBe(404);
    expect((await alice.post(`/api/sync/${ws}/push`, { peer: "alice-peer-1", changes: [] })).statusCode).toBe(404);
  });
});
