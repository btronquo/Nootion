import { eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import {
  EMAIL_KINDS,
  mailSettingsInput,
  t,
  tIn,
  type EmailKind,
  type EmailPrefs,
  type Locale,
  type MailSettings,
  type MailSettingsInput,
} from "@nootion/shared";
import type { Db } from "./db/index.js";
import { mailSettings, users } from "./db/schema.js";
import { HttpError } from "./http.js";
import { decryptSecret, encryptSecret, secretKey } from "./secrets.js";

const ROW = "default";

export interface Mail {
  to: string;
  subject: string;
  /** Plain-text body; the HTML version is made from it. */
  text: string;
  /** A button under the text. */
  action?: { label: string; url: string };
  /** Small print under the button (why this e-mail, how to stop it). */
  footer?: string;
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A plain, readable e-mail that looks fine in every client (tables and inline styles only). */
export function renderMail(mail: Mail, appUrl: string): { html: string; text: string } {
  const paragraphs = mail.text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;line-height:1.55">${escape(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const button = mail.action
    ? `<p style="margin:22px 0"><a href="${escape(mail.action.url)}" style="display:inline-block;background:#2383e2;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">${escape(mail.action.label)}</a></p>`
    : "";
  const footer = mail.footer ? `<p style="margin:24px 0 0;color:#8a8a8a;font-size:12px;line-height:1.5">${escape(mail.footer)}</p>` : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f6f6f5;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#262626;font-size:15px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #e5e5e5;border-radius:10px">
<tr><td style="padding:28px 28px 8px"><a href="${escape(appUrl)}" style="color:#262626;text-decoration:none;font-weight:700;font-size:16px">Nootion</a></td></tr>
<tr><td style="padding:8px 28px 28px">${paragraphs}${button}${footer}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [mail.text, mail.action ? `${mail.action.label}: ${mail.action.url}` : "", mail.footer ?? ""].filter(Boolean).join("\n\n");
  return { html, text };
}

/** Sends e-mail through what administrators set (SMTP or Resend); does nothing until they do. */
/** Replaces the real sending, in tests. */
export type MailSender = (message: { from: string; to: string; subject: string; text: string; html: string }) => Promise<void>;

export function createMailer(opts: { db: Db; appSecret: string; appUrl: string; log: { warn: (o: unknown, msg: string) => void }; sender?: MailSender }) {
  const { db } = opts;
  const key = secretKey(opts.appSecret, "nootion-mail");
  const row = () => db.select().from(mailSettings).where(eq(mailSettings.id, ROW)).get();

  function get(): MailSettings | null {
    const r = row();
    if (!r) return null;
    const c = mailSettingsInput.parse(r.config);
    return {
      provider: c.provider,
      from: c.from,
      smtp: c.smtp ? { host: c.smtp.host, port: c.smtp.port, security: c.smtp.security, user: c.smtp.user } : null,
      hasSecret: !!r.secret,
    };
  }

  /** Saves the settings; a password or key left out keeps the saved one (unless the provider changed). */
  function save(input: MailSettingsInput): MailSettings {
    if (input.provider === "smtp" && !input.smtp) throw new HttpError(400, "invalid_input", t("mail.smtpRequired"));
    const old = row();
    const oldProvider = old ? mailSettingsInput.parse(old.config).provider : null;
    const given = input.provider === "smtp" ? input.smtp?.password : input.resendKey;
    let secret = given ? encryptSecret(key, given) : oldProvider === input.provider ? (old?.secret ?? null) : null;
    if (input.provider === "resend" && !secret) throw new HttpError(400, "invalid_input", t("mail.keyRequired"));
    if (input.provider === "smtp" && !input.smtp?.user) secret = null;
    const config = { provider: input.provider, from: input.from, ...(input.provider === "smtp" ? { smtp: { ...input.smtp!, password: undefined } } : {}) };
    const values = { config, secret, updatedAt: new Date() };
    db.insert(mailSettings)
      .values({ id: ROW, ...values })
      .onConflictDoUpdate({ target: mailSettings.id, set: values })
      .run();
    return get()!;
  }

  function remove() {
    db.delete(mailSettings).where(eq(mailSettings.id, ROW)).run();
  }

  const enabled = () => !!row();

  /** Sends one e-mail; throws when the provider refuses it. */
  async function send(mail: Mail): Promise<void> {
    const r = row();
    if (!r) throw new HttpError(400, "mail_off", t("mail.notConfigured"));
    const c = mailSettingsInput.parse(r.config);
    const secret = r.secret ? decryptSecret(key, r.secret) : null;
    const { html, text } = renderMail(mail, opts.appUrl);
    if (opts.sender) return opts.sender({ from: c.from, to: mail.to, subject: mail.subject, text, html });
    if (c.provider === "resend") {
      if (!secret) throw new HttpError(400, "mail_secret", t("mail.secretUnreadable"));
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: JSON.stringify({ from: c.from, to: [mail.to], subject: mail.subject, html, text }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new HttpError(502, "mail_failed", t("mail.failed", { reason: body?.message ?? `HTTP ${res.status}` }));
      }
      return;
    }
    const s = c.smtp!;
    if (s.user && !secret) throw new HttpError(400, "mail_secret", t("mail.secretUnreadable"));
    const transport = nodemailer.createTransport({
      host: s.host,
      port: s.port,
      secure: s.security === "tls",
      requireTLS: s.security === "starttls",
      ignoreTLS: s.security === "none",
      auth: s.user ? { user: s.user, pass: secret! } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 20_000,
    });
    try {
      await transport.sendMail({ from: c.from, to: mail.to, subject: mail.subject, text, html });
    } catch (err) {
      throw new HttpError(502, "mail_failed", t("mail.failed", { reason: (err as Error).message }));
    } finally {
      transport.close();
    }
  }

  /** A user's e-mail preferences, every kind on unless turned off. */
  function prefs(userId: string): EmailPrefs {
    const stored = db.select({ p: users.emailPrefs }).from(users).where(eq(users.id, userId)).get()?.p ?? {};
    return Object.fromEntries(EMAIL_KINDS.map((k) => [k, stored[k] !== false])) as EmailPrefs;
  }

  // Notifications are e-mailed in the background; idle() waits for them (tests, shutdown).
  const pending = new Set<Promise<void>>();
  function notifyLater(userId: string, kind: EmailKind, n: { title: string; body: string; url: string }) {
    const p = notify(userId, kind, n).finally(() => pending.delete(p));
    pending.add(p);
  }
  const idle = () => Promise.all([...pending]).then(() => undefined);

  /** E-mails a notification (reminder, mention, reply) unless the user turned that kind off. Never throws. */
  async function notify(userId: string, kind: EmailKind, n: { title: string; body: string; url: string }) {
    if (!enabled()) return;
    const u = db.select({ email: users.email, locale: users.locale, disabled: users.disabled }).from(users).where(eq(users.id, userId)).get();
    if (!u || u.disabled || !prefs(userId)[kind]) return;
    const locale = u.locale as Locale;
    try {
      await send({
        to: u.email,
        subject: n.title,
        text: n.body ? `${n.title}\n\n${n.body}` : n.title,
        action: { label: tIn(locale, "mail.open"), url: new URL(n.url, opts.appUrl).toString() },
        footer: tIn(locale, "mail.footer", { url: `${opts.appUrl}/account#email` }),
      });
    } catch (err) {
      opts.log.warn({ err }, "Couldn't send an e-mail");
    }
  }

  return { get, save, remove, enabled, send, prefs, notify, notifyLater, idle };
}

export type Mailer = ReturnType<typeof createMailer>;
