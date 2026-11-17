import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { instanceSettings, users } from "../src/db/schema.js";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

describe("guided tour", () => {
  let app: FastifyInstance;
  let boris: Client;
  beforeEach(async () => {
    app = await makeApp();
    boris = await setupAdmin(app);
  });
  afterEach(() => app.close());

  it("is offered to a new account until finished or skipped", async () => {
    const alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
    expect((await alice.get("/api/onboarding")).json()).toEqual({ tour: true, setup: false, demoPageId: null });
    expect((await alice.post("/api/onboarding/tour/done")).statusCode).toBe(200);
    expect((await alice.get("/api/onboarding")).json().tour).toBe(false);
    // Each account has its own.
    expect((await boris.get("/api/onboarding")).json().tour).toBe(true);
  });

  it("is not offered to accounts from before, nor to guests, nor to visitors", async () => {
    app.db.update(users).set({ tourPending: false }).run();
    expect((await boris.get("/api/onboarding")).json().tour).toBe(false);

    const ws = (await boris.post("/api/workspaces", { name: "Équipe" })).json().workspace.id as string;
    const page = await boris.createPage(ws, "Projet client");
    const { url } = (await boris.post(`/api/pages/${page}/guests`, { email: "gina@dehors.fr", role: "viewer" })).json();
    const gina = new Client(app);
    await gina.post(`/api/invitations/${url.split("/invite/")[1]}/accept`, { name: "Gina", email: "gina@dehors.fr", password: "gina-password", locale: "fr" });
    expect((await gina.get("/api/onboarding")).json()).toEqual({ tour: false, setup: false, demoPageId: null });

    expect((await app.inject({ method: "GET", url: "/api/onboarding" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/onboarding/tour/done" })).statusCode).toBe(401);
  });

  it("points to the page with examples while the user has it", async () => {
    const { pageId } = (await boris.post("/api/demo")).json();
    expect((await boris.get("/api/onboarding")).json().demoPageId).toBe(pageId);
    await boris.delete(`/api/pages/${pageId}`);
    expect((await boris.get("/api/onboarding")).json().demoPageId).toBeNull();
  });
});

describe("setup assistant", () => {
  let app: FastifyInstance;
  let boris: Client;
  beforeEach(async () => {
    app = await makeApp();
    boris = await setupAdmin(app);
  });
  afterEach(() => app.close());

  it("follows the first administrator's account until finished or skipped", async () => {
    expect((await boris.get("/api/onboarding")).json().setup).toBe(true);
    expect((await boris.get("/api/admin/settings")).json().settings.setupPending).toBe(true);
    const alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
    // Not for members.
    expect((await alice.get("/api/onboarding")).json().setup).toBe(false);
    expect((await alice.post("/api/admin/setup/done")).statusCode).toBe(403);
    expect((await alice.get("/api/admin/setup")).statusCode).toBe(403);

    expect((await boris.post("/api/admin/setup/done")).statusCode).toBe(200);
    expect((await boris.get("/api/onboarding")).json().setup).toBe(false);
    // Other settings are kept.
    expect((await boris.get("/api/admin/settings")).json().settings).toMatchObject({ setupPending: false, allowGuests: true });
  });

  it("is not offered on a server that existed before", async () => {
    // Settings saved before this version have no "setupPending": the server counts as set up.
    app.db.update(instanceSettings).set({ config: { allowGuests: false } }).run();
    expect((await boris.get("/api/onboarding")).json().setup).toBe(false);
    expect((await boris.get("/api/admin/settings")).json().settings).toMatchObject({ setupPending: false, allowGuests: false });
  });

  it("tells where each step stands", async () => {
    const status = (await boris.get("/api/admin/setup")).json();
    expect(status).toMatchObject({
      appUrl: "http://localhost:3000",
      passkeys: true,
      filesBucket: null,
      mail: false,
      sso: null,
      backups: false,
      members: 1,
      invitations: 0,
      allowGuests: true,
    });
    expect(status.plugins.total).toBeGreaterThan(0);
    expect(status.assistant).toEqual({ installed: true, enabled: false });

    await boris.post("/api/admin/invitations", { role: "member" });
    await boris.patch("/api/admin/plugins/assistant", { enabled: true });
    const after = (await boris.get("/api/admin/setup")).json();
    expect(after.invitations).toBe(1);
    expect(after.plugins.enabled).toBe(status.plugins.enabled + 1);
    expect(after.assistant.enabled).toBe(true);
  });
});
