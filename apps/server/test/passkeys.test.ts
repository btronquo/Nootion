import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { currentStep, totpCode } from "../src/auth/totp.js";
import { ADMIN, Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

const ORIGIN = "http://localhost:3000";
const b64url = (b: Buffer | Uint8Array) => Buffer.from(b).toString("base64url");
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest();

/** Just enough CBOR for an attestation object and a COSE key. */
function cbor(v: unknown): Buffer {
  const head = (major: number, n: number) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    const b = Buffer.alloc(3);
    b[0] = (major << 5) | 25;
    b.writeUInt16BE(n, 1);
    return b;
  };
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error("unsupported");
}

const UP = 0x01;
const UV = 0x04;

/** A software authenticator: one ES256 key pair, as a phone or a security key would keep. */
class FakeAuthenticator {
  credentialId = randomBytes(16);
  counter = 0;
  userHandle = "";
  private key: { privateKey: KeyObject; publicKey: KeyObject };
  constructor(
    private origin = ORIGIN,
    private rpId = "localhost",
  ) {
    this.key = generateKeyPairSync("ec", { namedCurve: "P-256" });
  }

  private authData(flags: number, attested?: Buffer) {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(this.counter);
    return Buffer.concat([sha256(this.rpId), Buffer.from([flags | (attested ? 0x40 : 0)]), count, ...(attested ? [attested] : [])]);
  }

  /** What navigator.credentials.create() gives back, as @simplewebauthn/browser turns it into JSON. */
  create(options: { challenge: string; user: { id: string } }, flags = UP | UV) {
    this.userHandle = options.user.id;
    const jwk = this.key.publicKey.export({ format: "jwk" });
    const cose = cbor(
      new Map<number, unknown>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x!, "base64url")],
        [-3, Buffer.from(jwk.y!, "base64url")],
      ]),
    );
    const idLen = Buffer.alloc(2);
    idLen.writeUInt16BE(this.credentialId.length);
    const attested = Buffer.concat([Buffer.alloc(16), idLen, this.credentialId, cose]);
    const clientData = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin: this.origin, crossOrigin: false }));
    const attestation = cbor(
      new Map<string, unknown>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", this.authData(flags, attested)],
      ]),
    );
    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: "public-key",
      response: { clientDataJSON: b64url(clientData), attestationObject: b64url(attestation), transports: ["internal"] },
      clientExtensionResults: {},
    };
  }

  /** What navigator.credentials.get() gives back: the challenge signed with the private key. */
  get(options: { challenge: string }, flags = UP | UV) {
    this.counter++;
    const authData = this.authData(flags);
    const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: options.challenge, origin: this.origin, crossOrigin: false }));
    const signature = sign("sha256", Buffer.concat([authData, sha256(clientData)]), this.key.privateKey);
    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: "public-key",
      response: { clientDataJSON: b64url(clientData), authenticatorData: b64url(authData), signature: b64url(signature), userHandle: this.userHandle },
      clientExtensionResults: {},
    };
  }
}

let app: FastifyInstance;
beforeEach(async () => {
  app = await makeApp();
});

async function addPasskey(c: Client, device: FakeAuthenticator, name?: string, password = ADMIN.password) {
  const opts = await c.post("/api/auth/passkeys/options", { password });
  expect(opts.statusCode).toBe(200);
  const res = await c.post("/api/auth/passkeys", { name, response: device.create(opts.json().options) });
  return res;
}

/** Signs in with a passkey from a fresh browser: returns the client and the last answer. */
async function passkeyLogin(device: FakeAuthenticator, flags?: number) {
  const c = new Client(app);
  const opts = await c.post("/api/auth/login/passkey/options");
  expect(opts.statusCode).toBe(200);
  const cookie = opts.cookies.find((k) => k.name === "nootion_passkey")?.value;
  expect(cookie).toBeTruthy();
  const res = await c.post("/api/auth/login/passkey", { response: device.get(opts.json().options, flags) }, { cookie: `nootion_passkey=${cookie}` });
  return { c, res, cookie, options: opts.json().options };
}

