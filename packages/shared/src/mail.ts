import { z } from "zod";
import { passwordSchema } from "./auth.js";

/** How the server sends e-mail, set by administrators. */
export const MAIL_PROVIDERS = ["smtp", "resend"] as const;
export type MailProvider = (typeof MAIL_PROVIDERS)[number];

export const mailSettingsInput = z.object({
  provider: z.enum(MAIL_PROVIDERS),
  /** The sender, e.g. "Nootion <nootion@example.com>". */
  from: z.string().trim().min(3).max(200),
  smtp: z
    .object({
      host: z.string().trim().min(1).max(200),
      port: z.number().int().min(1).max(65535).default(587),
      /** "tls": encrypted from the start (port 465). "starttls": upgraded (587). "none": plain (tests, local relays). */
      security: z.enum(["tls", "starttls", "none"]).default("starttls"),
      user: z.string().max(200).default(""),
      /** Left out: the saved one is kept. */
      password: z.string().max(500).optional(),
    })
    .optional(),
  /** Resend's API key; left out: the saved one is kept. */
  resendKey: z.string().max(500).optional(),
});
export type MailSettingsInput = z.infer<typeof mailSettingsInput>;

/** The settings as shown to administrators: secrets are never sent back. */
export interface MailSettings {
  provider: MailProvider;
  from: string;
  smtp: { host: string; port: number; security: "tls" | "starttls" | "none"; user: string } | null;
  hasSecret: boolean;
}

/** Kinds of e-mail each user can turn off. */
export const EMAIL_KINDS = ["reminders", "mentions", "replies"] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];
export type EmailPrefs = Record<EmailKind, boolean>;
export const emailPrefsInput = z.object(Object.fromEntries(EMAIL_KINDS.map((k) => [k, z.boolean()])) as Record<EmailKind, z.ZodBoolean>).partial();

export const forgotPasswordInput = z.object({ email: z.string().trim().email().max(320) });
export const resetPasswordInput = z.object({ token: z.string().min(10).max(200), password: passwordSchema });
