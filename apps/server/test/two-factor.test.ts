import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { base32Decode, base32Encode, checkTotp, currentStep, totpCode } from "../src/auth/totp.js";
import { ADMIN, Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
beforeEach(async () => {
  app = await makeApp();
});

describe("TOTP codes", () => {
  it("match the RFC 6238 test vectors", () => {
    // Secret "12345678901234567890", SHA-1, 8 digits in the RFC: the last 6 are what 6-digit apps show.
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(totpCode(secret, Math.floor(59 / 30))).toBe("287082");
    expect(totpCode(secret, Math.floor(1111111109 / 30))).toBe("081804");
    expect(totpCode(secret, Math.floor(20000000000 / 30))).toBe("353130");
  });

  it("round-trips base32", () => {
    const data = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 7]);
    expect(base32Decode(base32Encode(data))).toEqual(data);
  });

  it("accepts the step next to now, but never a step already used", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    const now = 1_800_000_000_000;
    const step = currentStep(now);
    expect(checkTotp(secret, totpCode(secret, step - 1), null, now)).toBe(step - 1);
    expect(checkTotp(secret, totpCode(secret, step - 2), null, now)).toBeNull();
    expect(checkTotp(secret, totpCode(secret, step), step, now)).toBeNull();
    expect(checkTotp(secret, "12345", null, now)).toBeNull();
  });
});

const codeNow = (secret: string, offset = 0) => totpCode(secret, currentStep() + offset);

/** Turns 2FA on for the signed-in client; returns the secret and recovery codes. */
async function enable(c: Client, password = ADMIN.password) {
  const setup = await c.post("/api/auth/2fa/setup", { password });
  expect(setup.statusCode).toBe(200);
  const { secret, otpauthUrl, qrSvg } = setup.json();
  expect(otpauthUrl).toContain(`secret=${secret}`);
  expect(qrSvg).toContain("<svg");
  const res = await c.post("/api/auth/2fa/enable", { code: codeNow(secret) });
  expect(res.statusCode).toBe(200);
  expect(res.json().user.twoFactor).toBe(true);
  return { secret: secret as string, recoveryCodes: res.json().recoveryCodes as string[] };
}

/** Signs in with the password: returns the client and the 2FA challenge cookie. */
async function passwordStep(email = ADMIN.email, password = ADMIN.password) {
  const c = new Client(app);
  const res = await c.post("/api/auth/login", { email, password });
  expect(res.statusCode).toBe(200);
  const challenge = res.cookies.find((k) => k.name === "nootion_2fa")?.value;
  return { c, res, challenge };
}

const secondStep = (c: Client, challenge: string | undefined, code: string) =>
  c.post("/api/auth/login/2fa", { code }, challenge ? { cookie: `nootion_2fa=${challenge}` } : {});

