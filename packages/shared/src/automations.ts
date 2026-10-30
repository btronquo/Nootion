import { z } from "zod";
import { buttonStepSchema } from "./buttons.js";

/**
 * Database automations: when something happens to a row, run steps, the same steps as buttons, on that row
 * ({{row.<column>}} and "change the current row" refer to it). They run as the person who set them up, and what they
 * change doesn't set off other automations.
 */
export const automationTriggerSchema = z.discriminatedUnion("type", [
  /** A row is added to the database. */
  z.object({ type: z.literal("row_added") }),
  /** A column's value changes; with `to`, only when it becomes that (an option's name, "true"/"false", a text). */
  z.object({ type: z.literal("property_changed"), propertyId: z.string().min(1).max(64), to: z.string().max(500).nullable().default(null) }),
  /** The date in a date column arrives: at its time, or at 9:00 for a day. */
  z.object({ type: z.literal("date_reached"), propertyId: z.string().min(1).max(64) }),
]);
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>;
export const AUTOMATION_TRIGGERS = ["row_added", "property_changed", "date_reached"] as const;

export const automationInput = z.object({
  name: z.string().trim().max(100).default(""),
  enabled: z.boolean().default(true),
  trigger: automationTriggerSchema,
  steps: z.array(buttonStepSchema).min(1).max(20),
});
export type AutomationInput = z.input<typeof automationInput>;

export interface AutomationRun {
  at: string;
  rowId: string | null;
  rowTitle: string;
  /** Null when it went well. */
  error: string | null;
}

export interface Automation {
  id: string;
  databaseId: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  steps: z.infer<typeof buttonStepSchema>[];
  createdByName: string;
  /** The last runs, latest first. */
  runs: AutomationRun[];
}
