import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from "fastify";
import QRCode from "qrcode";
import { t, twoFactorCodeInput, twoFactorPasswordInput, type TwoFactorSetup, type TwoFactorStatus } from "@nootion/shared";
import { and, eq, gt, lt } from "drizzle-orm";
import { verifyPassword } from "../auth/password.js";
import { hashToken, newToken } from "../auth/tokens.js";
import { checkTotp, hashRecoveryCode, newRecoveryCodes, newTotpSecret, otpauthUrl } from "../auth/totp.js";
import { loginChallenges, users } from "../db/schema.js";
import { HttpError, parseBody, requireUser } from "../http.js";
import { decryptSecret, encryptSecret, secretKey } from "../secrets.js";
import { toPublicUser, type UserRow } from "../users.js";
import { startSession } from "./session-cookie.js";

export const CHALLENGE_COOKIE = "nootion_2fa";
const CHALLENGE_MS = 10 * 60_000;
const CHALLENGE_ATTEMPTS = 5;

const totpKey = (app: FastifyInstance) => secretKey(app.config.appSecret, "nootion-totp");

/** The password was right: the sign-in waits for the code, behind a short-lived cookie. */
export function startTwoFactorChallenge(app: FastifyInstance, reply: FastifyReply, userId: string): void {
  app.db.delete(loginChallenges).where(lt(loginChallenges.expiresAt, new Date())).run();
  const token = newToken();
  const expiresAt = new Date(Date.now() + CHALLENGE_MS);
  app.db.insert(loginChallenges).values({ tokenHash: hashToken(token), userId, expiresAt }).run();
  reply.setCookie(CHALLENGE_COOKIE, token, {
    path: "/api/auth",
    httpOnly: true,
    sameSite: "strict",
    secure: app.config.appUrl.startsWith("https://"),
    expires: expiresAt,
  });
}

/** Checks an authenticator code or a recovery code, and uses it up. */
function useCode(app: FastifyInstance, user: UserRow, code: string): boolean {
  const secret = user.totpSecret ? decryptSecret(totpKey(app), user.totpSecret) : null;
  if (secret) {
    const step = checkTotp(secret, code, user.totpLastStep);
    if (step !== null) {
      app.db.update(users).set({ totpLastStep: step }).where(eq(users.id, user.id)).run();
      return true;
    }
  }
  const hash = hashRecoveryCode(code);
  if (user.recoveryCodes.includes(hash)) {
    app.db
      .update(users)
      .set({ recoveryCodes: user.recoveryCodes.filter((h) => h !== hash) })
      .where(eq(users.id, user.id))
      .run();
    return true;
  }
  return false;
}

const status = (u: UserRow): TwoFactorStatus => ({ enabled: !!u.totpSecret, recoveryCodesLeft: u.totpSecret ? u.recoveryCodes.length : 0 });

