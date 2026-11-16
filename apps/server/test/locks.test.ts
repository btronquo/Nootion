import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import * as Y from "yjs";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import type { DatabaseData, TasksResponse } from "@nootion/shared";
import { workspaceMembers, workspaces } from "../src/db/schema.js";
import { applyChanges, changesSince, type SyncChange } from "../src/sync.js";
import { readContent } from "../src/collab.js";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let boris: Client;
let alice: Client;
let ws: string;

beforeEach(async () => {
  app = await makeApp();
  boris = await setupAdmin(app);
  alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
  ws = await boris.personalWorkspace();
});

afterEach(async () => {
  await app.close();
});

const lock = (c: Client, id: string, locked = true) => c.patch(`/api/pages/${id}`, { locked });
const getDb = async (c: Client, id: string): Promise<DatabaseData> => (await c.get(`/api/databases/${id}`)).json().database;
const textOf = (id: string) => JSON.stringify(readContent(app.collab, app.db, id));

describe("locking a page", () => {
  it("shows the lock, and refuses changes to the content, title, icon and cover until it is unlocked", async () => {
    const page = await boris.createPage(ws, "Procédure");
    await boris.put(`/api/pages/${page}/content`, { markdown: "Étape 1" });
    expect((await boris.get(`/api/pages/${page}`)).json().page.locked).toBe(false);

    expect((await lock(boris, page)).statusCode).toBe(200);
    expect((await boris.get(`/api/pages/${page}`)).json().page.locked).toBe(true);

    for (const res of [
      await boris.put(`/api/pages/${page}/content`, { markdown: "Remplacé" }),
      await boris.post(`/api/pages/${page}/content`, { markdown: "Ajouté" }),
      await boris.patch(`/api/pages/${page}`, { title: "Autre titre" }),
      await boris.patch(`/api/pages/${page}`, { icon: "🔥" }),
      await boris.patch(`/api/pages/${page}`, { cover: "https://example.com/banniere.jpg" }),
    ]) {
      expect(res.statusCode).toBe(423);
      expect(res.json().error).toBe("locked");
    }
    expect((await boris.put(`/api/pages/${page}/content`, { markdown: "x" })).json().message).toContain("verrouillée");
    expect(textOf(page)).toContain("Étape 1");
    expect(textOf(page)).not.toContain("Ajouté");
    expect((await boris.get(`/api/pages/${page}`)).json().page.title).toBe("Procédure");

    // What doesn't change the page itself still works: full width, comments, favourites, sharing.
    expect((await boris.patch(`/api/pages/${page}`, { fullWidth: true })).statusCode).toBe(200);

    // Unlocking (in the same request as a change, too) makes it editable again.
    expect((await boris.patch(`/api/pages/${page}`, { locked: false, title: "Procédure v2" })).statusCode).toBe(200);
    expect((await boris.put(`/api/pages/${page}/content`, { markdown: "Étape 2" })).statusCode).toBe(200);
    expect(textOf(page)).toContain("Étape 2");
  });

  it("only someone who can edit the page locks or unlocks it", async () => {
    const page = await boris.createPage(ws, "Référence");
    const aliceId = await alice.id();
    await boris.put(`/api/pages/${page}/shares`, { userId: aliceId, role: "viewer" });
    expect((await lock(alice, page)).statusCode).toBe(404);

    await lock(boris, page);
    expect((await lock(alice, page, false)).statusCode).toBe(404);
    // An editor may unlock it: the lock prevents accidents, it isn't a permission.
    await boris.put(`/api/pages/${page}/shares`, { userId: aliceId, role: "editor" });
    expect((await alice.put(`/api/pages/${page}/content`, { markdown: "x" })).statusCode).toBe(423);
    expect((await lock(alice, page, false)).statusCode).toBe(200);
    expect((await alice.put(`/api/pages/${page}/content`, { markdown: "x" })).statusCode).toBe(200);
  });

  it("refuses restoring a version, applying a template and checking its to-dos from the Tasks view", async () => {
    const page = await boris.createPage(ws, "Liste");
    await boris.put(`/api/pages/${page}/content`, { markdown: "- [ ] Appeler le notaire" });
    const versions = (await boris.get(`/api/pages/${page}/history`)).json().versions;
    const template = await boris.createPage(ws, "Modèle");
    await boris.patch(`/api/pages/${template}`, { template: true });
    await lock(boris, page);

    expect((await boris.post(`/api/pages/${page}/history/${versions[0].id}/restore`)).statusCode).toBe(423);
    expect((await boris.post(`/api/pages/${page}/apply-template`, { templateId: template })).statusCode).toBe(423);

    const tasks: TasksResponse = (await boris.get("/api/tasks")).json();
    const task = tasks.tasks.find((t) => t.pageId === page)!;
    expect(task.canEdit).toBe(false);
    const res = await boris.post("/api/tasks/check", { pageId: page, key: task.key, text: task.text, checked: true, today: "2026-11-16" });
    expect(res.statusCode).toBe(423);
    expect(textOf(page)).toContain('"checked":false');
  });

  it("adds no link line into a locked page when a subpage is created or moved there", async () => {
    const parent = await boris.createPage(ws, "Parent");
    await lock(boris, parent);
    const res = await boris.post("/api/pages", { workspaceId: ws, parentId: parent, title: "Enfant", linkInParent: true });
    expect(res.statusCode).toBe(200);
    expect(textOf(parent)).not.toContain("pageLink");
    const other = await boris.createPage(ws, "Autre");
    expect((await boris.post(`/api/pages/${other}/move`, { parentId: parent })).statusCode).toBe(200);
    expect(textOf(parent)).not.toContain("pageLink");
  });
});

