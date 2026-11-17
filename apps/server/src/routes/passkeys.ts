import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from "fastify";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { passkeyAddInput, passkeyLoginInput, passkeyOptionsInput, passkeyRenameInput, t, type PasskeyInfo, type PasskeysStatus } from "@nootion/shared";
import { and, asc, count, eq, lt } from "drizzle-orm";
import { audit } from "../audit.js";
import { verifyPassword } from "../auth/password.js";
import { hashToken, newToken } from "../auth/tokens.js";
import { passkeyChallenges, passkeys, users } from "../db/schema.js";
import { HttpError, parseBody, requireUser } from "../http.js";
import { guestsAllowed, guestsOff, isGuest } from "../guests.js";
import { toPublicUser } from "../users.js";
import { passwordAllowed, ssoOnlyMessage } from "./sso.js";
import { startSession } from "./session-cookie.js";

/** The cookie that ties a passkey sign-in to the browser that asked for the challenge. */
export const PASSKEY_COOKIE = "nootion_passkey";
const CHALLENGE_MS = 5 * 60_000;
/** Enough for a person's devices and security keys; stops a stolen session from filling the table. */
const PASSKEYS_MAX = 25;

/**
 * Where passkeys are tied to: the browser only hands them to the site they were made on (the relying party id is the
 * host name of APP_URL), and only over HTTPS, localhost aside.
 */
export function passkeySite(appUrl: string) {
  const url = new URL(appUrl);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname.endsWith(".localhost");
  return { rpID: url.hostname, origin: url.origin, available: url.protocol === "https:" || local };
}

const info = (p: typeof passkeys.$inferSelect): PasskeyInfo => ({
  id: p.id,
  name: p.name,
  backedUp: p.backedUp,
  lastUsedAt: p.lastUsedAt ? p.lastUsedAt.toISOString() : null,
  createdAt: p.createdAt.toISOString(),
});

function newChallenge(app: FastifyInstance, purpose: "register" | "login", challenge: string, userId: string | null): string {
  app.db.delete(passkeyChallenges).where(lt(passkeyChallenges.expiresAt, new Date())).run();
  // One pending "add a passkey" per person: asking again replaces it.
  if (userId)
    app.db
      .delete(passkeyChallenges)
      .where(and(eq(passkeyChallenges.userId, userId), eq(passkeyChallenges.purpose, purpose)))
      .run();
  const token = newToken();
  app.db
    .insert(passkeyChallenges)
    .values({ tokenHash: hashToken(token), userId, purpose, challenge, expiresAt: new Date(Date.now() + CHALLENGE_MS) })
    .run();
  return token;
}

/** Takes a challenge out of the table: each one is answered once, right or wrong. */
function takeChallenge(app: FastifyInstance, where: ReturnType<typeof eq>, purpose: "register" | "login") {
  const row = app.db
    .select()
    .from(passkeyChallenges)
    .where(and(where, eq(passkeyChallenges.purpose, purpose)))
    .get();
  if (row) app.db.delete(passkeyChallenges).where(eq(passkeyChallenges.tokenHash, row.tokenHash)).run();
  return row && row.expiresAt > new Date() ? row : undefined;
}

function unavailable(): HttpError {
  return new HttpError(409, "passkeys_unavailable", t("passkeys.unavailable"));
}