describe("passkeys", () => {
  it("are added after the password, listed, renamed and sign in on their own", async () => {
    const admin = await setupAdmin(app);
    const setup = (await new Client(app).get("/api/setup")).json();
    expect(setup.passkeys).toBe(ORIGIN);

    const wrong = await admin.post("/api/auth/passkeys/options", { password: "pas-le-bon" });
    expect(wrong.statusCode).toBe(400);

    const device = new FakeAuthenticator();
    const opts = await admin.post("/api/auth/passkeys/options", { password: ADMIN.password });
    const options = opts.json().options;
    expect(options.rp).toEqual({ name: "Nootion", id: "localhost" });
    expect(options.authenticatorSelection).toMatchObject({ residentKey: "required", userVerification: "required" });
    const added = await admin.post("/api/auth/passkeys", { response: device.create(options) });
    expect(added.statusCode).toBe(200);
    expect(added.json().passkey).toMatchObject({ name: "Clé d'accès 1", lastUsedAt: null });

    const list = (await admin.get("/api/auth/passkeys")).json();
    expect(list.available).toBe(true);
    expect(list.passkeys).toHaveLength(1);
    const id = list.passkeys[0].id;
    expect((await admin.patch(`/api/auth/passkeys/${id}`, { name: "Téléphone" })).json().passkey.name).toBe("Téléphone");

    // Excluded when adding again: the browser won't offer the same device twice.
    const again = (await admin.post("/api/auth/passkeys/options", { password: ADMIN.password })).json().options;
    expect(again.excludeCredentials.map((x: { id: string }) => x.id)).toEqual([b64url(device.credentialId)]);

    const { c, res } = await passkeyLogin(device);
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe(ADMIN.email);
    expect((await c.get("/api/auth/me")).json().user.email).toBe(ADMIN.email);
    const used = (await admin.get("/api/auth/passkeys")).json().passkeys[0];
    expect(used.lastUsedAt).not.toBeNull();
  });

  it("count as both steps: no authenticator code after a passkey", async () => {
    const admin = await setupAdmin(app);
    const setup = (await admin.post("/api/auth/2fa/setup", { password: ADMIN.password })).json();
    expect((await admin.post("/api/auth/2fa/enable", { code: totpCode(setup.secret, currentStep()) })).statusCode).toBe(200);
    const device = new FakeAuthenticator();
    expect((await addPasskey(admin, device)).statusCode).toBe(200);
    const { res } = await passkeyLogin(device);
    expect(res.statusCode).toBe(200);
    expect(res.json().user.twoFactor).toBe(true);
    expect(res.json().twoFactorRequired).toBeUndefined();
  });

  it("refuse a challenge used twice, another site, and a device that didn't check who holds it", async () => {
    const admin = await setupAdmin(app);
    const device = new FakeAuthenticator();
    await addPasskey(admin, device, "Clé");

    const first = await passkeyLogin(device);
    expect(first.res.statusCode).toBe(200);
    const replay = await new Client(app).post(
      "/api/auth/login/passkey",
      { response: device.get(first.options) },
      { cookie: `nootion_passkey=${first.cookie}` },
    );
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error).toBe("challenge_expired");

    // No fingerprint, face nor PIN: only presence. Not enough to stand for two steps.
    expect((await passkeyLogin(device, UP)).res.statusCode).toBe(401);

    // A look-alike site relaying the challenge: the browser writes its own address in what is signed.
    const phishing = new FakeAuthenticator("https://nootion.example.evil");
    const opts = await admin.post("/api/auth/passkeys/options", { password: ADMIN.password });
    expect((await admin.post("/api/auth/passkeys", { response: phishing.create(opts.json().options) })).statusCode).toBe(400);
    expect((await admin.get("/api/auth/passkeys")).json().passkeys).toHaveLength(1);

    // Signing in without having asked for a challenge in this browser.
    const bare = await new Client(app).post("/api/auth/login/passkey", { response: device.get({ challenge: "abc" }) });
    expect(bare.statusCode).toBe(401);
  });

  it("stop working once removed, only by their owner, and not for a disabled account", async () => {
    const admin = await setupAdmin(app);
    const member = await inviteUser(app, admin, { name: "Alice", email: "alice@example.com", password: "motdepasse-alice" });
    const device = new FakeAuthenticator();
    expect((await addPasskey(member, device, "Portable", "motdepasse-alice")).statusCode).toBe(200);
    const id = (await member.get("/api/auth/passkeys")).json().passkeys[0].id;

    expect((await admin.delete(`/api/auth/passkeys/${id}`)).statusCode).toBe(404);
    expect((await admin.patch(`/api/auth/passkeys/${id}`, { name: "x" })).statusCode).toBe(404);
    expect((await admin.get("/api/auth/passkeys")).json().passkeys).toHaveLength(0);

    const aliceId = await member.id();
    expect((await admin.patch(`/api/admin/users/${aliceId}`, { disabled: true })).statusCode).toBe(200);
    expect((await passkeyLogin(device)).res.statusCode).toBe(403);
    expect((await admin.patch(`/api/admin/users/${aliceId}`, { disabled: false })).statusCode).toBe(200);
    expect((await passkeyLogin(device)).res.statusCode).toBe(200);

    const relog = await new Client(app).post("/api/auth/login", { email: "alice@example.com", password: "motdepasse-alice" });
    const alice = new Client(app);
    alice.cookie = `nootion_session=${relog.cookies.find((k) => k.name === "nootion_session")!.value}`;
    expect((await alice.delete(`/api/auth/passkeys/${id}`)).statusCode).toBe(200);
    const gone = await passkeyLogin(device);
    expect(gone.res.statusCode).toBe(401);
    expect(gone.res.json().error).toBe("passkey_unknown");
  });

  it("go to the activity log: added, removed, sign-ins and refused sign-ins", async () => {
    const admin = await setupAdmin(app);
    const member = await inviteUser(app, admin, { name: "Alice", email: "alice@example.com", password: "motdepasse-alice" });
    const device = new FakeAuthenticator();
    expect((await addPasskey(member, device, "Portable", "motdepasse-alice")).statusCode).toBe(200);
    expect((await passkeyLogin(device)).res.statusCode).toBe(200);
    const aliceId = await member.id();
    const id = (await member.get("/api/auth/passkeys")).json().passkeys[0].id;
    await admin.patch(`/api/admin/users/${aliceId}`, { disabled: true });
    expect((await passkeyLogin(device)).res.statusCode).toBe(403);
    await admin.patch(`/api/admin/users/${aliceId}`, { disabled: false });
    const relog = await new Client(app).post("/api/auth/login", { email: "alice@example.com", password: "motdepasse-alice" });
    const alice = new Client(app);
    alice.cookie = `nootion_session=${relog.cookies.find((k) => k.name === "nootion_session")!.value}`;
    expect((await alice.delete(`/api/auth/passkeys/${id}`)).statusCode).toBe(200);

    const events = (await admin.get(`/api/admin/audit?actorId=${aliceId}`)).json().events as { action: string; details: Record<string, unknown> }[];
    const mine = events.filter((e) => e.action !== "user.disabled" && e.action !== "user.enabled").reverse();
    expect(mine.map((e) => e.action)).toEqual([
      "account.created",
      "account.passkey_added",
      "auth.login",
      "auth.login_failed",
      "auth.login",
      "account.passkey_removed",
    ]);
    expect(mine[1]!.details).toMatchObject({ name: "Portable" });
    expect(mine[2]!.details).toMatchObject({ method: "passkey" });
    expect(mine[3]!.details).toMatchObject({ method: "passkey", reason: "disabled" });
    expect(mine[4]!.details).toMatchObject({ method: "password" });
    expect(mine[5]!.details).toMatchObject({ name: "Portable" });
  });

  it("are off when the server isn't reached over HTTPS", async () => {
    app = await makeApp(undefined, { APP_URL: "http://nootion.lan:3000" });
    const admin = await setupAdmin(app);
    expect((await new Client(app).get("/api/setup")).json().passkeys).toBeNull();
    expect((await admin.get("/api/auth/passkeys")).json().available).toBe(false);
    expect((await admin.post("/api/auth/passkeys/options", { password: ADMIN.password })).statusCode).toBe(409);
    expect((await new Client(app).post("/api/auth/login/passkey/options")).statusCode).toBe(409);
  });

  it("are tied to the host name of APP_URL behind HTTPS", async () => {
    app = await makeApp(undefined, { APP_URL: "https://notes.example.com" });
    const admin = await setupAdmin(app);
    const opts = (await admin.post("/api/auth/passkeys/options", { password: ADMIN.password })).json().options;
    expect(opts.rp.id).toBe("notes.example.com");
    const device = new FakeAuthenticator("https://notes.example.com", "notes.example.com");
    expect((await admin.post("/api/auth/passkeys", { response: device.create(opts) })).statusCode).toBe(200);
  });
});
