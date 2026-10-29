import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import * as Y from "yjs";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let base: string;
let boris: Client;
let alice: Client;
let eve: Client;
const providers: HocuspocusProvider[] = [];

beforeEach(async () => {
  app = await makeApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const port = (app.server.address() as { port: number }).port;
  base = `127.0.0.1:${port}`;
  boris = await setupAdmin(app);
  alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
  eve = await inviteUser(app, boris, { name: "Eve", email: "eve@example.com", password: "eve-password" });
});

afterEach(async () => {
  for (const p of providers.splice(0)) {
    p.destroy();
    p.configuration.websocketProvider.destroy();
  }
  await app.close();
});

/** Opens a collaborative session on a page as the given client (cookie auth, like the browser). */
function connect(c: Client, pageId: string, origin?: string) {
  const cookie = c.cookie;
  class CookieWebSocket extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { headers: { cookie, ...(origin ? { origin } : {}) } });
    }
  }
  const doc = new Y.Doc();
  const websocketProvider = new HocuspocusProviderWebsocket({ url: `ws://${base}/collab`, WebSocketPolyfill: CookieWebSocket });
  let failed = false;
  const provider = new HocuspocusProvider({ websocketProvider, name: pageId, document: doc, token: "session", onAuthenticationFailed: () => (failed = true) });
  provider.attach();
  providers.push(provider);
  const synced = new Promise<boolean>((resolve) => {
    provider.on("synced", () => resolve(true));
    provider.on("authenticationFailed", () => resolve(false));
    setTimeout(() => resolve(false), 3000);
  });
  return { doc, provider, synced, failed: () => failed };
}

function write(doc: Y.Doc, text: string) {
  const frag = doc.getXmlFragment("default");
  const p = new Y.XmlElement("paragraph");
  p.insert(0, [new Y.XmlText(text)]);
  frag.insert(frag.length, [p]);
}

const textOf = (doc: Y.Doc) => doc.getXmlFragment("default").toString();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("real-time editing", { timeout: 15000 }, () => {
  it("syncs two editors and saves the content", async () => {
    const ws = await boris.personalWorkspace();
    const page = await boris.createPage(ws, "Notes");
    await boris.put(`/api/pages/${page}/shares`, { userId: await alice.id(), role: "editor" });

    const a = connect(boris, page);
    const b = connect(alice, page);
    expect(await a.synced).toBe(true);
    expect(await b.synced).toBe(true);

    write(a.doc, "Bonjour Alice");
    await wait(300);
    expect(textOf(b.doc)).toContain("Bonjour Alice");
    write(b.doc, "Salut Boris");
    await wait(300);
    expect(textOf(a.doc)).toContain("Salut Boris");

    // Saved (debounced) to the database, as ProseMirror JSON and plain text.
    await wait(2000);
    const row = app.db.$client.prepare("SELECT content_text, content_json FROM pages WHERE id = ?").get(page) as { content_text: string; content_json: string };
    expect(row.content_text).toBe("Bonjour Alice\nSalut Boris");
    expect(JSON.parse(row.content_json).content[0]).toEqual({ type: "paragraph", content: [{ type: "text", text: "Bonjour Alice" }] });
  });

  it("a viewer receives changes but can't change anything", async () => {
    const ws = await boris.personalWorkspace();
    const page = await boris.createPage(ws, "Notes");
    await boris.put(`/api/pages/${page}/shares`, { userId: await alice.id(), role: "viewer" });

    const a = connect(boris, page);
    const b = connect(alice, page);
    await a.synced;
    expect(await b.synced).toBe(true);
    write(a.doc, "Version officielle");
    await wait(300);
    expect(textOf(b.doc)).toContain("Version officielle");

    write(b.doc, "Modification pirate");
    await wait(500);
    expect(textOf(a.doc)).not.toContain("pirate");
    await wait(2000);
    const row = app.db.$client.prepare("SELECT content_text FROM pages WHERE id = ?").get(page) as { content_text: string };
    expect(row.content_text).toBe("Version officielle");
  });

  it("refuses a user without access, an anonymous visitor and another origin", async () => {
    const ws = await boris.personalWorkspace();
    const page = await boris.createPage(ws, "Secret");
    const owner = connect(boris, page);
    await owner.synced;
    write(owner.doc, "Code du coffre : 1234");
    await wait(300);

    const intruder = connect(eve, page);
    expect(await intruder.synced).toBe(false);
    expect(textOf(intruder.doc)).toBe("");

    const anon = connect(new Client(app), page);
    expect(await anon.synced).toBe(false);

    const crossSite = connect(boris, page, "https://evil.example.com");
    expect(await crossSite.synced).toBe(false);
    expect(textOf(crossSite.doc)).toBe("");
  });

  it("removing the share ends the current session", async () => {
    const ws = await boris.personalWorkspace();
    const page = await boris.createPage(ws, "Notes");
    const aliceId = await alice.id();
    await boris.put(`/api/pages/${page}/shares`, { userId: aliceId, role: "editor" });
    const a = connect(boris, page);
    const b = connect(alice, page);
    await a.synced;
    expect(await b.synced).toBe(true);

    await boris.delete(`/api/pages/${page}/shares/${aliceId}`);
    await wait(1500);
    write(a.doc, "Après le retrait");
    await wait(500);
    expect(textOf(b.doc)).not.toContain("Après le retrait");

    // The owner was reconnected transparently and keeps collaborating.
    const again = connect(boris, page);
    expect(await again.synced).toBe(true);
    await wait(300);
    expect(textOf(again.doc)).toContain("Après le retrait");
  });

  it("the content is visible through the public link, without leaking linked private pages", async () => {
    const ws = await boris.personalWorkspace();
    const page = await boris.createPage(ws, "Recette");
    const secret = await boris.createPage(ws, "Journal intime");
    const a = connect(boris, page);
    await a.synced;
    write(a.doc, "Farine, oeufs");
    const frag = a.doc.getXmlFragment("default");
    const p = new Y.XmlElement("paragraph");
    const link = new Y.XmlElement("pageLink");
    link.setAttribute("pageId", secret);
    link.setAttribute("title", "Journal intime");
    p.insert(0, [link]);
    frag.insert(frag.length, [p]);
    await wait(2200);

    const pub = (await boris.put(`/api/pages/${page}/public-link`, {})).json().link;
    const res = (await new Client(app).get(`/api/public/${pub.token}/pages/${page}`)).json();
    expect(JSON.stringify(res.page.content)).toContain("Farine, oeufs");
    expect(JSON.stringify(res.page.content)).not.toContain("Journal intime");
    expect(JSON.stringify(res.page.content)).not.toContain(secret);
  });
});

