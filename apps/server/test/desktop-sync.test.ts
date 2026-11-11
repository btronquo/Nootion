import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db/index.js";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

const TOKEN = "desktop-token-0123456789-0123456789";

// A real Nootion server listening on a port, and the desktop app's local Nootion talking to it.
let server: FastifyInstance;
let serverUrl: string;
let local: FastifyInstance;
let onServer: Client;
let onLocal: Client;

beforeEach(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nootion-sync-server-"));
  const probe = await makeApp();
  await probe.close();
  server = await buildApp({
    db: openDb(":memory:"),
    config: loadConfig({ APP_SECRET: "server-secret-0123456789", DATA_DIR: dataDir, DEMO_PAGE: "false", UPDATE_CHECK: "false", APP_URL: "http://127.0.0.1:1" }),
  });
  serverUrl = await server.listen({ port: 0, host: "127.0.0.1" });
  onServer = await setupAdmin(server);

  local = await makeApp(undefined, { NOOTION_DESKTOP_TOKEN: TOKEN, APP_URL: "http://127.0.0.1:45678" });
  onLocal = new Client(local);
  const ticket = (await local.inject({ method: "POST", url: "/api/desktop/ticket", headers: { "x-nootion-desktop-token": TOKEN } })).json().ticket;
  await onLocal.get(`/api/desktop/session?ticket=${ticket}`);
});

afterEach(async () => {
  await server.close();
  await local.close();
});

/** Links a server space as the user would: consent page on the server, back to the app with a code. */
async function link(workspaceId: string) {
  const start = await onLocal.post("/api/desktop/sync/link", { serverUrl });
  expect(start.statusCode, start.body).toBe(200);
  const url = new URL(start.json().authorizeUrl);
  expect(url.origin + url.pathname).toBe(`${serverUrl}/oauth/authorize`);
  const consent = await onServer.post("/api/oauth/authorize", {
    clientId: url.searchParams.get("client_id"),
    redirectUri: url.searchParams.get("redirect_uri"),
    codeChallenge: url.searchParams.get("code_challenge"),
    state: url.searchParams.get("state"),
    workspaceIds: [workspaceId],
    readOnly: false,
  });
  expect(consent.statusCode, consent.body).toBe(200);
  const back = new URL(consent.json().redirectUrl);
  expect(back.pathname).toBe("/api/desktop/sync/callback");
  const done = await onLocal.get(back.pathname + back.search);
  expect(done.headers.location).toBe("/sync?linked=1");
}

