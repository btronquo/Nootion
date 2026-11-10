import { randomBytes } from "node:crypto";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { ssoSettingsInput, t } from "@nootion/shared";
import { hashToken } from "../auth/tokens.js";
import { invitations, users } from "../db/schema.js";
import { parseBody, requireAdmin } from "../http.js";
import { requestLocale } from "../i18n.js";
import type { SsoIdentity } from "../sso.js";
import { createUser, type UserRow } from "../users.js";
import { startSession } from "./session-cookie.js";

const STATE_COOKIE = "nootion_sso";
const STATE_PATH = "/api/auth/sso";

/** SSO settings, for administrators. */
export const ssoAdminRoutes: FastifyPluginAsync = async (app) => {
  const { sso } = app;

  app.get("/", async (req) => {
    requireAdmin(req);
    return { settings: sso.get() };
  });

  app.put("/", async (req) => {
    requireAdmin(req);
    return { settings: sso.save(parseBody(ssoSettingsInput, req.body)) };
  });

  app.delete("/", async (req) => {
    requireAdmin(req);
    sso.remove();
    return { ok: true };
  });

  // A new SCIM token replaces the old one; it is shown only now.
  app.post("/scim-token", async (req) => {
    requireAdmin(req);
    return { token: sso.newScimToken() };
  });

  app.delete("/scim-token", async (req) => {
    requireAdmin(req);
    sso.removeScimToken();
    return { ok: true };
  });
};

/** Signing in through the provider: off to it, and back. */
export const ssoLoginRoutes: FastifyPluginAsync = async (app) => {
  const { db, sso } = app;
  const secure = app.config.appUrl.startsWith("https://");
  const back = (reply: FastifyReply, error: string) =>
    reply.redirect(`/login?sso_error=${error}`);

  app.get<{ Querystring: { next?: string; invite?: string } }>(
    "/start",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { url, state, nonce, verifier } = await sso.begin();
      const next = safeNext(req.query.next);
      const invite =
        typeof req.query.invite === "string"
          ? req.query.invite.slice(0, 200)
          : undefined;
      reply.setCookie(
        STATE_COOKIE,
        JSON.stringify({ state, nonce, verifier, next, invite }),
        {
          path: STATE_PATH,
          httpOnly: true,
          sameSite: "lax",
          secure,
          signed: true,
          maxAge: 10 * 60,
        },
      );
      return reply.redirect(url);
    },
  );

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/callback",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const raw = req.cookies[STATE_COOKIE];
      reply.clearCookie(STATE_COOKIE, { path: STATE_PATH });
      const unsigned = raw ? req.unsignCookie(raw) : null;
      let saved: {
        state: string;
        nonce: string;
        verifier: string;
        next: string;
        invite?: string;
      } | null = null;
      try {
        saved =
          unsigned?.valid && unsigned.value ? JSON.parse(unsigned.value) : null;
      } catch {
        saved = null;
      }
      if (req.query.error) return back(reply, "denied");
      if (!saved || !req.query.code || req.query.state !== saved.state)
        return back(reply, "expired");
      let who: SsoIdentity;
      try {
        who = await sso.finish(req.query.code, saved.nonce, saved.verifier);
      } catch (err) {
        req.log.warn({ err }, "SSO sign-in failed");
        return back(reply, "failed");
      }
      const found = await account(who, saved.invite, requestLocale(req));
      if (typeof found === "string") return back(reply, found);
      startSession(app, reply, found.id, sso.config()!.sessionHours * 3600_000);
      return reply.redirect(saved.next);
    },
  );

  /** The account for whoever signed in: already linked, found by address, invited, or made. */
  async function account(
    who: SsoIdentity,
    inviteToken: string | undefined,
    locale: ReturnType<typeof requestLocale>,
  ): Promise<UserRow | "no_account" | "disabled" | "no_email" | "unverified_email" | "not_linked"> {
    const c = sso.config()!;
    let user = db
      .select()
      .from(users)
      .where(eq(users.ssoSubject, who.subject))
      .get();
    // An address the provider never checked proves nothing: it neither finds an account nor makes one.
    if (!user && who.email && !who.emailVerified) return "unverified_email";
    if (!user && who.email && c.linkByEmail) {
      user = db
        .select()
        .from(users)
        .where(
          and(
            sql`lower(${users.email}) = ${who.email}`,
            isNull(users.ssoSubject),
          ),
        )
        .get();
      if (user)
        db.update(users)
          .set({ ssoSubject: who.subject })
          .where(eq(users.id, user.id))
          .run();
    }
    if (user) return user.disabled ? "disabled" : user;
    if (!who.email) return "no_email";
    if (
      db
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.email}) = ${who.email}`)
        .get()
    )
      return c.linkByEmail ? "no_account" : "not_linked";

    // An invitation: the link followed, or one sent to this address.
    const now = new Date();
    const open = and(
      isNull(invitations.usedAt),
      gt(invitations.expiresAt, now),
    );
    const inv =
      (inviteToken &&
        db
          .select()
          .from(invitations)
          .where(and(eq(invitations.tokenHash, hashToken(inviteToken)), open))
          .get()) ||
      db
        .select()
        .from(invitations)
        .where(and(sql`lower(${invitations.email}) = ${who.email}`, open))
        .get();
    const usable =
      inv && (!inv.email || inv.email.toLowerCase() === who.email)
        ? inv
        : undefined;
    const domain = who.email.split("@")[1]!;
    const allowed =
      !!usable ||
      c.signup === "anyone" ||
      (c.signup === "domains" && c.domains.includes(domain));
    if (!allowed) return "no_account";
    if (usable) {
      const claimed = db
        .update(invitations)
        .set({ usedAt: now })
        .where(and(eq(invitations.id, usable.id), isNull(invitations.usedAt)))
        .run();
      if (claimed.changes === 0) return "no_account";
    }
    // No password anyone knows: this account signs in through the provider.
    const created = await createUser(db, {
      name: who.name ?? who.email.split("@")[0]!,
      email: who.email,
      password: randomBytes(32).toString("hex"),
      role: usable?.role ?? "member",
      locale,
    });
    db.update(users)
      .set({ ssoSubject: who.subject })
      .where(eq(users.id, created.id))
      .run();
    if (usable)
      db.update(invitations)
        .set({ usedBy: created.id })
        .where(eq(invitations.id, usable.id))
        .run();
    return { ...created, ssoSubject: who.subject };
  }
};

/** With SSO on and passwords off, only administrators still sign in with one. */
export function passwordAllowed(
  app: { sso: { config(): { passwordLogin: boolean } | null } },
  role: string,
): boolean {
  const c = app.sso.config();
  return !c || c.passwordLogin || role === "admin";
}

export const ssoOnlyMessage = () => t("sso.passwordOff");

/** Where to go after signing in: a path of this site, never another one ("//host" and "/\\host" lead elsewhere). */
export function safeNext(next: unknown): string {
  if (typeof next !== "string" || !/^\/(?![/\\])/.test(next) || /[\\\r\n\t]/.test(next)) return "/";
  try {
    const url = new URL(next, "http://nootion.invalid");
    return url.origin === "http://nootion.invalid" ? url.pathname + url.search + url.hash : "/";
  } catch {
    return "/";
  }
}
