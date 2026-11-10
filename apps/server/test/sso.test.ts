import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";
import { startFakeOidc, type FakeOidc } from "./oidc-fake.js";

let app: FastifyInstance;
let idp: FakeOidc;
let boris: Client;
let alice: Client;
let mails: { to: string }[];

const settings = (extra: Record<string, unknown> = {}) => ({
  label: "Microsoft",
  issuer: idp.issuer,
  clientId: idp.clientId,
  clientSecret: idp.clientSecret,
  ...extra,
});

/** Goes through the whole sign-in: Nootion, the provider, back. Returns where Nootion sends the browser, and the session. */
async function ssoLogin(who: Parameters<FakeOidc["authorize"]>[1], query = "") {
  const start = await app.inject({
    method: "GET",
    url: `/api/auth/sso/start${query}`,
  });
  expect(start.statusCode).toBe(302);
  const state = start.cookies.find((c) => c.name === "nootion_sso")!;
  const back = idp.authorize(start.headers.location as string, who);
  const res = await app.inject({
    method: "GET",
    url: `/api/auth/sso/callback?${back}`,
    headers: { cookie: `nootion_sso=${state.value}` },
  });
  expect(res.statusCode).toBe(302);
  const session = res.cookies.find((c) => c.name === "nootion_session");
  const client = new Client(app);
  if (session) client.cookie = `nootion_session=${session.value}`;
  return { location: res.headers.location as string, session, client };
}

beforeEach(async () => {
  idp = await startFakeOidc();
  mails = [];
  app = await makeApp(
    undefined,
    {},
    { mailSender: async (m) => void mails.push(m) },
  );
  boris = await setupAdmin(app);
  alice = await inviteUser(app, boris, {
    name: "Alice",
    email: "alice@example.com",
    password: "alice-password",
    locale: "en",
  });
});
afterEach(async () => {
  await app.close();
  await idp.close();
});