function newCodes() {
  const codes = newRecoveryCodes();
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

export const twoFactorRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  async function checkPassword(user: UserRow, password: string) {
    if (!(await verifyPassword(user.passwordHash, password))) throw new HttpError(400, "bad_password", t("error.badCurrentPassword"));
  }

  // Second step of signing in.
  app.post("/login/2fa", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const input = parseBody(twoFactorCodeInput, req.body);
    const token = req.cookies[CHALLENGE_COOKIE];
    const challenge = token
      ? db
          .select()
          .from(loginChallenges)
          .where(and(eq(loginChallenges.tokenHash, hashToken(token)), gt(loginChallenges.expiresAt, new Date())))
          .get()
      : undefined;
    if (!challenge) throw new HttpError(401, "challenge_expired", t("twoFactor.expired"));
    const user = db.select().from(users).where(eq(users.id, challenge.userId)).get();
    if (!user || user.disabled) {
      db.delete(loginChallenges).where(eq(loginChallenges.tokenHash, challenge.tokenHash)).run();
      throw new HttpError(403, "disabled", t("error.accountDisabled"));
    }
    // Turned off meanwhile (by an administrator): the password was enough.
    if (user.totpSecret && !useCode(app, user, input.code)) {
      const attempts = challenge.attempts + 1;
      if (attempts >= CHALLENGE_ATTEMPTS) {
        db.delete(loginChallenges).where(eq(loginChallenges.tokenHash, challenge.tokenHash)).run();
        reply.clearCookie(CHALLENGE_COOKIE, { path: "/api/auth" });
        throw new HttpError(401, "challenge_expired", t("twoFactor.tooManyAttempts"));
      }
      db.update(loginChallenges).set({ attempts }).where(eq(loginChallenges.tokenHash, challenge.tokenHash)).run();
      throw new HttpError(401, "bad_code", t("twoFactor.badCode"));
    }
    db.delete(loginChallenges).where(eq(loginChallenges.tokenHash, challenge.tokenHash)).run();
    reply.clearCookie(CHALLENGE_COOKIE, { path: "/api/auth" });
    startSession(app, reply, user.id);
    return { user: toPublicUser(user) };
  });

  app.get("/2fa", async (req) => status(requireUser(req)));

  // A new secret to scan; it only counts once a code from the app confirms it.
  app.post("/2fa/setup", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req): Promise<TwoFactorSetup> => {
    const user = requireUser(req);
    const input = parseBody(twoFactorPasswordInput, req.body);
    await checkPassword(user, input.password);
    if (user.totpSecret) throw new HttpError(409, "already_enabled", t("twoFactor.alreadyOn"));
    const secret = newTotpSecret();
    db.update(users)
      .set({ totpPending: encryptSecret(totpKey(app), secret) })
      .where(eq(users.id, user.id))
      .run();
    const url = otpauthUrl(secret, user.email, "Nootion");
    return { secret, otpauthUrl: url, qrSvg: await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) };
  });

  app.post("/2fa/enable", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const user = requireUser(req);
    const input = parseBody(twoFactorCodeInput, req.body);
    if (user.totpSecret) throw new HttpError(409, "already_enabled", t("twoFactor.alreadyOn"));
    const secret = user.totpPending ? decryptSecret(totpKey(app), user.totpPending) : null;
    if (!secret) throw new HttpError(409, "no_setup", t("twoFactor.noSetup"));
    const step = checkTotp(secret, input.code, null);
    if (step === null) throw new HttpError(400, "bad_code", t("twoFactor.badCode"));
    const { codes, hashes } = newCodes();
    const updated = db
      .update(users)
      .set({ totpSecret: user.totpPending, totpPending: null, totpLastStep: step, recoveryCodes: hashes })
      .where(eq(users.id, user.id))
      .returning()
      .get();
    return { user: toPublicUser(updated), recoveryCodes: codes };
  });

  app.post("/2fa/disable", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const user = requireUser(req);
    const input = parseBody(twoFactorPasswordInput, req.body);
    await checkPassword(user, input.password);
    return { user: toPublicUser(clearTwoFactor(app, user.id)) };
  });

  // New recovery codes; the old ones stop working.
  app.post("/2fa/recovery-codes", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const user = requireUser(req);
    const input = parseBody(twoFactorPasswordInput, req.body);
    await checkPassword(user, input.password);
    if (!user.totpSecret) throw new HttpError(409, "not_enabled", t("twoFactor.notOn"));
    const { codes, hashes } = newCodes();
    db.update(users).set({ recoveryCodes: hashes }).where(eq(users.id, user.id)).run();
    return { recoveryCodes: codes };
  });
};

/** Turns two-factor sign-in off: by the user, or by an administrator for someone who lost their phone and codes. */
export function clearTwoFactor(app: FastifyInstance, userId: string): UserRow {
  app.db.delete(loginChallenges).where(eq(loginChallenges.userId, userId)).run();
  return app.db
    .update(users)
    .set({ totpSecret: null, totpPending: null, totpLastStep: null, recoveryCodes: [] })
    .where(eq(users.id, userId))
    .returning()
    .get();
}
