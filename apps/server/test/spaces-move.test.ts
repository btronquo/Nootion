import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { attachments, pages, syncLinks, workspaceMembers, workspaces } from "../src/db/schema.js";
import { attachmentPath, uploadsDir } from "../src/attachments.js";
import { applyChanges, changesSince, type SyncChange } from "../src/sync.js";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let boris: Client;
let alice: Client;
let aliceId: string;
let personal: string;
let team: string;

beforeEach(async () => {
  app = await makeApp();
  boris = await setupAdmin(app);
  alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
  aliceId = await alice.id();
  personal = await boris.personalWorkspace();
  team = (await boris.post("/api/workspaces", { name: "Startup" })).json().workspace.id;
  await boris.put(`/api/workspaces/${team}/members`, { userId: aliceId, role: "editor" });
});

const spaceOf = (id: string) => app.db.select({ ws: pages.workspaceId }).from(pages).where(eq(pages.id, id)).get()?.ws;
const move = (c: Client, id: string, body: object) => c.post(`/api/pages/${id}/move`, body);
const links = async (pageId: string) =>
  ((await boris.get(`/api/pages/${pageId}/content`)).json().content.content as { content?: { type: string; attrs: { pageId: string } }[] }[])
    .flatMap((n) => n.content ?? [])
    .filter((n) => n.type === "pageLink")
    .map((n) => n.attrs.pageId);

describe("moving pages between spaces", () => {
  it("moves a page with its subpages, databases and rows, and changes who sees them", async () => {
    // An imported page landed in the shared space, but it was private.
    const notes = await boris.createPage(team, "Notes RH");
    const sub = await boris.createPage(team, "Salaires", notes);
    const d = (await boris.post("/api/databases", { workspaceId: team, parentId: notes, title: "Entretiens" })).json().database;
    const row = (await boris.post(`/api/databases/${d.id}/rows`, { values: { [d.properties[0].id]: "Alice" } })).json().row;
    const trashed = await boris.createPage(team, "Vieux brouillon", notes);
    await boris.delete(`/api/pages/${trashed}`);
    expect((await alice.get(`/api/pages/${sub}`)).statusCode).toBe(200);

    const res = await move(boris, notes, { workspaceId: personal, parentId: null });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ page: { id: notes, workspaceId: personal, parentId: null }, moved: 5 });
    for (const id of [notes, sub, d.id, row.id, trashed]) expect(spaceOf(id)).toBe(personal);

    // Alice no longer sees any of it; it's at the top of Boris's private space.
    for (const id of [notes, sub, d.id]) expect((await alice.get(`/api/pages/${id}`)).statusCode).toBe(404);
    expect((await alice.get(`/api/databases/${d.id}`)).statusCode).toBe(404);
    const tree = (await boris.get(`/api/workspaces/${personal}/pages`)).json().pages.map((p: { id: string }) => p.id);
    expect(tree).toEqual(expect.arrayContaining([notes, sub, d.id]));
    expect((await boris.get(`/api/workspaces/${team}/pages`)).json().pages.map((p: { id: string }) => p.id)).not.toContain(notes);
    // The database still works there, and the trashed subpage can still be restored.
    expect((await boris.get(`/api/databases/${d.id}`)).json().database.rows).toHaveLength(1);
    expect((await boris.post(`/api/pages/${trashed}/restore`)).statusCode).toBe(200);
  });

  it("shares a private draft by moving it into a shared page, keeping its content, history, files, comments and shares", async () => {
    const draft = await boris.createPage(personal, "Brouillon de levée de fonds");
    await boris.put(`/api/pages/${draft}/content`, { markdown: "Montant visé : 500 k€" });
    await boris.post(`/api/pages/${draft}/comments`, { body: "À relire", anchor: { start: "AQIDBA==", end: "BQYHCA==" }, quote: "500" });
    const file = randomUUID();
    app.db.insert(attachments).values({ id: file, pageId: draft, filename: "deck.pdf", mimeType: "application/pdf", size: 10 }).run();
    fs.mkdirSync(uploadsDir(app.config.dataDir), { recursive: true });
    fs.writeFileSync(attachmentPath(app.config.dataDir, file), "%PDF-1.4 x");
    const eve = await inviteUser(app, boris, { name: "Eve", email: "eve@example.com", password: "eve-password" });
    await boris.put(`/api/pages/${draft}/shares`, { userId: await eve.id(), role: "viewer" });
    const history = (await boris.get(`/api/pages/${draft}/history`)).json();
    expect((await alice.get(`/api/pages/${draft}`)).statusCode).toBe(404);

    const wiki = await boris.createPage(team, "Wiki");
    const res = await move(boris, draft, { workspaceId: team, parentId: wiki });
    expect(res.statusCode, res.body).toBe(200);

    expect((await alice.get(`/api/pages/${draft}`)).json().page).toMatchObject({ workspaceId: team, parentId: wiki });
    expect((await alice.get(`/api/pages/${draft}/content`)).json().markdown).toContain("500 k€");
    expect((await alice.get(`/api/pages/${draft}/comments`)).json().threads).toHaveLength(1);
    expect((await alice.get(`/api/pages/${draft}/history`)).json()).toEqual(history);
    expect((await alice.get(`/api/attachments/${file}`)).statusCode).toBe(200);
    expect((await eve.get(`/api/pages/${draft}`)).statusCode).toBe(200);
    // Its link is added to the page it went into.
    expect(await links(wiki)).toEqual([draft]);
  });

  it("removes its link from the old parent", async () => {
    const parent = await boris.createPage(team, "Projets");
    const page = await boris.createPage(team, "Projet secret", parent);
    expect(await links(parent)).toEqual([page]);
    await move(boris, page, { workspaceId: personal, parentId: null });
    expect(await links(parent)).toEqual([]);
  });

  it("only lets those who organise both spaces move pages between them", async () => {
    const mine = await boris.createPage(personal, "Journal");
    // Shared with Alice with full access, but it's Boris's private space: she can't take it out.
    await boris.put(`/api/pages/${mine}/shares`, { userId: aliceId, role: "full" });
    expect((await move(alice, mine, { workspaceId: team, parentId: null })).statusCode).toBe(403);
    expect(spaceOf(mine)).toBe(personal);

    // Into a space where she can't add pages, or isn't a member: not found.
    const page = await alice.createPage(team, "Compte rendu");
    const other = (await boris.post("/api/workspaces", { name: "Direction" })).json().workspace.id;
    expect((await move(alice, page, { workspaceId: other, parentId: null })).statusCode).toBe(404);
    await boris.put(`/api/workspaces/${other}/members`, { userId: aliceId, role: "viewer" });
    expect((await move(alice, page, { workspaceId: other, parentId: null })).statusCode).toBe(404);
    // A viewer of the space can't take a page out either.
    await boris.put(`/api/workspaces/${team}/members`, { userId: aliceId, role: "viewer" });
    expect((await move(alice, page, { workspaceId: await alice.personalWorkspace(), parentId: null })).statusCode).toBe(404);
    await boris.put(`/api/workspaces/${team}/members`, { userId: aliceId, role: "editor" });
    expect((await move(alice, page, { workspaceId: await alice.personalWorkspace(), parentId: null })).statusCode).toBe(200);

    // The new parent must be in the new space, and rows stay in their database.
    const elsewhere = await boris.createPage(team, "Ailleurs");
    expect((await move(boris, mine, { workspaceId: other, parentId: elsewhere })).statusCode).toBe(404);
    const d = (await boris.post("/api/databases", { workspaceId: team, parentId: null, title: "Base" })).json().database;
    const row = (await boris.post(`/api/databases/${d.id}/rows`, { values: {} })).json().row;
    expect((await move(boris, row.id, { workspaceId: personal, parentId: null })).statusCode).toBe(400);
  });

  it("tells the desktop app's sync: gone from the old space, everything in the new one", async () => {
    const d = (await boris.post("/api/databases", { workspaceId: team, parentId: null, title: "Clients" })).json().database;
    const row = (await boris.post(`/api/databases/${d.id}/rows`, { values: { [d.properties[0].id]: "ACME" } })).json().row;
    const before = { team: changesSince(app.db, team, 0, null).seq, personal: changesSince(app.db, personal, 0, null).seq };

    await move(boris, d.id, { workspaceId: personal, parentId: null });

    const gone = changesSince(app.db, team, before.team, null, 1000).changes;
    expect(gone).toEqual(expect.arrayContaining([{ entity: "page", id: d.id, deleted: true }, { entity: "page", id: row.id, deleted: true }]));
    const came = changesSince(app.db, personal, before.personal, null, 1000).changes;
    const kinds = (entity: string) => came.filter((c) => c.entity === entity && !c.deleted).map((c) => c.id);
    expect(kinds("page")).toEqual(expect.arrayContaining([d.id, row.id]));
    expect(kinds("property")).toEqual(expect.arrayContaining(d.properties.map((p: { id: string }) => p.id)));
    expect(kinds("view")).toHaveLength(1);
  });

  it("is refused in the desktop app for synced spaces, which follow the server instead", async () => {
    const page = await boris.createPage(team, "Synchronisée");
    app.db
      .insert(syncLinks)
      .values({ workspaceId: team, serverUrl: "https://nootion.example.com", clientId: "c", accessToken: "a", refreshToken: "r", accessExpiresAt: new Date(), peerId: "p" })
      .run();
    const res = await move(boris, page, { workspaceId: personal, parentId: null });
    expect(res.statusCode).toBe(409);
    expect(spaceOf(page)).toBe(team);
  });
});