describe("single sign-on", () => {
  it("is set by administrators, who never see the secret again", async () => {
    expect((await alice.get("/api/admin/sso")).statusCode).toBe(403);
    expect(
      (await app.inject({ method: "GET", url: "/api/setup" })).json().sso,
    ).toBeNull();
    expect(
      (await boris.put("/api/admin/sso", settings({ clientSecret: undefined })))
        .statusCode,
    ).toBe(400);
    const saved = (await boris.put("/api/admin/sso", settings())).json()
      .settings;
    expect(saved).toMatchObject({
      label: "Microsoft",
      issuer: idp.issuer,
      signup: "invited",
      passwordLogin: true,
      sessionHours: 12,
      hasSecret: true,
    });
    expect(saved.redirectUri).toBe(
      "http://localhost:3000/api/auth/sso/callback",
    );
    expect(saved.scim).toEqual({
      url: "http://localhost:3000/api/scim/v2",
      enabled: false,
    });
    expect(
      JSON.stringify(
        app.db.$client.prepare("SELECT * FROM sso_settings").all(),
      ),
    ).not.toContain(idp.clientSecret);
    // Saved again without the secret: kept.
    expect(
      (
        await boris.put(
          "/api/admin/sso",
          settings({ clientSecret: undefined, label: "Contoso" }),
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: "/api/setup" })).json().sso,
    ).toEqual({ label: "Contoso", passwordLogin: true });
  });

  it("links an existing account by its address, then by the provider's id, with a short session", async () => {
    await boris.put("/api/admin/sso", settings());
    const first = await ssoLogin(
      {
        sub: "sub-alice",
        preferred_username: "Alice@Example.com",
        name: "Alice Martin",
      },
      "?next=/page/abc",
    );
    expect(first.location).toBe("/page/abc");
    expect((await first.client.get("/api/auth/me")).json().user.email).toBe(
      "alice@example.com",
    );
    const hours = (first.session!.expires!.getTime() - Date.now()) / 3600_000;
    expect(hours).toBeGreaterThan(11.9);
    expect(hours).toBeLessThan(12.1);
    // The address changed at the provider: still the same account.
    const again = await ssoLogin({
      sub: "sub-alice",
      email: "alice.martin@example.com",
    });
    expect((await again.client.get("/api/auth/me")).json().user.id).toBe(
      await alice.id(),
    );
    // Only paths of this site.
    expect(
      (await ssoLogin({ sub: "sub-alice" }, "?next=//evil.example")).location,
    ).toBe("/");
    expect(
      (await ssoLogin({ sub: "sub-alice" }, `?next=${encodeURIComponent("/\\evil.example")}`)).location,
    ).toBe("/");
  });

  it("doesn't trust an address the provider never checked, and can stop linking by address", async () => {
    await boris.put("/api/admin/sso", settings({ signup: "anyone" }));
    // Someone typed the administrator's address at the provider, which says it isn't verified.
    const thief = await ssoLogin({ sub: "sub-thief", email: "boris@example.com", email_verified: false });
    expect(thief.location).toBe("/login?sso_error=unverified_email");
    expect(thief.session).toBeUndefined();
    // Nor does such an address make a new account.
    expect((await ssoLogin({ sub: "sub-new", email: "new@example.com", email_verified: false })).location).toBe("/login?sso_error=unverified_email");
    // Verified: linked.
    expect((await ssoLogin({ sub: "sub-alice", email: "alice@example.com", email_verified: true })).location).toBe("/");

    // Linking off: existing accounts keep their password, new people still get an account.
    expect((await boris.put("/api/admin/sso", settings({ signup: "anyone", linkByEmail: false }))).json().settings.linkByEmail).toBe(false);
    expect((await ssoLogin({ sub: "sub-boris", email: "boris@example.com" })).location).toBe("/login?sso_error=not_linked");
    expect((await ssoLogin({ sub: "sub-carol", email: "carol@example.com" })).location).toBe("/");
    // Accounts already linked still sign in.
    expect((await ssoLogin({ sub: "sub-alice" })).location).toBe("/");
  });

  it("makes accounts only for invited people, or the domains allowed", async () => {
    await boris.put("/api/admin/sso", settings());
    expect(
      (await ssoLogin({ sub: "s-carol", email: "carol@example.com" })).location,
    ).toBe("/login?sso_error=no_account");
    expect((await ssoLogin({ sub: "s-x" })).location).toBe(
      "/login?sso_error=no_email",
    );

    // Invited by address.
    await boris.post("/api/admin/invitations", {
      role: "admin",
      email: "carol@example.com",
    });
    const carol = await ssoLogin({
      sub: "s-carol",
      email: "carol@example.com",
      name: "Carol",
    });
    expect((await carol.client.get("/api/auth/me")).json().user).toMatchObject({
      name: "Carol",
      role: "admin",
    });

    // An open invitation link, followed to the provider.
    const link = (
      await boris.post("/api/admin/invitations", { role: "member" })
    )
      .json()
      .url.split("/invite/")[1];
    expect(
      (
        await app.inject({ method: "GET", url: `/api/invitations/${link}` })
      ).json().sso,
    ).toEqual({ label: "Microsoft", passwordLogin: true });
    const dan = await ssoLogin(
      { sub: "s-dan", email: "dan@other.org" },
      `?invite=${link}`,
    );
    expect((await dan.client.get("/api/auth/me")).json().user.email).toBe(
      "dan@other.org",
    );
    // Used up.
    expect(
      (
        await ssoLogin(
          { sub: "s-eve", email: "eve@other.org" },
          `?invite=${link}`,
        )
      ).location,
    ).toBe("/login?sso_error=no_account");

    await boris.put(
      "/api/admin/sso",
      settings({
        clientSecret: undefined,
        signup: "domains",
        domains: ["example.com"],
      }),
    );
    const erin = await ssoLogin({ sub: "s-erin", email: "erin@example.com" });
    expect((await erin.client.get("/api/auth/me")).json().user.name).toBe(
      "erin",
    );
    expect(
      (await ssoLogin({ sub: "s-eve", email: "eve@other.org" })).location,
    ).toBe("/login?sso_error=no_account");
  });

  it("refuses disabled accounts, a wrong state and a cancelled sign-in", async () => {
    await boris.put("/api/admin/sso", settings());
    await boris.patch(`/api/admin/users/${await alice.id()}`, {
      disabled: true,
    });
    expect(
      (await ssoLogin({ sub: "sub-alice", email: "alice@example.com" }))
        .location,
    ).toBe("/login?sso_error=disabled");

    const start = await app.inject({
      method: "GET",
      url: "/api/auth/sso/start",
    });
    const state = start.cookies.find((c) => c.name === "nootion_sso")!;
    const back = idp.authorize(start.headers.location as string, {
      sub: "x",
      email: "boris@example.com",
    });
    const forged = back.replace(/state=[^&]+/, "state=other");
    const res = await app.inject({
      method: "GET",
      url: `/api/auth/sso/callback?${forged}`,
      headers: { cookie: `nootion_sso=${state.value}` },
    });
    expect(res.headers.location).toBe("/login?sso_error=expired");
    // Without the cookie (another browser).
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/auth/sso/callback?${back}`,
        })
      ).headers.location,
    ).toBe("/login?sso_error=expired");
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/auth/sso/callback?error=access_denied`,
        })
      ).headers.location,
    ).toBe("/login?sso_error=denied");
  });

  it("can turn passwords off, except for administrators", async () => {
    await boris.put("/api/admin/sso", settings({ passwordLogin: false }));
    const login = (email: string, password: string) =>
      new Client(app).post("/api/auth/login", { email, password });
    expect(
      (await login("alice@example.com", "alice-password")).statusCode,
    ).toBe(403);
    expect(
      (await login("boris@example.com", "motdepasse-admin")).statusCode,
    ).toBe(200);
    // "Forgot password" sends nothing to accounts that sign in with SSO.
    await boris.put("/api/admin/mail", {
      provider: "smtp",
      from: "n@example.com",
      smtp: {
        host: "smtp.example.com",
        port: 587,
        security: "starttls",
        user: "",
      },
    });
    await new Client(app).post("/api/auth/forgot", {
      email: "alice@example.com",
    });
    expect(mails).toHaveLength(0);
    await new Client(app).post("/api/auth/forgot", {
      email: "boris@example.com",
    });
    expect(mails.map((m) => m.to)).toEqual(["boris@example.com"]);
    const link = (
      await boris.post("/api/admin/invitations", { role: "member" })
    )
      .json()
      .url.split("/invite/")[1];
    const accept = await new Client(app).post(
      `/api/invitations/${link}/accept`,
      { name: "Zoe", email: "zoe@example.com", password: "zoe-password" },
    );
    expect(accept.statusCode).toBe(403);
  });
});