describe("two-factor sign-in", () => {
  let admin: Client;
  beforeEach(async () => {
    admin = await setupAdmin(app);
  });

  it("is off by default, and needs the password to set up", async () => {
    expect((await admin.get("/api/auth/2fa")).json()).toEqual({ enabled: false, recoveryCodesLeft: 0 });
    expect((await admin.get("/api/auth/me")).json().user.twoFactor).toBe(false);
    expect((await admin.post("/api/auth/2fa/setup", { password: "wrong-password" })).statusCode).toBe(400);
  });

  it("refuses a wrong code when turning it on", async () => {
    await admin.post("/api/auth/2fa/setup", { password: ADMIN.password });
    expect((await admin.post("/api/auth/2fa/enable", { code: "000000" })).statusCode).toBe(400);
    expect((await admin.get("/api/auth/2fa")).json().enabled).toBe(false);
  });

  it("asks for the code after the password, then signs in", async () => {
    const { secret, recoveryCodes } = await enable(admin);
    expect(recoveryCodes).toHaveLength(10);
    expect((await admin.get("/api/auth/2fa")).json()).toEqual({ enabled: true, recoveryCodesLeft: 10 });

    const { c, res, challenge } = await passwordStep();
    expect(res.json()).toEqual({ twoFactorRequired: true });
    expect(challenge).toBeTruthy();
    // No session yet.
    expect((await c.get("/api/auth/me")).statusCode).toBe(401);

    expect((await secondStep(c, challenge, "000000")).statusCode).toBe(401);
    const ok = await secondStep(c, challenge, codeNow(secret, 1));
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.email).toBe(ADMIN.email);
    expect((await c.get("/api/auth/me")).statusCode).toBe(200);
    // The challenge is used up.
    expect((await secondStep(new Client(app), challenge, codeNow(secret, 1))).statusCode).toBe(401);
  });

  it("does not accept the same code twice", async () => {
    const { secret } = await enable(admin);
    // The code used to turn it on can't sign in.
    const first = await passwordStep();
    expect((await secondStep(first.c, first.challenge, codeNow(secret))).statusCode).toBe(401);
    expect((await secondStep(first.c, first.challenge, codeNow(secret, 1))).statusCode).toBe(200);
    const second = await passwordStep();
    expect((await secondStep(second.c, second.challenge, codeNow(secret, 1))).statusCode).toBe(401);
  });

  it("can't be skipped without the challenge cookie", async () => {
    const { secret } = await enable(admin);
    const res = await secondStep(new Client(app), undefined, codeNow(secret, 1));
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("challenge_expired");
  });

  it("asks for the password again after too many wrong codes", async () => {
    const { secret } = await enable(admin);
    const { c, challenge } = await passwordStep();
    for (let i = 0; i < 4; i++) expect((await secondStep(c, challenge, "000000")).json().error).toBe("bad_code");
    expect((await secondStep(c, challenge, "000000")).json().error).toBe("challenge_expired");
    expect((await secondStep(c, challenge, codeNow(secret, 1))).statusCode).toBe(401);
  });

  it("signs in with a recovery code, once", async () => {
    const { recoveryCodes } = await enable(admin);
    const code = recoveryCodes[0]!;
    const first = await passwordStep();
    // Typed in lower case, without the dash.
    expect((await secondStep(first.c, first.challenge, code.toLowerCase().replace("-", ""))).statusCode).toBe(200);
    expect((await first.c.get("/api/auth/2fa")).json().recoveryCodesLeft).toBe(9);
    const again = await passwordStep();
    expect((await secondStep(again.c, again.challenge, code)).statusCode).toBe(401);
  });

  it("gives new recovery codes that replace the old ones", async () => {
    const { recoveryCodes } = await enable(admin);
    expect((await admin.post("/api/auth/2fa/recovery-codes", { password: "wrong-password" })).statusCode).toBe(400);
    const res = await admin.post("/api/auth/2fa/recovery-codes", { password: ADMIN.password });
    const fresh: string[] = res.json().recoveryCodes;
    expect(fresh).toHaveLength(10);
    const old = await passwordStep();
    expect((await secondStep(old.c, old.challenge, recoveryCodes[0]!)).statusCode).toBe(401);
    const ok = await passwordStep();
    expect((await secondStep(ok.c, ok.challenge, fresh[0]!)).statusCode).toBe(200);
  });

  it("turns off with the password", async () => {
    await enable(admin);
    expect((await admin.post("/api/auth/2fa/disable", { password: "wrong-password" })).statusCode).toBe(400);
    const res = await admin.post("/api/auth/2fa/disable", { password: ADMIN.password });
    expect(res.json().user.twoFactor).toBe(false);
    const c = new Client(app);
    const login = await c.post("/api/auth/login", { email: ADMIN.email, password: ADMIN.password });
    expect(login.json().user.email).toBe(ADMIN.email);
  });

  it("does not store the secret in clear", async () => {
    const { secret } = await enable(admin);
    const row = app.db.$client.prepare("SELECT totp_secret, recovery_codes FROM users").get() as { totp_secret: string; recovery_codes: string };
    expect(row.totp_secret).not.toContain(secret);
    expect(row.totp_secret.startsWith("enc:v1:")).toBe(true);
  });

  it("can be turned off by an administrator for someone else", async () => {
    const member = await inviteUser(app, admin, { name: "Alice", email: "alice@example.com", password: "motdepasse-alice" });
    await enable(member, "motdepasse-alice");
    const id = await member.id();
    expect((await member.request("DELETE", `/api/admin/users/${id}/2fa`)).statusCode).toBe(403);
    const users = (await admin.get("/api/admin/users")).json().users;
    expect(users.find((u: { id: string }) => u.id === id).twoFactor).toBe(true);
    const res = await admin.delete(`/api/admin/users/${id}/2fa`);
    expect(res.json().user.twoFactor).toBe(false);
    const login = await new Client(app).post("/api/auth/login", { email: "alice@example.com", password: "motdepasse-alice" });
    expect(login.json().user).toBeTruthy();
  });
});