describe("attached files", () => {
  async function upload(c: Client, pageId: string, name: string, type: string, body: string) {
    const form = new FormData();
    form.append("file", new Blob([body], { type }), name);
    return fetch(`http://${base}/api/pages/${pageId}/attachments`, { method: "POST", body: form, headers: { cookie: c.cookie } });
  }

  it("only those who see the page see its files", async () => {
    const ws = await boris.personalWorkspace();
    const page = await boris.createPage(ws, "Factures");
    const res = await upload(boris, page, "facture.pdf", "application/pdf", "%PDF-1.4 facture");
    expect(res.status).toBe(200);
    const { attachment } = (await res.json()) as { attachment: { id: string; url: string } };

    const own = await boris.get(attachment.url);
    expect(own.statusCode).toBe(200);
    expect(own.body).toBe("%PDF-1.4 facture");
    expect(own.headers["content-type"]).toBe("application/pdf");

    expect((await alice.get(attachment.url)).statusCode).toBe(404);
    expect((await new Client(app).get(attachment.url)).statusCode).toBe(401);
    expect((await upload(alice, page, "x.txt", "text/plain", "x")).status).toBe(404);

    await boris.put(`/api/pages/${page}/shares`, { userId: await alice.id(), role: "viewer" });
    expect((await alice.get(attachment.url)).statusCode).toBe(200);
    expect((await upload(alice, page, "x.txt", "text/plain", "x")).status).toBe(404);

    const link = (await boris.put(`/api/pages/${page}/public-link`, {})).json().link;
    expect((await new Client(app).get(`/api/public/${link.token}/attachments/${attachment.id}`)).statusCode).toBe(200);
  });

  it("an HTML or SVG file is always downloaded, never displayed", async () => {
    const ws = await boris.personalWorkspace();
    const page = await boris.createPage(ws, "Pièges");
    for (const [name, type] of [["x.html", "text/html"], ["x.svg", "image/svg+xml"]]) {
      const { attachment } = (await (await upload(boris, page, name, type, "<script>alert(1)</script>")).json()) as { attachment: { url: string } };
      const res = await boris.get(attachment.url);
      expect(res.headers["content-type"]).toBe("application/octet-stream");
      expect(res.headers["content-disposition"]).toMatch(/^attachment/);
    }
  });

  it("permanent deletion also removes the files from disk", async () => {
    const ws = await boris.personalWorkspace();
    const page = await boris.createPage(ws, "Temp");
    const { attachment } = (await (await upload(boris, page, "a.txt", "text/plain", "hello")).json()) as { attachment: { id: string } };
    const fs = await import("node:fs");
    const file = `${app.config.dataDir}/uploads/${attachment.id}`;
    expect(fs.existsSync(file)).toBe(true);
    await boris.delete(`/api/pages/${page}`);
    await boris.delete(`/api/pages/${page}/permanent`);
    expect(fs.existsSync(file)).toBe(false);
  });
});
