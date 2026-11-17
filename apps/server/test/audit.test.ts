import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AuditEvent } from "@nootion/shared";
import { auditEvents } from "../src/db/schema.js";
import { purgeOldAuditEvents } from "../src/audit.js";
import { ADMIN, Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let boris: Client;
let alice: Client;

beforeEach(async () => {
  app = await makeApp();
  boris = await setupAdmin(app);
  alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
});

async function log(query = ""): Promise<{ events: AuditEvent[]; next: string | null }> {
  const res = await boris.get(`/api/admin/audit${query ? `?${query}` : ""}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}
const actions = async (query = "") => (await log(query)).events.map((e) => e.action);

describe("the activity log", () => {
  it("is for administrators only", async () => {
    expect((await alice.get("/api/admin/audit")).statusCode).toBe(403);
    expect((await alice.get("/api/admin/audit/export")).statusCode).toBe(403);
    expect((await new Client(app).get("/api/admin/audit")).statusCode).toBe(401);
  });

  it("records the first administrator, the invitation and the new account", async () => {
    const events = (await log()).events;
    expect(events.map((e) => e.action)).toEqual(["account.created", "user.invited", "account.created"]);
    expect(events[0]).toMatchObject({ actor: { name: "Alice", email: "alice@example.com" }, details: { via: "invitation", role: "member" } });
    expect(events[2]).toMatchObject({ actor: { name: "Boris" }, details: { via: "setup" } });
    expect(events[0]!.ip).toBe("127.0.0.1");
  });

  it("records sign-ins, failed ones (with the reason) and sign-outs", async () => {
    const c = new Client(app);
    expect((await c.post("/api/auth/login", { email: ADMIN.email, password: "wrong-password" })).statusCode).toBe(401);
    expect((await c.post("/api/auth/login", { email: "nobody@example.com", password: "wrong-password" })).statusCode).toBe(401);
    expect((await c.post("/api/auth/login", { email: ADMIN.email, password: ADMIN.password })).statusCode).toBe(200);
    expect((await c.post("/api/auth/logout")).statusCode).toBe(200);
    const events = (await log("category=auth")).events;
    expect(events.map((e) => e.action)).toEqual(["auth.logout", "auth.login", "auth.login_failed", "auth.login_failed"]);
    expect(events[1]).toMatchObject({ actor: { name: "Boris" }, details: { method: "password" } });
    expect(events[2]).toMatchObject({ actor: null, details: { email: "nobody@example.com", reason: "bad_credentials" } });
    expect(events[3]).toMatchObject({ actor: { name: "Boris" }, details: { reason: "bad_credentials" } });
    // A disabled account trying to sign in.
    await boris.patch(`/api/admin/users/${await alice.id()}`, { disabled: true });
    await new Client(app).post("/api/auth/login", { email: "alice@example.com", password: "alice-password" });
    expect((await log("action=auth.login_failed&limit=1")).events[0]).toMatchObject({ actor: { name: "Alice" }, details: { reason: "disabled" } });
  });

  it("records sharing, public links, deletions and exports, with the page's title but not its content", async () => {
    const ws = await boris.personalWorkspace();
    const page = await boris.createPage(ws, "Budget 2027");
    await boris.put(`/api/pages/${page}/content`, { markdown: "Secret figures" });
    await boris.put(`/api/pages/${page}/shares`, { userId: await alice.id(), role: "editor" });
    await boris.delete(`/api/pages/${page}/shares/${await alice.id()}`);
    await boris.put(`/api/pages/${page}/public-link`, {});
    await boris.put(`/api/pages/${page}/public-link`, { password: "un-mot-de-passe" });
    await boris.delete(`/api/pages/${page}/public-link`);
    expect((await boris.get(`/api/pages/${page}/export`)).statusCode).toBe(200);
    await boris.delete(`/api/pages/${page}`);
    await boris.delete(`/api/pages/${page}/permanent`);

    const events = (await log()).events.slice(0, 8);
    expect(events.map((e) => e.action)).toEqual([
      "page.deleted",
      "page.trashed",
      "export.page",
      "page.public_link_removed",
      "page.public_link_changed",
      "page.public_link_created",
      "page.unshared",
      "page.shared",
    ]);
    expect(events.every((e) => e.target?.label === "Budget 2027")).toBe(true);
    expect(events[7]!.details).toMatchObject({ with: "Alice <alice@example.com>", role: "editor" });
    expect(events[4]!.details).toMatchObject({ password: true });
    expect(JSON.stringify(await log())).not.toContain("Secret figures");
    expect(JSON.stringify(await log())).not.toContain("un-mot-de-passe");
  });

  it("records roles, members of spaces and settings, without secret values", async () => {
    const aliceId = await alice.id();
    await boris.patch(`/api/admin/users/${aliceId}`, { role: "admin" });
    const ws = (await boris.post("/api/workspaces", { name: "Équipe" })).json().workspace.id as string;
    await boris.put(`/api/workspaces/${ws}/members`, { userId: aliceId, role: "editor" });
    await boris.put(`/api/workspaces/${ws}/members`, { userId: aliceId, role: "viewer" });
    await boris.put("/api/admin/settings", { allowGuests: false });
    const smtp = { host: "smtp.example.com", port: 587, security: "starttls", user: "nootion", password: "s3cret-smtp" };
    await boris.put("/api/admin/mail", { provider: "smtp", from: "Nootion <nootion@example.com>", smtp });

    const events = (await log()).events;
    const find = (a: string) => events.find((e) => e.action === a)!;
    expect(find("user.role_changed")).toMatchObject({ target: { type: "user", label: "Alice <alice@example.com>" }, details: { from: "member", to: "admin" } });
    expect(events.filter((e) => e.action === "workspace.member_set").map((e) => e.details)).toEqual([
      { member: "Alice <alice@example.com>", role: "viewer", from: "editor" },
      { member: "Alice <alice@example.com>", role: "editor" },
    ]);
    const settings = events.filter((e) => e.action === "settings.changed");
    expect(settings[1]).toMatchObject({ target: { label: "server" }, details: { keys: ["allowGuests"], values: { allowGuests: false } } });
    expect(settings[0]!.target?.label).toBe("mail");
    expect(settings[0]!.details?.keys).toEqual(expect.arrayContaining(["provider"]));
    expect(JSON.stringify(events)).not.toContain("s3cret-smtp");
  });

  it("keeps the name of a person whose account was deleted", async () => {
    const aliceId = await alice.id();
    expect((await alice.request("DELETE", "/api/auth/me", { password: "alice-password" })).statusCode).toBe(200);
    const e = (await log("action=account.deleted")).events[0]!;
    expect(e.actor).toEqual({ id: null, name: "Alice", email: "alice@example.com" });
    expect((await log(`actorId=${aliceId}`)).events).toEqual([]);
  });

  it("filters by family, person, words and days, and reads page after page", async () => {
    for (let i = 0; i < 5; i++) await boris.post("/api/workspaces", { name: `Espace ${i}` });
    expect(await actions("category=content")).toHaveLength(5);
    expect(await actions(`actorId=${await alice.id()}`)).toEqual(["account.created"]);
    expect((await log("q=Espace%203")).events.map((e) => e.target?.label)).toEqual(["Espace 3"]);
    expect((await log("q=alice%40example")).events.length).toBeGreaterThan(0);

    const first = await log("limit=3");
    expect(first.events).toHaveLength(3);
    const second = await log(`limit=3&before=${first.next}`);
    const third = await log(`limit=3&before=${second.next}`);
    const all = [...first.events, ...second.events, ...third.events].map((e) => e.id);
    expect(new Set(all).size).toBe(8);
    expect(third.next).toBeNull();

    const today = new Date().toISOString().slice(0, 10);
    expect((await log(`from=${today}&to=${today}`)).events).toHaveLength(8);
    expect((await log("to=2020-01-01")).events).toEqual([]);

    const people = (await boris.get("/api/admin/audit/actors")).json().actors;
    expect(people.map((p: { name: string }) => p.name)).toEqual(["Alice", "Boris"]);
  });

  it("downloads as CSV, with formulas made harmless", async () => {
    const ws = await boris.personalWorkspace();
    const page = await boris.createPage(ws, '=HYPERLINK("http://evil")');
    await boris.delete(`/api/pages/${page}`);
    const res = await boris.get("/api/admin/audit/export?category=content&sep=semicolon");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("activity-log-");
    const lines = res.body.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("Date (UTC);Personne;E-mail;Action;Code de l'action;Type de cible;Cible;Détails;Adresse");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(';Page mise à la corbeille;page.trashed;page;"\'=HYPERLINK(""http://evil"")";');
  });

  it("forgets lines older than the chosen time", async () => {
    const old = new Date(Date.now() - 40 * 86_400_000);
    app.db.insert(auditEvents).values({ id: "old", action: "auth.login", createdAt: old }).run();
    expect(purgeOldAuditEvents(app.db)).toBe(0); // one year by default
    await boris.put("/api/admin/settings", { auditRetentionDays: 30 });
    expect(purgeOldAuditEvents(app.db)).toBe(1);
    await boris.put("/api/admin/settings", { auditRetentionDays: 0 });
    app.db
      .insert(auditEvents)
      .values({ id: "older", action: "auth.login", createdAt: new Date(0) })
      .run();
    expect(purgeOldAuditEvents(app.db)).toBe(0);
  });
});