describe("locking a database", () => {
  it("freezes its columns, views and templates, while rows can still be added and filled in", async () => {
    const d: DatabaseData = (await boris.post("/api/databases", { workspaceId: ws, parentId: null, title: "Clients" })).json().database;
    const titleCol = d.properties[0]!;
    const city = (await boris.post(`/api/databases/${d.id}/properties`, { name: "Ville", type: "text" })).json().property;
    const view = d.views[0]!;
    await lock(boris, d.id);
    expect((await getDb(boris, d.id)).locked).toBe(true);

    for (const res of [
      await boris.post(`/api/databases/${d.id}/properties`, { name: "Pays", type: "text" }),
      await boris.patch(`/api/databases/${d.id}/properties/${city.id}`, { name: "Commune" }),
      await boris.delete(`/api/databases/${d.id}/properties/${city.id}`),
      await boris.post(`/api/databases/${d.id}/views`, { name: "Tableau", type: "board" }),
      await boris.patch(`/api/databases/${d.id}/views/${view.id}`, { name: "Renommée" }),
      await boris.delete(`/api/databases/${d.id}/views/${view.id}`),
      await boris.post(`/api/databases/${d.id}/templates`),
      await boris.put(`/api/databases/${d.id}/default-template`, { templateId: null }),
      await boris.post(`/api/databases/${d.id}/import`, { csv: "Nom,Pays\nDupont,France" }),
      await boris.patch(`/api/pages/${d.id}`, { title: "Prospects" }),
    ]) {
      expect(res.statusCode).toBe(423);
    }
    expect((await boris.post(`/api/databases/${d.id}/properties`, { name: "Pays", type: "text" })).json().message).toContain("colonnes");

    const row = await boris.post(`/api/databases/${d.id}/rows`, { values: { [titleCol.id]: "Dupont", [city.id]: "Lyon" } });
    expect(row.statusCode).toBe(200);
    const rowId = row.json().row.id;
    expect((await boris.patch(`/api/databases/${d.id}/rows/${rowId}`, { values: { [city.id]: "Paris" } })).statusCode).toBe(200);
    expect((await boris.put(`/api/pages/${rowId}/content`, { markdown: "Notes" })).statusCode).toBe(200);
    expect((await boris.post(`/api/databases/${d.id}/rows/delete`, { ids: [rowId] })).statusCode).toBe(200);

    const after = await getDb(boris, d.id);
    expect(after.properties.map((p) => p.name)).toEqual(d.properties.map((p) => p.name).concat("Ville"));
    expect(after.views.map((v) => v.name)).toEqual([view.name]);

    await lock(boris, d.id, false);
    expect((await boris.post(`/api/databases/${d.id}/properties`, { name: "Pays", type: "text" })).statusCode).toBe(200);
  });

  it("a row locked on its own keeps its cells and content", async () => {
    const d: DatabaseData = (await boris.post("/api/databases", { workspaceId: ws, parentId: null, title: "Contrats" })).json().database;
    const rowId = (await boris.post(`/api/databases/${d.id}/rows`, { values: { [d.properties[0]!.id]: "Bail" } })).json().row.id;
    await lock(boris, rowId);
    expect((await boris.patch(`/api/databases/${d.id}/rows/${rowId}`, { values: { [d.properties[0]!.id]: "Autre" } })).statusCode).toBe(423);
    expect((await boris.put(`/api/pages/${rowId}/content`, { markdown: "x" })).statusCode).toBe(423);
    // The database itself isn't locked.
    expect((await boris.post(`/api/databases/${d.id}/properties`, { name: "Fin", type: "date" })).statusCode).toBe(200);
  });
});