describe("the desktop app follows a move made on the server", () => {
  it("moves its copy when the new space is pulled before the old one", async () => {
    const local = await makeApp();
    const onLocal = await setupAdmin(local);
    const me = await onLocal.id();
    const target = (await boris.post("/api/workspaces", { name: "Partagé" })).json().workspace.id;
    for (const [id, name] of [
      [team, "Startup"],
      [target, "Partagé"],
    ]) {
      local.db.insert(workspaces).values({ id, name, kind: "shared", createdBy: me }).run();
      local.db.insert(workspaceMembers).values({ workspaceId: id, userId: me, role: "owner" }).run();
      local.db
        .insert(syncLinks)
        .values({ workspaceId: id, serverUrl: "http://server", clientId: "c", accessToken: "a", refreshToken: "r", accessExpiresAt: new Date(), peerId: "p" })
        .run();
    }
    const pull = async (ws: string, since: number) => {
      const body = (await boris.get(`/api/sync/${ws}/changes?since=${since}&peer=p`)).json() as { seq: number; changes: SyncChange[] };
      await applyChanges(local.db, local.collab, ws, "server", body.changes, { followMoves: true });
      return body.seq;
    };
    const page = await boris.createPage(team, "Plan");
    const child = await boris.createPage(team, "Détail", page);
    const seqTeam = await pull(team, 0);
    const seqTarget = await pull(target, 0);
    const localSpace = (id: string) => local.db.select({ ws: pages.workspaceId }).from(pages).where(eq(pages.id, id)).get()?.ws;
    expect(localSpace(child)).toBe(team);

    expect((await move(boris, page, { workspaceId: target, parentId: null })).statusCode).toBe(200);
    await pull(target, seqTarget);
    await pull(team, seqTeam);
    expect(localSpace(page)).toBe(target);
    expect(localSpace(child)).toBe(target);
  });
});
