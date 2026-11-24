import { z } from "zod";
import { APP_NAME_MAX } from "./branding.js";

/** Choices administrators make for the whole server ("Administration › Security"). */
export const instanceSettingsInput = z.object({
  /** Lets button webhooks call addresses of the server's own network (Home Assistant, n8n at home…). */
  webhookPrivateNetworks: z.boolean().default(false),
  /** People outside the team can be invited on a page as guests. Off: no new guests, and guests can't sign in. */
  allowGuests: z.boolean().default(true),
  /** How many days the activity log keeps its lines; 0 keeps them for ever. */
  auditRetentionDays: z.number().int().min(0).max(3650).default(365),
  /** The first administrator hasn't finished (or skipped) the setup assistant yet: Administration offers to resume it. */
  setupPending: z.boolean().default(false),
  /** The name shown instead of "Nootion" (sidebar, sign-in page, browser tab, e-mails); empty keeps "Nootion". */
  appName: z.string().trim().max(APP_NAME_MAX).default(""),
  /** The custom logo's file, in the data folder's "branding" directory; null keeps Nootion's. Set by its own routes. */
  logo: z
    .string()
    .regex(/^logo-[a-f0-9]+\.(png|jpg|webp|gif|svg)$/)
    .nullable()
    .default(null),
});
export type InstanceSettings = z.infer<typeof instanceSettingsInput>;

export const DEFAULT_INSTANCE_SETTINGS: InstanceSettings = instanceSettingsInput.parse({});
