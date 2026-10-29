import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { ADMIN, Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
beforeEach(async () => {
  app = await makeApp();
});

describe("first launch", () => {
  it("asks to create the admin, then closes", async () => {
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

  it("refuses a password that is too short", async () => {
    const res = await new Client(app).post("/api/setup", { ...ADMIN, password: "court" });
    expect(res.statusCode).toBe(400);
  });
});

describe("sign in", () => {
  beforeEach(async () => {
    await setupAdmin(app);
  });

  it("signs in with the right credentials and normalizes the email", async () => {
    const c = new Client(app);
    const res = await c.post("/api/auth/login", { email: "  BORIS@example.com ", password: ADMIN.password });
    expect(res.statusCode).toBe(200);
    expect((await c.get("/api/auth/me")).json().user.email).toBe(ADMIN.email);
  });

  it("refuses a wrong password or an unknown email with the same message", async () => {
    const bad = await new Client(app).post("/api/auth/login", { email: ADMIN.email, password: "nope-nope-nope" });
    const unknown = await new Client(app).post("/api/auth/login", { email: "x@example.com", password: "nope-nope-nope" });
    expect(bad.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(bad.json().message).toBe(unknown.json().message);
  });

  it("signing out invalidates the session", async () => {
    const c = new Client(app);
    await c.post("/api/auth/login", { email: ADMIN.email, password: ADMIN.password });
    const stolen = c.cookie;
    await c.post("/api/auth/logout");
    const res = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: stolen } });
    expect(res.statusCode).toBe(401);
  });

  it("refuses a mutation coming from another origin", async () => {
    const res = await new Client(app).post(
      "/api/auth/login",
      { email: ADMIN.email, password: ADMIN.password },
      { origin: "https://evil.example.com" },
    );
    expect(res.statusCode).toBe(403);
  });
});

describe("invitations and administration", () => {
  it("an invited person creates their account once with the link", async () => {
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

  it("an invitation for an email only accepts that email", async () => {
    const admin = await setupAdmin(app);
    const inv = (await admin.post("/api/admin/invitations", { email: "alice@example.com" })).json();
    const token = inv.url.split("/invite/")[1];
    const res = await new Client(app).post(`/api/invitations/${token}/accept`, { name: "Eve", email: "eve@example.com", password: "eve-password" });
    expect(res.statusCode).toBe(400);
  });

  it("a member has no access to the administration", async () => {
    const admin = await setupAdmin(app);
    const alice = await inviteUser(app, admin, { name: "Alice", email: "alice@example.com", password: "alice-password" });
    expect((await alice.get("/api/admin/users")).statusCode).toBe(403);
    expect((await alice.post("/api/admin/invitations", {})).statusCode).toBe(403);
    expect((await new Client(app).get("/api/admin/users")).statusCode).toBe(401);
  });

  it("disabling an account ends its sessions", async () => {
    const admin = await setupAdmin(app);
    const alice = await inviteUser(app, admin, { name: "Alice", email: "alice@example.com", password: "alice-password" });
    const aliceId = (await alice.get("/api/auth/me")).json().user.id;
    expect((await admin.patch(`/api/admin/users/${aliceId}`, { disabled: true })).statusCode).toBe(200);
    expect((await alice.get("/api/auth/me")).statusCode).toBe(401);
    const login = await new Client(app).post("/api/auth/login", { email: "alice@example.com", password: "alice-password" });
    expect(login.statusCode).toBe(403);
  });

  it("always keeps at least one administrator", async () => {
    const admin = await setupAdmin(app);
    const adminId = (await admin.get("/api/auth/me")).json().user.id;
    const res = await admin.patch(`/api/admin/users/${adminId}`, { role: "member" });
    expect(res.statusCode).toBe(409);
  });
});

describe("workspaces", () => {
  it("each user has a personal space and only sees their own", async () => {
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

describe("my account", () => {
  const avatarUpload = (c: Client, data: Buffer, type = "image/png") => {
    const boundary = "----nootion";
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="moi.png"\r\nContent-Type: ${type}\r\n\r\n`),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return c.request("POST", "/api/auth/me/avatar", body, { "content-type": `multipart/form-data; boundary=${boundary}` });
  };
  const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

  it("changes the name without the password, the email and the password with it", async () => {
    const boris = await setupAdmin(app);
    expect((await boris.patch("/api/auth/me", { name: "Boris T." })).json().user.name).toBe("Boris T.");
    expect((await boris.patch("/api/auth/me", { email: "b@example.com" })).statusCode).toBe(400);
    expect((await boris.patch("/api/auth/me", { email: "b@example.com", currentPassword: "faux-mot-de-passe" })).statusCode).toBe(400);
    expect((await boris.patch("/api/auth/me", { email: "b@example.com", currentPassword: ADMIN.password })).json().user.email).toBe("b@example.com");

    const other = new Client(app);
    await other.post("/api/auth/login", { email: "b@example.com", password: ADMIN.password });
    expect((await other.get("/api/auth/me")).statusCode).toBe(200);
    const res = await boris.patch("/api/auth/me", { newPassword: "nouveau-mot-de-passe", currentPassword: ADMIN.password });
    expect(res.statusCode).toBe(200);
    // The other device is signed out, this one stays signed in.
    expect((await other.get("/api/auth/me")).statusCode).toBe(401);
    expect((await boris.get("/api/auth/me")).statusCode).toBe(200);
    expect((await new Client(app).post("/api/auth/login", { email: "b@example.com", password: "nouveau-mot-de-passe" })).statusCode).toBe(200);
  });

  it("refuses an email already in use", async () => {
    const boris = await setupAdmin(app);
    await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
    expect((await boris.patch("/api/auth/me", { email: "alice@example.com", currentPassword: ADMIN.password })).statusCode).toBe(409);
  });

  it("avatar: image checked by its content, visible to other signed-in accounts", async () => {
    const boris = await setupAdmin(app);
    const alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
    expect((await avatarUpload(boris, Buffer.from("<svg onload=alert(1)>"), "image/png")).statusCode).toBe(400);
    const res = await avatarUpload(boris, PNG);
    expect(res.statusCode, res.body).toBe(200);
    const url = res.json().user.avatarUrl as string;
    expect(url).toMatch(/^\/api\/users\/.+\/avatar\?v=/);
    const img = await alice.get(url);
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");
    expect((await new Client(app).get(url)).statusCode).toBe(401);
    expect((await alice.get("/api/users")).json().users.find((u: { name: string }) => u.name === "Boris").avatarUrl).toBe(url);
    expect((await avatarUpload(boris, Buffer.alloc(3 * 1024 * 1024, 1))).statusCode).toBe(413);
    expect((await boris.delete("/api/auth/me/avatar")).json().user.avatarUrl).toBeNull();
    expect((await alice.get(url)).statusCode).toBe(404);
  });
});
