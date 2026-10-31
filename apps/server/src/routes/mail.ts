import type { FastifyPluginAsync } from "fastify";
import { and, eq, gt, isNull } from "drizzle-orm";
import { emailPrefsInput, forgotPasswordInput, mailSettingsInput, resetPasswordInput, t, tIn, type Locale } from "@nootion/shared";
import { z } from "zod";
import { hashPassword } from "../auth/password.js";
import { deleteUserSessions } from "../auth/sessions.js";
import { hashToken, newToken } from "../auth/tokens.js";
import { passwordResets, users } from "../db/schema.js";
import { HttpError, parseBody, requireAdmin, requireUser } from "../http.js";

const RESET_TTL_MS = 60 * 60 * 1000;

/** E-mail settings (administrators) and each user's e-mail preferences. */
export const mailRoutes: FastifyPluginAsync = async (app) => {
  const { db, mailer } = app;

  app.get("/admin/mail", async (req) => {
    requireAdmin(req);
    return { settings: mailer.get() };
  });

  app.put("/admin/mail", async (req) => {
    requireAdmin(req);
    return { settings: mailer.save(parseBody(mailSettingsInput, req.body)) };
  });

  app.delete("/admin/mail", async (req) => {
    requireAdmin(req);
    mailer.remove();
    return { ok: true };
  });

  // Sends a test e-mail (to the administrator, or to the address given) and says whether it went.
  app.post("/admin/mail/test", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const admin = requireAdmin(req);
    const { to } = parseBody(z.object({ to: z.string().trim().email().max(320).optional() }), req.body ?? {});
    const locale = admin.locale as Locale;
    await mailer.send({
      to: to ?? admin.email,
      subject: tIn(locale, "mail.testSubject"),
      text: tIn(locale, "mail.testBody"),
      action: { label: tIn(locale, "mail.openNootion"), url: app.config.appUrl },
    });
    return { ok: true, to: to ?? admin.email };
  });

  app.get("/account/email", async (req) => {
    const user = requireUser(req);
    return { enabled: mailer.enabled(), prefs: mailer.prefs(user.id) };
  });

  app.put("/account/email", async (req) => {
    const user = requireUser(req);
    const input = parseBody(emailPrefsInput, req.body);
    const stored = db.select({ p: users.emailPrefs }).from(users).where(eq(users.id, user.id)).get()?.p ?? {};
    db.update(users)
      .set({ emailPrefs: { ...stored, ...input } })
      .where(eq(users.id, user.id))
      .run();
    return { enabled: mailer.enabled(), prefs: mailer.prefs(user.id) };
  });
};

/** "Forgot password": a link by e-mail, valid for an hour, once. */
export const passwordResetRoutes: FastifyPluginAsync = async (app) => {
  const { db, mailer } = app;

  // Always answers the same way, so that it doesn't tell which addresses have an account.
  app.post("/forgot", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req) => {
    const { email } = parseBody(forgotPasswordInput, req.body);
    if (!mailer.enabled()) throw new HttpError(400, "mail_off", t("mail.notConfigured"));
    const user = db.select().from(users).where(eq(users.email, email.toLowerCase())).get() ?? db.select().from(users).where(eq(users.email, email)).get();
    if (user && !user.disabled) {
      const token = newToken();
      db.insert(passwordResets)
        .values({ tokenHash: hashToken(token), userId: user.id, expiresAt: new Date(Date.now() + RESET_TTL_MS) })
        .run();
      const locale = user.locale as Locale;
      try {
        await mailer.send({
          to: user.email,
          subject: tIn(locale, "mail.resetSubject"),
          text: tIn(locale, "mail.resetBody", { name: user.name }),
          action: { label: tIn(locale, "mail.resetAction"), url: `${app.config.appUrl}/reset/${token}` },
          footer: tIn(locale, "mail.resetFooter"),
        });
      } catch (err) {
        req.log.warn({ err }, "Couldn't send a password reset e-mail");
      }
    }
    return { ok: true };
  });

  const valid = (token: string) =>
    db
      .select()
      .from(passwordResets)
      .where(and(eq(passwordResets.tokenHash, hashToken(token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, new Date())))
      .get();

  app.get<{ Params: { token: string } }>("/reset/:token", async (req) => {
    const r = valid(req.params.token);
    if (!r) throw new HttpError(404, "invalid_link", t("mail.resetInvalid"));
    const user = db.select({ email: users.email }).from(users).where(eq(users.id, r.userId)).get();
    return { email: user?.email ?? "" };
  });

  app.post("/reset", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const input = parseBody(resetPasswordInput, req.body);
    const r = valid(input.token);
    if (!r) throw new HttpError(404, "invalid_link", t("mail.resetInvalid"));
    db.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.userId, r.userId)).run();
    db.update(users)
      .set({ passwordHash: await hashPassword(input.password) })
      .where(eq(users.id, r.userId))
      .run();
    // Signed out everywhere: whoever knew the old password is out.
    deleteUserSessions(db, r.userId);
    return { ok: true };
  });
};
