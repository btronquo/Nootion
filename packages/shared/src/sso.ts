import { z } from "zod";

/** Who gets an account the first time they sign in with SSO. */
export const SSO_SIGNUPS = ["invited", "domains", "anyone"] as const;
export type SsoSignup = (typeof SSO_SIGNUPS)[number];

/** Single sign-on with an OpenID Connect provider (Microsoft Entra ID, Google, Keycloak…), set by administrators. */
export const ssoSettingsInput = z.object({
  /** Shown on the button: "Sign in with Microsoft". */
  label: z.string().trim().min(1).max(60),
  /** E.g. https://login.microsoftonline.com/<tenant id>/v2.0 */
  issuer: z.string().trim().url().max(300),
  clientId: z.string().trim().min(1).max(300),
  /** Left out: the saved one is kept. */
  clientSecret: z.string().max(1000).optional(),
  signup: z.enum(SSO_SIGNUPS).default("invited"),
  /** For "domains": e.g. ["example.com"]. */
  domains: z
    .array(z.string().trim().toLowerCase().min(3).max(200))
    .max(50)
    .default([]),
  /** Off: only administrators can still sign in with a password. */
  passwordLogin: z.boolean().default(true),
  /** Sessions opened with SSO end after this, so that people removed at the provider lose access. */
  sessionHours: z.number().int().min(1).max(720).default(12),
});
export type SsoSettingsInput = z.infer<typeof ssoSettingsInput>;

/** The settings as shown to administrators: secrets are never sent back. */
export interface SsoSettings extends Omit<SsoSettingsInput, "clientSecret"> {
  hasSecret: boolean;
  /** The address to give the provider (the "redirect URI"). */
  redirectUri: string;
  /** SCIM, for the provider to create and disable accounts. */
  scim: { url: string; enabled: boolean };
}

/** What the sign-in page needs. */
export interface SsoInfo {
  label: string;
  passwordLogin: boolean;
}