describe("live editing of a locked page", { timeout: 15000 }, () => {
  let base: string;
  const providers: HocuspocusProvider[] = [];

  beforeEach(async () => {
    await app.listen({ port: 0, host: "127.0.0.1" });
    base = `127.0.0.1:${(app.server.address() as { port: number }).port}`;
  });

  afterEach(() => {
    for (const p of providers.splice(0)) {
      p.destroy();
      p.configuration.websocketProvider.destroy();
    }
  });

  function connect(c: Client, pageId: string) {
    const cookie = c.cookie;
    class CookieWebSocket extends WebSocket {
      constructor(url: string, protocols?: string | string[]) {
        super(url, protocols, { headers: { cookie } });
      }
    }
    const doc = new Y.Doc();
    const websocketProvider = new HocuspocusProviderWebsocket({ url: `ws://${base}/collab`, WebSocketPolyfill: CookieWebSocket });
    const provider = new HocuspocusProvider({ websocketProvider, name: pageId, document: doc, token: "session" });
    provider.attach();
    providers.push(provider);
    const synced = new Promise<boolean>((resolve) => {
      provider.on("synced", () => resolve(true));
      setTimeout(() => resolve(false), 3000);
    });
    return { doc, synced };
  }
  const write = (doc: Y.Doc, text: string) => {
    const p = new Y.XmlElement("paragraph");
    p.insert(0, [new Y.XmlText(text)]);
    doc.getXmlFragment("default").push([p]);
  };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const stored = (id: string) =>
    (app.db.$client.prepare("SELECT content_text FROM pages WHERE id = ?").get(id) as { content_text: string | null }).content_text ?? "";

  it("the editor sends nothing while the page is locked, even from a session opened before", async () => {
    const page = await boris.createPage(ws, "Charte");
    const before = connect(boris, page);
    expect(await before.synced).toBe(true);
    write(before.doc, "Article 1");
    await wait(2200);
    expect(stored(page)).toContain("Article 1");

    await lock(boris, page);
    // The open session is closed and comes back read-only.
    await wait(1500);
    write(before.doc, "Ajout en douce");
    const after = connect(boris, page);
    expect(await after.synced).toBe(true);
    write(after.doc, "Autre ajout");
    await wait(2500);
    expect(stored(page)).not.toContain("en douce");
    expect(stored(page)).not.toContain("Autre ajout");
    expect(textOf(page)).not.toContain("Autre ajout");

    await lock(boris, page, false);
    const unlocked = connect(boris, page);
    expect(await unlocked.synced).toBe(true);
    write(unlocked.doc, "Article 2");
    await wait(2200);
    expect(stored(page)).toContain("Article 2");
  });
});

describe("the desktop sync", () => {
  it("carries the lock like the other fields of a page", async () => {
    const local = await makeApp();
    const onLocal = await setupAdmin(local);
    const shared = (await boris.post("/api/workspaces", { name: "Famille" })).json().workspace.id;
    const me = await onLocal.id();
    local.db.insert(workspaces).values({ id: shared, name: "Famille", kind: "shared", createdBy: me }).run();
    local.db.insert(workspaceMembers).values({ workspaceId: shared, userId: me, role: "owner" }).run();
    const page = await boris.createPage(shared, "Règlement");
    await lock(boris, page);

    const pull = async (since: number) => {
      const res = await boris.get(`/api/sync/${shared}/changes?since=${since}&peer=local-peer-0001`);
      const body = res.json() as { seq: number; changes: SyncChange[] };
      await applyChanges(local.db, local.collab, shared, "server", body.changes);
      return body.seq;
    };
    const seq = await pull(0);
    expect((await onLocal.get(`/api/pages/${page}`)).json().page.locked).toBe(true);
    expect((await onLocal.put(`/api/pages/${page}/content`, { markdown: "x" })).statusCode).toBe(423);

    // Unlocked on the computer: unlocked on the server after the next sync.
    await lock(onLocal, page, false);
    const mine = changesSince(local.db, shared, 0, "server", 10_000);
    expect((await boris.post(`/api/sync/${shared}/push`, { peer: "local-peer-0001", changes: mine.changes })).statusCode).toBe(200);
    expect((await boris.get(`/api/pages/${page}`)).json().page.locked).toBe(false);
    expect(seq).toBeGreaterThan(0);
    await local.close();
  });
});
