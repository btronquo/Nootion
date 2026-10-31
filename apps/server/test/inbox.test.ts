import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Client, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let boris: Client;
let ws: string;

beforeEach(async () => {
  app = await makeApp();
  boris = await setupAdmin(app);
  ws = await boris.personalWorkspace();
});

const links = async (pageId: string) =>
  ((await boris.get(`/api/pages/${pageId}/content`)).json().content.content as { content?: { type: string; attrs: { pageId: string } }[] }[])
    .flatMap((n) => n.content ?? [])
    .filter((n) => n.type === "pageLink")
    .map((n) => n.attrs.pageId);

describe("inbox", () => {
  it("drops notes in the inbox, titled by their first line, with the link at the end", async () => {
    const empty = (await boris.get("/api/inbox")).json();
    expect(empty.items).toEqual([]);
    const inbox = (await boris.get(`/api/pages/${empty.pageId}`)).json().page;
    expect(inbox).toMatchObject({ title: "Boîte de réception", icon: "📥", workspaceId: ws, parentId: null });

    const a = (await boris.post("/api/inbox", { text: "# Acheter du pain\nAvant **19h**" })).json().page;
    expect(a.title).toBe("Acheter du pain");
    expect((await boris.get(`/api/pages/${a.id}/content`)).json().markdown.trim()).toBe("Avant **19h**");
    const b = (await boris.post("/api/inbox", { title: "Un article", text: "", url: "https://example.com/a" })).json().page;
    expect((await boris.get(`/api/pages/${b.id}/content`)).json().markdown).toContain("https://example.com/a");
    const c = (await boris.post("/api/inbox", { url: "https://example.com/b" })).json().page;
    expect(c.title).toBe("https://example.com/b");

    const { pageId, items } = (await boris.get("/api/inbox")).json();
    expect(pageId).toBe(empty.pageId);
    expect(items.map((i: { id: string }) => i.id).sort()).toEqual([a.id, b.id, c.id].sort());
    expect(await links(pageId)).toEqual([a.id, b.id, c.id]);

    expect((await boris.post("/api/inbox", { text: "  " })).statusCode).toBe(400);
  });

  it("moves a page's link with it when it is filed elsewhere", async () => {
    const note = (await boris.post("/api/inbox", { text: "Idée" })).json().page;
    const { pageId: inbox } = (await boris.get("/api/inbox")).json();
    const projects = await boris.createPage(ws, "Projets");
    expect((await boris.post(`/api/pages/${note.id}/move`, { parentId: projects })).statusCode).toBe(200);
    expect(await links(inbox)).toEqual([]);
    expect(await links(projects)).toEqual([note.id]);
    expect((await boris.get("/api/inbox")).json().items).toEqual([]);
    // To the root: the link goes, none comes.
    await boris.post(`/api/pages/${note.id}/move`, { parentId: null });
    expect(await links(projects)).toEqual([]);
  });

  it("comes back if it was deleted", async () => {
    const first = (await boris.get("/api/inbox")).json().pageId;
    await boris.delete(`/api/pages/${first}`);
    const second = (await boris.get("/api/inbox")).json().pageId;
    expect(second).not.toBe(first);
  });
});
