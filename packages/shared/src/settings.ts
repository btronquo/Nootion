import { z } from "zod";

/** Choices administrators make for the whole server ("Administration › Security"). */
export const instanceSettingsInput = z.object({
  /** Lets button webhooks call addresses of the server's own network (Home Assistant, n8n at home…). */
  webhookPrivateNetworks: z.boolean().default(false),
  /** People outside the team can be invited on a page as guests. Off: no new guests, and guests can't sign in. */
  allowGuests: z.boolean().default(true),
});
export type InstanceSettings = z.infer<typeof instanceSettingsInput>;

export const DEFAULT_INSTANCE_SETTINGS: InstanceSettings = instanceSettingsInput.parse({});
