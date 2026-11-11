import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db/index.js";
import { Client, makeApp, setupAdmin } from "./helpers.js";

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
