import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import * as Y from "yjs";
import { eq } from "drizzle-orm";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { pages, pageSnapshots } from "../src/db/schema.js";
import { pruneSnapshots, recordSnapshot } from "../src/history.js";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let base: string;
let boris: Client;
const providers: HocuspocusProvider[] = [];

beforeEach(async () => {
  app = await makeApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  base = `127.0.0.1:${(app.server.address() as { port: number }).port}`;
  boris = await setupAdmin(app);
});

afterEach(async () => {
  for (const p of providers.splice(0)) {
    p.destroy();
    p.configuration.websocketProvider.destroy();
  }
  await app.close();
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
  const close = () => {
    provider.destroy();
    websocketProvider.destroy();
  };
  return { doc, synced, close };
}

function write(doc: Y.Doc, text: string) {
  const frag = doc.getXmlFragment("default");
  const p = new Y.XmlElement("paragraph");
  p.insert(0, [new Y.XmlText(text)]);
  frag.insert(frag.length, [p]);
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const paragraph = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const versions = async (pageId: string) => (await boris.get(`/api/pages/${pageId}/history`)).json().versions;

describe("page history", { timeout: 20000 }, () => {
  it("keeps a version when editors leave, with who edited", async () => {
    const ws = await boris.personalWorkspace();
    const page = await boris.createPage(ws, "Notes");
    const alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
    await boris.put(`/api/pages/${page}/shares`, { userId: await alice.id(), role: "editor" });

    const a = connect(boris, page);
    const b = connect(alice, page);
    expect(await a.synced).toBe(true);
    expect(await b.synced).toBe(true);
    write(a.doc, "Bonjour");
    await wait(200);
    write(b.doc, "Salut");
    await wait(2000);
    a.close();
    b.close();
    await wait(800);

    const list = await versions(page);
    expect(list.length).toBeGreaterThanOrEqual(1);
    const latest = list[0];
    expect(latest.title).toBe("Notes");
    const all = new Set(list.flatMap((v: { authors: { name: string }[] }) => v.authors.map((x) => x.name)));
    expect(all).toEqual(new Set(["Boris", "Alice"]));
    const body = (await boris.get(`/api/pages/${page}/history/${latest.id}`)).json();
    expect(JSON.stringify(body.content)).toContain("Salut");
  });

  it("restores a version, keeping the current one, also into an open editor", async () => {
    const ws = await boris.personalWorkspace();
    const page = await boris.createPage(ws, "Recette");
    const t0 = new Date(Date.now() - 3600_000);
    app.db
      .update(pages)
      .set({ contentJson: paragraph("Version 1") })
      .where(eq(pages.id, page))
      .run();
    recordSnapshot(app.db, page, { content: paragraph("Version 1"), now: t0 });
    await boris.patch(`/api/pages/${page}`, { title: "Recette v2" });
    app.db
      .update(pages)
      .set({ contentJson: paragraph("Version 2") })
      .where(eq(pages.id, page))
      .run();
    recordSnapshot(app.db, page, { content: paragraph("Version 2") });

    const a = connect(boris, page);
    expect(await a.synced).toBe(true);
    const list = await versions(page);
    expect(list.map((v: { title: string }) => v.title)).toEqual(["Recette v2", "Recette"]);
    const old = list[1];

    expect((await boris.post(`/api/pages/${page}/history/${old.id}/restore`)).statusCode).toBe(200);
    await wait(500);
    expect(a.doc.getXmlFragment("default").toString()).toContain("Version 1");
    expect((await boris.get(`/api/pages/${page}`)).json().page.title).toBe("Recette");
    const after = await versions(page);
    expect(after[0]).toMatchObject({ title: "Recette", restoredFrom: old.createdAt, authors: [{ name: "Boris" }] });
    expect(after.some((v: { title: string }) => v.title === "Recette v2")).toBe(true);
  });

  it("needs access to the page, and edit rights to restore", async () => {
    const ws = await boris.personalWorkspace();
    const page = await boris.createPage(ws, "Privé");
    recordSnapshot(app.db, page, { content: paragraph("x") });
    const v = (await versions(page))[0];
    const alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
    expect((await alice.get(`/api/pages/${page}/history`)).statusCode).toBe(404);
    await boris.put(`/api/pages/${page}/shares`, { userId: await alice.id(), role: "viewer" });
    expect((await alice.get(`/api/pages/${page}/history`)).statusCode).toBe(200);
    expect((await alice.post(`/api/pages/${page}/history/${v.id}/restore`)).statusCode).toBe(404);
  });
});

describe("history retention", () => {
  it("throttles versions while editing and thins out old ones", async () => {
    const ws = await boris.personalWorkspace();
    const page = await boris.createPage(ws, "Journal");
    const now = Date.now();
    expect(recordSnapshot(app.db, page, { content: paragraph("a"), now: new Date(now) })).toBe(true);
    // Same content: nothing new. Too soon: wait, unless forced.
    expect(recordSnapshot(app.db, page, { content: paragraph("a"), now: new Date(now + 60_000), force: true })).toBe(false);
    expect(recordSnapshot(app.db, page, { content: paragraph("b"), now: new Date(now + 60_000) })).toBe(false);
    expect(recordSnapshot(app.db, page, { content: paragraph("b"), now: new Date(now + 60_000), force: true })).toBe(true);
    expect(recordSnapshot(app.db, page, { content: paragraph("c"), now: new Date(now + 11 * 60_000) })).toBe(true);

    app.db.delete(pageSnapshots).run();
    const day = 86_400_000;
    // Three versions a day for 60 days.
    for (let d = 60; d >= 0; d--)
      for (const h of [1, 5, 9])
        recordSnapshot(app.db, page, { content: paragraph(`${d}-${h}`), now: new Date(now - d * day + h * 3600_000 - 12 * 3600_000), force: true });
    pruneSnapshots(app.db, page, new Date(now));
    const kept = app.db.select({ at: pageSnapshots.createdAt }).from(pageSnapshots).where(eq(pageSnapshots.pageId, page)).all();
    const recent = kept.filter((k) => now - k.at.getTime() < day).length;
    const month = kept.filter((k) => now - k.at.getTime() >= day && now - k.at.getTime() < 30 * day).length;
    const older = kept.filter((k) => now - k.at.getTime() >= 30 * day).length;
    expect(recent).toBeGreaterThanOrEqual(3);
    expect(month).toBeLessThanOrEqual(30);
    expect(older).toBeLessThanOrEqual(6);
  });
});