describe("SCIM", () => {
  let token: string;
  const scim = (method: string, url: string, body?: unknown, auth = token) =>
    app.inject({
      method: method as "GET",
      url: `/api/scim/v2${url}`,
      headers: {
        authorization: `Bearer ${auth}`,
        ...(body ? { "content-type": "application/scim+json" } : {}),
      },
      payload: body ? JSON.stringify(body) : undefined,
    });

  beforeEach(async () => {
    await boris.put("/api/admin/sso", settings());
    token = (await boris.post("/api/admin/sso/scim-token", {})).json().token;
  });

  it("needs its token", async () => {
    expect((await scim("GET", "/Users", undefined, "nope")).statusCode).toBe(
      401,
    );
    expect(
      (await scim("GET", "/Users", undefined, "nt_personal")).json().schemas[0],
    ).toContain("Error");
    expect(
      (await boris.get("/api/admin/sso")).json().settings.scim.enabled,
    ).toBe(true);
    await boris.delete("/api/admin/sso/scim-token");
    expect((await scim("GET", "/Users")).statusCode).toBe(401);
  });

  it("finds, creates and updates accounts as Entra ID does", async () => {
    const found = (
      await scim(
        "GET",
        `/Users?filter=${encodeURIComponent('userName eq "ALICE@example.com"')}`,
      )
    ).json();
    expect(found).toMatchObject({
      totalResults: 1,
      Resources: [{ userName: "alice@example.com", active: true }],
    });
    expect(
      (
        await scim(
          "GET",
          `/Users?filter=${encodeURIComponent('userName eq "nobody@example.com"')}`,
        )
      ).json().totalResults,
    ).toBe(0);

    const created = await scim("POST", "/Users", {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      externalId: "frank",
      userName: "frank@example.com",
      active: true,
      displayName: "Frank Ocean",
      emails: [{ primary: true, type: "work", value: "frank@example.com" }],
      name: { givenName: "Frank", familyName: "Ocean" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.headers["content-type"]).toContain("application/scim+json");
    const id = created.json().id;
    expect(created.json()).toMatchObject({
      externalId: "frank",
      userName: "frank@example.com",
      displayName: "Frank Ocean",
      active: true,
    });
    expect(
      (await scim("POST", "/Users", { userName: "frank@example.com" }))
        .statusCode,
    ).toBe(409);
    expect(
      (
        await scim(
          "GET",
          `/Users?filter=${encodeURIComponent('externalId eq "frank"')}`,
        )
      ).json().Resources[0].id,
    ).toBe(id);

    // Entra's own style: op names capitalised, booleans as text.
    const patched = await scim("PATCH", `/Users/${id}`, {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [
        { op: "Replace", path: "displayName", value: "Frank O." },
        {
          op: "Replace",
          path: 'emails[type eq "work"].value',
          value: "frank.ocean@example.com",
        },
      ],
    });
    expect(patched.json()).toMatchObject({
      displayName: "Frank O.",
      userName: "frank.ocean@example.com",
    });

    // Then signs in with SSO: the same account.
    const frank = await ssoLogin({
      sub: "s-frank",
      email: "frank.ocean@example.com",
    });
    expect((await frank.client.get("/api/auth/me")).json().user.id).toBe(id);
  });

  it("disables people who leave, and signs them out at once", async () => {
    const aliceId = await alice.id();
    expect((await alice.get("/api/auth/me")).statusCode).toBe(200);
    const res = await scim("PATCH", `/Users/${aliceId}`, {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "Replace", path: "active", value: "False" }],
    });
    expect(res.json().active).toBe(false);
    expect((await alice.get("/api/auth/me")).statusCode).toBe(401);
    expect(
      (
        await new Client(app).post("/api/auth/login", {
          email: "alice@example.com",
          password: "alice-password",
        })
      ).statusCode,
    ).toBe(403);

    // Back again (no path, value object).
    const back = await scim("PATCH", `/Users/${aliceId}`, {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "replace", value: { active: true } }],
    });
    expect(back.json().active).toBe(true);

    // Removed at the provider: disabled, not deleted.
    expect((await scim("DELETE", `/Users/${aliceId}`)).statusCode).toBe(204);
    expect((await scim("GET", `/Users/${aliceId}`)).json().active).toBe(false);

    // Never the last administrator.
    const borisId = await boris.id();
    const last = await scim("PATCH", `/Users/${borisId}`, {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "replace", path: "active", value: false }],
    });
    expect(last.statusCode).toBe(400);
    expect((await boris.get("/api/auth/me")).statusCode).toBe(200);
  });
});