export const passkeyRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;
  const site = () => passkeySite(app.config.appUrl);
  const limit = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  app.get("/passkeys", async (req): Promise<PasskeysStatus> => {
    const user = requireUser(req);
    const { available, origin } = site();
    const list = db.select().from(passkeys).where(eq(passkeys.userId, user.id)).orderBy(asc(passkeys.createdAt)).all();
    return { available, origin, passkeys: list.map(info) };
  });

  // Adding a passkey, step 1: what the browser hands to the device (navigator.credentials.create).
  app.post("/passkeys/options", limit, async (req) => {
    const user = requireUser(req);
    const input = parseBody(passkeyOptionsInput, req.body);
    if (!(await verifyPassword(user.passwordHash, input.password))) throw new HttpError(400, "bad_password", t("error.badCurrentPassword"));
    const { rpID, available } = site();
    if (!available) throw unavailable();
    const mine = db.select({ id: passkeys.credentialId, transports: passkeys.transports }).from(passkeys).where(eq(passkeys.userId, user.id)).all();
    if (mine.length >= PASSKEYS_MAX) throw new HttpError(409, "too_many_passkeys", t("passkeys.tooMany", { count: PASSKEYS_MAX }));
    const options = await generateRegistrationOptions({
      rpName: "Nootion",
      rpID,
      userID: new TextEncoder().encode(user.id),
      userName: user.email,
      userDisplayName: user.name,
      attestationType: "none",
      // The same device twice would only make a duplicate.
      excludeCredentials: mine.map((p) => ({ id: p.id, transports: p.transports })),
      // A passkey the device finds by itself (no e-mail to type), unlocked with a fingerprint, face or PIN: it counts as two steps.
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      timeout: CHALLENGE_MS,
    });
    newChallenge(app, "register", options.challenge, user.id);
    return { options };
  });

  // Adding a passkey, step 2: the device's answer, checked and kept.
  app.post("/passkeys", limit, async (req) => {
    const user = requireUser(req);
    const input = parseBody(passkeyAddInput, req.body);
    const challenge = takeChallenge(app, eq(passkeyChallenges.userId, user.id), "register");
    if (!challenge) throw new HttpError(409, "challenge_expired", t("passkeys.expired"));
    const { rpID, origin } = site();
    let verified;
    try {
      verified = await verifyRegistrationResponse({
        response: input.response as unknown as RegistrationResponseJSON,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
    } catch (err) {
      req.log.info({ err }, "passkey registration refused");
      throw new HttpError(400, "passkey_failed", t("passkeys.failed"));
    }
    if (!verified.verified) throw new HttpError(400, "passkey_failed", t("passkeys.failed"));
    const { credential, credentialBackedUp } = verified.registrationInfo;
    if (db.select({ id: passkeys.id }).from(passkeys).where(eq(passkeys.credentialId, credential.id)).get()) {
      throw new HttpError(409, "passkey_exists", t("passkeys.exists"));
    }
    const n = (db.select({ n: count() }).from(passkeys).where(eq(passkeys.userId, user.id)).get()?.n ?? 0) + 1;
    const row = db
      .insert(passkeys)
      .values({
        id: randomUUID(),
        userId: user.id,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports ?? [],
        backedUp: credentialBackedUp,
        name: input.name || t("passkeys.defaultName", { n }),
      })
      .returning()
      .get();
    audit(db, req, { action: "account.passkey_added", details: { name: row.name, synced: credentialBackedUp } });
    return { passkey: info(row) };
  });

  app.patch<{ Params: { id: string } }>("/passkeys/:id", async (req) => {
    const user = requireUser(req);
    const input = parseBody(passkeyRenameInput, req.body);
    const row = db
      .update(passkeys)
      .set({ name: input.name })
      .where(and(eq(passkeys.id, req.params.id), eq(passkeys.userId, user.id)))
      .returning()
      .get();
    if (!row) throw new HttpError(404, "not_found", t("passkeys.notFound"));
    return { passkey: info(row) };
  });

  app.delete<{ Params: { id: string } }>("/passkeys/:id", async (req) => {
    const user = requireUser(req);
    const row = db
      .delete(passkeys)
      .where(and(eq(passkeys.id, req.params.id), eq(passkeys.userId, user.id)))
      .returning({ id: passkeys.id, name: passkeys.name })
      .get();
    if (!row) throw new HttpError(404, "not_found", t("passkeys.notFound"));
    audit(db, req, { action: "account.passkey_removed", details: { name: row.name } });
    return { ok: true };
  });

  // Signing in, step 1: a challenge for any passkey of this site (the device lists them; no e-mail is typed).
  app.post("/login/passkey/options", limit, async (_req, reply) => {
    const { rpID, available } = site();
    if (!available) throw unavailable();
    const options = await generateAuthenticationOptions({ rpID, userVerification: "required", timeout: CHALLENGE_MS });
    setChallengeCookie(app, reply, newChallenge(app, "login", options.challenge, null));
    return { options };
  });

  // Signing in, step 2: the signed challenge. The passkey is both steps: no password, no authenticator code.
  app.post("/login/passkey", limit, async (req, reply) => {
    const input = parseBody(passkeyLoginInput, req.body);
    const token = req.cookies[PASSKEY_COOKIE];
    const challenge = token ? takeChallenge(app, eq(passkeyChallenges.tokenHash, hashToken(token)), "login") : undefined;
    reply.clearCookie(PASSKEY_COOKIE, { path: "/api/auth" });
    if (!challenge) throw new HttpError(401, "challenge_expired", t("passkeys.expired"));
    const response = input.response as unknown as AuthenticationResponseJSON;
    const passkey = typeof response.id === "string" ? db.select().from(passkeys).where(eq(passkeys.credentialId, response.id)).get() : undefined;
    if (!passkey) throw new HttpError(401, "passkey_unknown", t("passkeys.unknown"));
    const { rpID, origin } = site();
    let verified;
    try {
      verified = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: { id: passkey.credentialId, publicKey: new Uint8Array(passkey.publicKey), counter: passkey.counter, transports: passkey.transports },
        requireUserVerification: true,
      });
    } catch (err) {
      req.log.info({ err }, "passkey sign-in refused");
      throw new HttpError(401, "passkey_failed", t("passkeys.failed"));
    }
    if (!verified.verified) throw new HttpError(401, "passkey_failed", t("passkeys.failed"));
    const user = db.select().from(users).where(eq(users.id, passkey.userId)).get();
    if (!user) throw new HttpError(403, "disabled", t("error.accountDisabled"));
    // Signed in or refused, it goes to the activity log as a password sign-in does.
    const refused = (reason: string) => audit(db, req, { action: "auth.login_failed", actor: user, details: { email: user.email, method: "passkey", reason } });
    if (user.disabled) {
      refused("disabled");
      throw new HttpError(403, "disabled", t("error.accountDisabled"));
    }
    // Where the company's SSO is required, a passkey doesn't go around it any more than a password does.
    if (!passwordAllowed(app, user.role)) {
      refused("sso_only");
      throw new HttpError(403, "sso_only", ssoOnlyMessage());
    }
    if (isGuest(user) && !guestsAllowed(db)) {
      refused("guests_off");
      throw guestsOff();
    }
    db.update(passkeys)
      .set({ counter: verified.authenticationInfo.newCounter, backedUp: verified.authenticationInfo.credentialBackedUp, lastUsedAt: new Date() })
      .where(eq(passkeys.id, passkey.id))
      .run();
    startSession(app, reply, user.id);
    audit(db, req, { action: "auth.login", actor: user, details: { method: "passkey" } });
    return { user: toPublicUser(user) };
  });
};

function setChallengeCookie(app: FastifyInstance, reply: FastifyReply, token: string) {
  reply.setCookie(PASSKEY_COOKIE, token, {
    path: "/api/auth",
    httpOnly: true,
    sameSite: "strict",
    secure: app.config.appUrl.startsWith("https://"),
    expires: new Date(Date.now() + CHALLENGE_MS),
  });
}