const upload = async (c: Client, pageId: string, bytes: string) => {
  const boundary = "----nootion";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="photo.png"\r\nContent-Type: image/png\r\n\r\n`),
    Buffer.from(bytes),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await c.request("POST", `/api/pages/${pageId}/attachments`, body, { "content-type": `multipart/form-data; boundary=${boundary}` });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().attachment.id as string;
};
const syncNow = async (ws: string) => expect((await onLocal.post(`/api/desktop/sync/${ws}/now`)).json().links[0].lastError).toBeNull();
type Thread = { id: string; resolvedAt: string | null; comments: { authorId: string; authorName: string; body: string }[] };
const threads = async (c: Client, page: string) => (await c.get(`/api/pages/${page}/comments`)).json().threads as Thread[];

describe("desktop app: linking a space of a server", () => {
  it("brings the space, then keeps both sides in sync", async () => {
    const ws = (await onServer.post("/api/workspaces", { name: "Famille" })).json().workspace.id;
    const page = (await onServer.post("/api/pages", { workspaceId: ws, title: "Vacances", parentId: null })).json().page.id;

    await link(ws);

    const links = (await onLocal.get("/api/desktop/sync")).json().links;
    expect(links).toEqual([expect.objectContaining({ workspaceId: ws, name: "Famille", serverUrl, lastError: null })]);
    expect((await onLocal.get(`/api/pages/${page}`)).json().page.title).toBe("Vacances");

    // Written on the computer, then synced.
    const mine = (await onLocal.post("/api/pages", { workspaceId: ws, title: "Valises", parentId: null })).json().page.id;
    expect((await onLocal.get("/api/desktop/sync")).json().links[0].pending).toBeGreaterThan(0);
    await onLocal.post(`/api/desktop/sync/${ws}/now`);
    expect((await onServer.get(`/api/pages/${mine}`)).json().page.title).toBe("Valises");
    expect((await onLocal.get("/api/desktop/sync")).json().links[0].pending).toBe(0);

    // And the other way.
    await onServer.patch(`/api/pages/${page}`, { title: "Vacances d'été" });
    await onLocal.post(`/api/desktop/sync/${ws}/now`);
    expect((await onLocal.get(`/api/pages/${page}`)).json().page.title).toBe("Vacances d'été");
  });

  it("brings the server's personal space as a space of its own", async () => {
    const personal = (await onServer.get("/api/workspaces")).json().workspaces.find((w: { kind: string }) => w.kind === "personal").id;
    await link(personal);
    const here = (await onLocal.get("/api/workspaces")).json().workspaces.find((w: { id: string }) => w.id === personal);
    expect(here).toMatchObject({ kind: "shared", name: `Personal space · ${new URL(serverUrl).host}` });
  });

  it("brings attached files both ways, and their deletion", async () => {
    const ws = (await onServer.post("/api/workspaces", { name: "Famille" })).json().workspace.id;
    const page = (await onServer.post("/api/pages", { workspaceId: ws, title: "Photos", parentId: null })).json().page.id;
    const theirs = await upload(onServer, page, "photo du serveur");
    await link(ws);
    const here = await onLocal.get(`/api/attachments/${theirs}`);
    expect(here.statusCode).toBe(200);
    expect(here.body).toBe("photo du serveur");

    const mine = await upload(onLocal, page, "photo de l'ordinateur");
    await syncNow(ws);
    expect((await onServer.get(`/api/attachments/${mine}`)).body).toBe("photo de l'ordinateur");

    // Deleted with its page on the server: gone here too (files without an attachment are cleaned at start).
    await onServer.delete(`/api/pages/${page}`);
    await onServer.delete(`/api/pages/${page}/permanent`);
    await syncNow(ws);
    expect((await onLocal.get(`/api/attachments/${mine}`)).statusCode).toBe(404);
    expect((await onLocal.get(`/api/attachments/${theirs}`)).statusCode).toBe(404);
  });

  it("keeps comments with their authors, the computer's account being the server's one", async () => {
    const ws = (await onServer.post("/api/workspaces", { name: "Famille" })).json().workspace.id;
    const alice = await inviteUser(server, onServer, { name: "Alice", email: "alice@example.com", password: "alice-password" });
    const aliceId = await alice.id();
    await onServer.put(`/api/workspaces/${ws}/members`, { userId: aliceId, role: "editor" });
    const page = (await onServer.post("/api/pages", { workspaceId: ws, title: "Menu", parentId: null })).json().page.id;
    await alice.post(`/api/pages/${page}/comments`, { body: "On fait des crêpes ?" });
    await onServer.post(`/api/pages/${page}/comments`, { body: "Écrit sur le serveur" });
    await link(ws);

    const me = await onLocal.id();
    const here = await threads(onLocal, page);
    expect(here.map((t) => t.comments[0])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ authorId: aliceId, authorName: "Alice", body: "On fait des crêpes ?" }),
        expect.objectContaining({ authorId: me, body: "Écrit sur le serveur" }),
      ]),
    );
    // Alice's account here can't be used to sign in.
    expect((await new Client(local).post("/api/auth/login", { email: `${aliceId}@sync.invalid`, password: "x" })).statusCode).not.toBe(200);

    // Answered and resolved on the computer.
    const crepes = here.find((t) => t.comments[0].authorId === aliceId)!;
    await onLocal.post(`/api/comments/threads/${crepes.id}/replies`, { body: "Oui, avec <@" + me + ">" });
    await onLocal.post(`/api/comments/threads/${crepes.id}/resolve`, { resolved: true });
    await syncNow(ws);
    const serverMe = await onServer.id();
    const there = (await threads(onServer, page)).find((t) => t.id === crepes.id)!;
    expect(there.resolvedAt).not.toBeNull();
    expect(there.comments[1]).toMatchObject({ authorId: serverMe, body: `Oui, avec <@${serverMe}>` });
  });

  it("says when the address isn't a Nootion server", async () => {
    const res = await onLocal.post("/api/desktop/sync/link", { serverUrl: "http://127.0.0.1:9" });
    expect(res.statusCode).toBe(400);
  });

  it("unlinks: the server forgets the app, the space stays here", async () => {
    const ws = (await onServer.post("/api/workspaces", { name: "Travail" })).json().workspace.id;
    await link(ws);
    expect((await onLocal.delete(`/api/desktop/sync/${ws}`)).statusCode).toBe(200);
    expect((await onLocal.get("/api/desktop/sync")).json().links).toEqual([]);
    expect((await onLocal.get(`/api/workspaces`)).json().workspaces.some((w: { id: string }) => w.id === ws)).toBe(true);
    const tokens = (await onServer.get("/api/tokens")).json();
    expect(JSON.stringify(tokens)).not.toContain("Nootion pour ordinateur");
  });

  it("doesn't exist on a server", async () => {
    const res = await onServer.get("/api/desktop/sync");
    expect(res.statusCode).toBe(404);
  });
});
