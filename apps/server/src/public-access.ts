import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { t, type PublicLinkLock, type PublicLinkProtectionInput } from "@nootion/shared";
import { hashPassword } from "./auth/password.js";
import { HttpError } from "./http.js";
import { secretKey } from "./secrets.js";

/**
 * Password and end date of public links and public forms.
 *
 * A visitor who types the right password gets a cookie bound to that link: it names the link's token and a signature
 * over the token, the stored password hash and the cookie's end. It is only sent to that link's addresses (its path),
 * so the page, its subpages, its files and its databases all ask for it alike. Setting a new password changes the
 * hash, which invalidates every cookie given before.
 */

/** How long a typed password is remembered, unless the link ends sooner. */
export const UNLOCK_TTL_MS = 12 * 60 * 60 * 1000;
export const UNLOCK_COOKIE = "nootion_unlock";

/** Password attempts allowed per link and per minute, whoever makes them. */
export const UNLOCK_ATTEMPTS_PER_MINUTE = 10;

export type PublicKind = "page" | "form";

interface Protected {
  token: string;
  passwordHash: string | null;
  expiresAt: Date | null;
}

/** The addresses a link's cookie is sent to: everything the visitor's browser asks for that link. */
const cookiePath = (kind: PublicKind, token: string) => (kind === "page" ? `/api/public/${token}` : `/api/forms/${token}`);

function sign(app: FastifyInstance, kind: PublicKind, link: Protected, until: number): string {
  return createHmac("sha256", secretKey(app.config.appSecret, "public-link-unlock"))
    .update(`${kind}\n${link.token}\n${link.passwordHash ?? ""}\n${until}`)
    .digest("base64url");
}

export const isExpired = (link: { expiresAt: Date | null }, now = Date.now()) => !!link.expiresAt && link.expiresAt.getTime() <= now;

/** Why a visitor can't open the link yet, or null when they can. */
export function lockOf(app: FastifyInstance, req: FastifyRequest, kind: PublicKind, link: Protected): PublicLinkLock | null {
  if (isExpired(link)) return "link_expired";
  if (!link.passwordHash) return null;
  const raw = req.cookies[UNLOCK_COOKIE];
  const [until, signature] = raw?.split(".") ?? [];
  if (!until || !signature || !/^\d+$/.test(until) || Number(until) <= Date.now()) return "password_required";
  const expected = Buffer.from(sign(app, kind, link, Number(until)));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given) ? null : "password_required";
}

/**
 * Refuses a request the link doesn't allow yet: 410 once it has expired, 401 while the password hasn't been typed.
 * Answers of a protected link are not kept by browsers or their offline copy.
 */
export function requireOpen(app: FastifyInstance, req: FastifyRequest, reply: FastifyReply, kind: PublicKind, link: Protected): void {
  const lock = lockOf(app, req, kind, link);
  if (link.passwordHash || link.expiresAt) reply.header("cache-control", "no-store");
  if (lock === "link_expired") throw new HttpError(410, lock, t("public.expired"));
  if (lock === "password_required") throw new HttpError(401, lock, t("public.passwordRequired"));
}

/** Remembers, for this browser, that the password of this link was typed. */
export function setUnlockCookie(app: FastifyInstance, reply: FastifyReply, kind: PublicKind, link: Protected): void {
  const until = Math.min(Date.now() + UNLOCK_TTL_MS, link.expiresAt?.getTime() ?? Infinity);
  reply.setCookie(UNLOCK_COOKIE, `${until}.${sign(app, kind, link, until)}`, {
    path: cookiePath(kind, link.token),
    httpOnly: true,
    sameSite: "lax",
    secure: app.config.appUrl.startsWith("https://"),
    expires: new Date(until),
  });
}

/** Counts password attempts per link over a sliding minute; false once the limit is reached. */
export function unlockLimiter(perMinute = UNLOCK_ATTEMPTS_PER_MINUTE) {
  const hits = new Map<string, number[]>();
  return (key: string, now = Date.now()) => {
    const recent = (hits.get(key) ?? []).filter((at) => now - at < 60_000);
    const allowed = recent.length < perMinute;
    if (allowed) recent.push(now);
    hits.set(key, recent);
    if (hits.size > 1000) for (const [k, times] of hits) if (!times.length || now - times[times.length - 1]! >= 60_000) hits.delete(k);
    return allowed;
  };
}

export const tooManyAttempts = () => new HttpError(429, "too_many_attempts", t("public.tooManyAttempts"));

/** The columns to write for a change of protection; fields left out of the input are left as they are. */
export async function protectionUpdate(input: PublicLinkProtectionInput): Promise<{ passwordHash?: string | null; expiresAt?: Date | null }> {
  const out: { passwordHash?: string | null; expiresAt?: Date | null } = {};
  if (input.password !== undefined) out.passwordHash = input.password === null ? null : await hashPassword(input.password);
  if (input.expiresAt !== undefined) out.expiresAt = input.expiresAt === null ? null : new Date(input.expiresAt);
  return out;
}

/** What the owner sees of a link's protection. */
export const protectionInfo = (link: { passwordHash: string | null; expiresAt: Date | null }) => ({
  hasPassword: !!link.passwordHash,
  expiresAt: link.expiresAt?.toISOString() ?? null,
  expired: isExpired(link),
});
