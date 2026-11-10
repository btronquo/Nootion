import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { ADMIN, Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
afterEach(async () => {
  await app.close();
});

describe("security headers", () => {
  it("are sent with every answer, with a content policy for the interface", async () => {
    app = await makeApp(undefined, { APP_URL: "https://notes.example.com" });
    const api = await app.inject({ method: "GET", url: "/api/health" });
    expect(api.headers).toMatchObject({
      "x-content-type-options": "nosniff",
      "x-frame-options": "SAMEORIGIN",
      "referrer-policy": "same-origin",
      "strict-transport-security": "max-age=15552000",
    });
    expect(api.headers["content-security-policy"]).toBeUndefined();

    const page = await app.inject({ method: "GET", url: "/page/abc" });
    const csp = String(page.headers["content-security-policy"]);
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    // The page where apps are allowed is never framed; public pages and forms may be.
    expect(String((await app.inject({ method: "GET", url: "/oauth/authorize" })).headers["content-security-policy"])).toContain("frame-ancestors 'none'");
    const pub = await app.inject({ method: "GET", url: "/p/some-token" });
    expect(pub.headers["x-frame-options"]).toBeUndefined();
    expect(String(pub.headers["content-security-policy"])).not.toContain("frame-ancestors");
  });

  it("leave HTTPS and the content policy out when asked", async () => {
    app = await makeApp(undefined, { CONTENT_SECURITY_POLICY: "off" });
    const page = await app.inject({ method: "GET", url: "/page/abc" });
    expect(page.headers["strict-transport-security"]).toBeUndefined();
    expect(page.headers["content-security-policy"]).toBe("frame-ancestors 'self'");
  });
});

describe("reverse proxies", () => {
  const seenIp = async (env: Record<string, string>, remoteAddress: string) => {
    app = await makeApp(undefined, env);
    app.get("/api/test-ip", async (req) => ({ ip: req.ip }));
    const res = await app.inject({ method: "GET", url: "/api/test-ip", remoteAddress, headers: { "x-forwarded-for": "203.0.113.9" } });
    await app.close();
    return res.json().ip;
  };

  it("are believed about the visitor's address only from the local network, unless told otherwise", async () => {
    // A proxy on the same network: the visitor's address is the one it gives.
    expect(await seenIp({}, "172.18.0.2")).toBe("203.0.113.9");
    // A visitor from the internet can't pose as someone else.
    expect(await seenIp({}, "198.51.100.7")).toBe("198.51.100.7");
    expect(await seenIp({ TRUST_PROXY: "false" }, "172.18.0.2")).toBe("172.18.0.2");
    expect(await seenIp({ TRUST_PROXY: "true" }, "198.51.100.7")).toBe("203.0.113.9");
    expect(await seenIp({ TRUST_PROXY: "198.51.100.0/24" }, "198.51.100.7")).toBe("203.0.113.9");
    app = await makeApp();
  });
});

describe("sign-in", () => {
  it("makes an account wait after many wrong passwords, wherever they come from", async () => {
    app = await makeApp();
    await setupAdmin(app);
    const login = (password: string, n: number) =>
      app.inject({ method: "POST", url: "/api/auth/login", payload: { email: ADMIN.email, password }, remoteAddress: `198.51.100.${n}` });
    for (let i = 0; i < 20; i++) expect((await login("wrong-password", i)).statusCode).toBe(401);
    // Even the right password waits now.
    expect((await login(ADMIN.password, 100)).statusCode).toBe(429);
    // Other accounts aren't held up.
    const other = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "x@example.com", password: "p" }, remoteAddress: "198.51.100.101" });
    expect(other.statusCode).toBe(401);
  });
});

describe("user directory", () => {
  it("lists the people one works with, not every account; others are found by their exact address", async () => {
    app = await makeApp();
    const boris = await setupAdmin(app);
    const alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
    const bob = await inviteUser(app, boris, { name: "Bob", email: "bob@example.com", password: "bob-password!" });
    const carol = await inviteUser(app, boris, { name: "Carol", email: "carol@example.com", password: "carol-password" });
    const names = async (c: Client) => (await c.get("/api/users")).json().users.map((u: { name: string }) => u.name);

    // Administrators see everyone; a member alone sees only themselves.
    expect(await names(boris)).toEqual(["Alice", "Bob", "Boris", "Carol"]);
    expect(await names(alice)).toEqual(["Alice"]);
    expect(JSON.stringify((await alice.get("/api/users")).json())).not.toContain("bob@example.com");

    // Someone else is found by their exact address only.
    expect((await alice.get("/api/users/lookup?email=bob")).statusCode).toBe(404);
    expect((await alice.get("/api/users/lookup?email=nobody@example.com")).statusCode).toBe(404);
    const found = (await alice.get("/api/users/lookup?email=Bob@Example.com")).json().user;
    expect(found).toMatchObject({ name: "Bob", email: "bob@example.com" });
    expect((await new Client(app).get("/api/users/lookup?email=bob@example.com")).statusCode).toBe(401);

    // A shared space: its members see each other.
    const team = (await alice.post("/api/workspaces", { name: "Équipe" })).json().workspace.id;
    expect((await alice.put(`/api/workspaces/${team}/members`, { userId: found.id, role: "editor" })).statusCode).toBe(200);
    expect(await names(alice)).toEqual(["Alice", "Bob"]);
    expect(await names(bob)).toEqual(["Alice", "Bob"]);
    expect(await names(carol)).toEqual(["Carol"]);

    // A page shared with Carol: she sees the people of that page, and they see her.
    const page = await alice.createPage(team, "Projet");
    expect((await alice.put(`/api/pages/${page}/shares`, { userId: await carol.id(), role: "viewer" })).statusCode).toBe(200);
    expect(await names(carol)).toEqual(["Alice", "Bob", "Carol"]);
    expect(await names(bob)).toEqual(["Alice", "Bob", "Carol"]);
  });
});
