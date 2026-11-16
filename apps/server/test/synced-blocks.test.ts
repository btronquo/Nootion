import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SyncedBlockInfo, SyncedBlockSummary } from "@nootion/shared";
import { eq } from "drizzle-orm";
import { pages } from "../src/db/schema.js";
import { writeContent, type ProseMirrorNode } from "../src/collab.js";
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
const para = (text: string): ProseMirrorNode => ({ type: "paragraph", content: [{ type: "text", text }] });
const synced = (sourceId: string): ProseMirrorNode => ({ type: "syncedBlock", attrs: { sourceId } });

/** A synced block made in `host` from the given blocks, and shown there. */
async function makeSynced(c: Client, host: string, ...content: ProseMirrorNode[]) {
  const res = await c.post(`/api/pages/${host}/synced-blocks`, { content });
  expect(res.statusCode, res.body).toBe(200);
  const id = res.json().id as string;
  await writeContent(app.collab, app.db, host, doc(para("Avant"), synced(id)));
  return id;
}
const info = async (c: Client, id: string) => {
  const res = await c.get(`/api/synced-blocks/${id}`);
  return res.statusCode === 200 ? (res.json().block as SyncedBlockInfo) : null;
};

describe("synced blocks", () => {
  it("keep their content in a hidden page under the page where they were made", async () => {
    const office = await boris.createPage(ws, "Bureau");
    const id = await makeSynced(boris, office, para("Wi-Fi : nootion-invites"));
    const row = app.db.select().from(pages).where(eq(pages.id, id)).get()!;
    expect(row).toMatchObject({ kind: "block", parentId: office, workspaceId: ws });
    expect(row.contentText).toBe("Wi-Fi : nootion-invites");
    // Not a page of the tree, nor of the library.
    const tree = (await boris.get(`/api/workspaces/${ws}/pages`)).json().pages as { id: string }[];
    expect(tree.map((p) => p.id)).toEqual([office]);

    // Shown in a second page: both are listed.
    const kitchen = await boris.createPage(ws, "Cuisine");
    await writeContent(app.collab, app.db, kitchen, doc(synced(id)));
    const block = (await info(boris, id))!;
    expect(block.host).toMatchObject({ id: office, title: "Bureau" });
    expect(block.role).toBe("full");
    expect(JSON.stringify(block.content)).toContain("nootion-invites");
    expect(block.pages.map((p) => p.title).sort()).toEqual(["Bureau", "Cuisine"]);

    // Removed from one page: the other still shows it.
    await writeContent(app.collab, app.db, office, doc(para("Avant")));
    expect((await info(boris, id))!.pages.map((p) => p.title)).toEqual(["Cuisine"]);
  });

  it("start with an empty line, and only in pages one can edit", async () => {
    const page = await boris.createPage(ws, "Notes");
    const empty = (await boris.post(`/api/pages/${page}/synced-blocks`, {})).json().id as string;
    expect((await info(boris, empty))!.content).toEqual(doc({ type: "paragraph" }));
    const alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
    await boris.put(`/api/pages/${page}/shares`, { userId: await alice.id(), role: "viewer" });
    expect((await alice.post(`/api/pages/${page}/synced-blocks`, {})).statusCode).toBe(404);
    // Locked pages don't get new ones either.
    await boris.patch(`/api/pages/${page}`, { locked: true });
    expect((await boris.post(`/api/pages/${page}/synced-blocks`, {})).statusCode).toBe(423);
  });

  it("can't be read without access to the page where they live", async () => {
    const secret = await boris.createPage(ws, "Privé");
    const id = await makeSynced(boris, secret, para("Code de la porte : 1234"));
    const shared = await boris.createPage(ws, "Partagé");
    await writeContent(app.collab, app.db, shared, doc(para("Bonjour"), synced(id)));
    const alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
    await boris.put(`/api/pages/${shared}/shares`, { userId: await alice.id(), role: "editor" });

    expect(await info(alice, id)).toBeNull();
    // The Markdown of the page says so instead of showing it; Boris's has it.
    const markdown = (await alice.get(`/api/pages/${shared}/content`)).json().markdown as string;
    expect(markdown).toContain("Pas d'accès à ce contenu");
    expect(markdown).not.toContain("1234");
    expect((await boris.get(`/api/pages/${shared}/content`)).json().markdown).toContain("Code de la porte : 1234");
    // Nor offered by "/synced", nor found by the search.
    expect((await alice.get("/api/synced-blocks")).json().blocks).toEqual([]);
    expect((await alice.get("/api/search?q=porte")).json().results).toEqual([]);

    // Once the page is shared with her, she can.
    await boris.put(`/api/pages/${secret}/shares`, { userId: await alice.id(), role: "viewer" });
    expect((await info(alice, id))!.role).toBe("viewer");
  });

  it("are listed by /synced, and found by the search under the page where they live", async () => {
    const office = await boris.createPage(ws, "Bureau");
    const id = await makeSynced(boris, office, para("Horaires d'ouverture : 9h-18h"));
    const other = await boris.createPage(ws, "Accueil");
    await makeSynced(boris, other, para("Numéros utiles"));

    const all = (await boris.get("/api/synced-blocks")).json().blocks as SyncedBlockSummary[];
    expect(all.map((b) => b.preview).sort()).toEqual(["Horaires d'ouverture : 9h-18h", "Numéros utiles"]);
    const found = (await boris.get("/api/synced-blocks?q=horaires")).json().blocks as SyncedBlockSummary[];
    expect(found).toEqual([expect.objectContaining({ id, host: expect.objectContaining({ id: office, title: "Bureau" }) })]);
    // By the title of its page too.
    expect(((await boris.get("/api/synced-blocks?q=accueil")).json().blocks as SyncedBlockSummary[]).map((b) => b.preview)).toEqual(["Numéros utiles"]);

    const results = (await boris.get("/api/search?q=ouverture")).json().results as { id: string; title: string; snippet: string }[];
    expect(results).toEqual([expect.objectContaining({ id: office, title: "Bureau" })]);
    expect(results[0]!.snippet).toContain("ouverture");
  });

  it("list a link they hold under the page where they live", async () => {
    const target = await boris.createPage(ws, "Contacts");
    const office = await boris.createPage(ws, "Bureau");
    const id = await makeSynced(boris, office, { type: "paragraph", content: [{ type: "pageLink", attrs: { pageId: target, title: "Contacts" } }] });
    expect(id).toBeTruthy();
    const backlinks = (await boris.get(`/api/pages/${target}/backlinks`)).json().pages as { id: string }[];
    expect(backlinks.map((p) => p.id)).toEqual([office]);
  });

  it("are written out in exports and public pages", async () => {
    const office = await boris.createPage(ws, "Bureau");
    const id = await makeSynced(boris, office, para("Adresse : 1 rue des Lilas"));
    const page = await boris.createPage(ws, "Infos");
    await writeContent(app.collab, app.db, page, doc(synced(id), para("Fin")));

    const link = (await boris.put(`/api/pages/${page}/public-link`, { includeSubpages: false })).json().link;
    const pub = new Client(app);
    const content = (await pub.get(`/api/public/${link.token}/pages/${page}`)).json().page.content as ProseMirrorNode;
    expect(content.content!.map((n) => n.type)).toEqual(["paragraph", "paragraph"]);
    expect(JSON.stringify(content)).toContain("1 rue des Lilas");

    // A public link made by someone who can't read the block doesn't publish it.
    const alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
    const page2 = await boris.createPage(ws, "Infos 2");
    await writeContent(app.collab, app.db, page2, doc(synced(id)));
    await boris.put(`/api/pages/${page2}/shares`, { userId: await alice.id(), role: "full" });
    const link2 = (await alice.put(`/api/pages/${page2}/public-link`, {})).json().link;
    const content2 = JSON.stringify((await pub.get(`/api/public/${link2.token}/pages/${page2}`)).json().page.content);
    expect(content2).not.toContain("Lilas");
    expect(content2).toMatch(/Pas d'accès à ce contenu|No access to this content/);

    // The export of the space has no file for the hidden page.
    const zip = await boris.get(`/api/workspaces/${ws}/export`);
    expect(zip.statusCode).toBe(200);
    expect(zip.rawPayload.toString("latin1")).not.toMatch(/Bureau\/[^/]*\.md/);
  });

  it("are copied with the pages they live in, as synced blocks of their own", async () => {
    const office = await boris.createPage(ws, "Bureau");
    const id = await makeSynced(boris, office, para("Règlement intérieur"));
    const res = await boris.post(`/api/pages/${office}/duplicate`, {});
    expect(res.statusCode, res.body).toBe(200);
    const copyId = res.json().page.id as string;
    const copy = app.db.select().from(pages).where(eq(pages.id, copyId)).get()!;
    const sourceId = (copy.contentJson as ProseMirrorNode).content!.find((n) => n.type === "syncedBlock")!.attrs!.sourceId as string;
    expect(sourceId).not.toBe(id);
    expect(app.db.select().from(pages).where(eq(pages.id, sourceId)).get()).toMatchObject({ kind: "block", parentId: copyId });
  });

  it("go to the trash with the page they live in", async () => {
    const office = await boris.createPage(ws, "Bureau");
    const id = await makeSynced(boris, office, para("Planning"));
    const kitchen = await boris.createPage(ws, "Cuisine");
    await writeContent(app.collab, app.db, kitchen, doc(synced(id)));
    expect((await boris.delete(`/api/pages/${office}`)).statusCode).toBe(200);
    expect(await info(boris, id)).toBeNull();
    expect((await boris.get(`/api/pages/${kitchen}/content`)).json().markdown).toContain("Pas d'accès à ce contenu");
    await boris.post(`/api/pages/${office}/restore`, {});
    expect((await info(boris, id))!.pages.map((p) => p.title).sort()).toEqual(["Bureau", "Cuisine"]);
  });
});
