import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { ADMIN, Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
beforeEach(async () => {
  app = await makeApp();
});

describe("premier lancement", () => {
  it("demande la création de l'admin puis se ferme", async () => {
    const c = new Client(app);
    expect((await c.get("/api/setup")).json()).toEqual({ needsSetup: true });

    const res = await c.post("/api/setup", ADMIN);
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ email: ADMIN.email, role: "admin" });
    expect(res.json().user.passwordHash).toBeUndefined();
    expect((await c.get("/api/auth/me")).statusCode).toBe(200);

    expect((await c.get("/api/setup")).json()).toEqual({ needsSetup: false });
    const again = await new Client(app).post("/api/setup", { ...ADMIN, email: "pirate@example.com" });
    expect(again.statusCode).toBe(409);
  });

  it("refuse un mot de passe trop court", async () => {
    const res = await new Client(app).post("/api/setup", { ...ADMIN, password: "court" });
    expect(res.statusCode).toBe(400);
  });
});

describe("connexion", () => {
  beforeEach(async () => {
    await setupAdmin(app);
  });

  it("connecte avec les bons identifiants et normalise l'email", async () => {
    const c = new Client(app);
    const res = await c.post("/api/auth/login", { email: "  BORIS@example.com ", password: ADMIN.password });
    expect(res.statusCode).toBe(200);
    expect((await c.get("/api/auth/me")).json().user.email).toBe(ADMIN.email);
  });

  it("refuse un mauvais mot de passe ou un email inconnu avec le même message", async () => {
    const bad = await new Client(app).post("/api/auth/login", { email: ADMIN.email, password: "nope-nope-nope" });
    const unknown = await new Client(app).post("/api/auth/login", { email: "x@example.com", password: "nope-nope-nope" });
    expect(bad.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(bad.json().message).toBe(unknown.json().message);
  });

  it("la déconnexion invalide la session", async () => {
    const c = new Client(app);
    await c.post("/api/auth/login", { email: ADMIN.email, password: ADMIN.password });
    const stolen = c.cookie;
    await c.post("/api/auth/logout");
    const res = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: stolen } });
    expect(res.statusCode).toBe(401);
  });

  it("refuse une mutation venant d'une autre origine", async () => {
    const res = await new Client(app).post(
      "/api/auth/login",
      { email: ADMIN.email, password: ADMIN.password },
      { origin: "https://evil.example.com" },
    );
    expect(res.statusCode).toBe(403);
  });
});

describe("invitations et administration", () => {
  it("un invité crée son compte une seule fois avec le lien", async () => {
    const admin = await setupAdmin(app);
    const inv = (await admin.post("/api/admin/invitations", {})).json();
    const token = inv.url.split("/invite/")[1];

    const alice = new Client(app);
    expect((await alice.get(`/api/invitations/${token}`)).statusCode).toBe(200);
    const res = await alice.post(`/api/invitations/${token}/accept`, { name: "Alice", email: "alice@example.com", password: "alice-password" });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.role).toBe("member");

    const reuse = await new Client(app).post(`/api/invitations/${token}/accept`, { name: "Eve", email: "eve@example.com", password: "eve-password" });
    expect(reuse.statusCode).toBe(404);
  });

  it("une invitation nominative n'accepte que son email", async () => {
    const admin = await setupAdmin(app);
    const inv = (await admin.post("/api/admin/invitations", { email: "alice@example.com" })).json();
    const token = inv.url.split("/invite/")[1];
    const res = await new Client(app).post(`/api/invitations/${token}/accept`, { name: "Eve", email: "eve@example.com", password: "eve-password" });
    expect(res.statusCode).toBe(400);
  });

  it("un membre n'a pas accès à l'administration", async () => {
    const admin = await setupAdmin(app);
    const alice = await inviteUser(app, admin, { name: "Alice", email: "alice@example.com", password: "alice-password" });
    expect((await alice.get("/api/admin/users")).statusCode).toBe(403);
    expect((await alice.post("/api/admin/invitations", {})).statusCode).toBe(403);
    expect((await new Client(app).get("/api/admin/users")).statusCode).toBe(401);
  });

  it("désactiver un compte coupe ses sessions", async () => {
    const admin = await setupAdmin(app);
    const alice = await inviteUser(app, admin, { name: "Alice", email: "alice@example.com", password: "alice-password" });
    const aliceId = (await alice.get("/api/auth/me")).json().user.id;
    expect((await admin.patch(`/api/admin/users/${aliceId}`, { disabled: true })).statusCode).toBe(200);
    expect((await alice.get("/api/auth/me")).statusCode).toBe(401);
    const login = await new Client(app).post("/api/auth/login", { email: "alice@example.com", password: "alice-password" });
    expect(login.statusCode).toBe(403);
  });

  it("garde toujours au moins un administrateur", async () => {
    const admin = await setupAdmin(app);
    const adminId = (await admin.get("/api/auth/me")).json().user.id;
    const res = await admin.patch(`/api/admin/users/${adminId}`, { role: "member" });
    expect(res.statusCode).toBe(409);
  });
});

describe("espaces de travail", () => {
  it("chaque utilisateur a son espace personnel et ne voit que les siens", async () => {
    const admin = await setupAdmin(app);
    const alice = await inviteUser(app, admin, { name: "Alice", email: "alice@example.com", password: "alice-password" });
    const a = (await admin.get("/api/workspaces")).json().workspaces;
    const b = (await alice.get("/api/workspaces")).json().workspaces;
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: "personal", role: "owner" });
    expect(a[0].id).not.toBe(b[0].id);
    expect((await new Client(app).get("/api/workspaces")).statusCode).toBe(401);
  });
});
