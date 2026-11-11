import { z } from "zod";
import { buttonStepSchema } from "./buttons.js";
import { dayIn, nextOccurrence, recurrenceInput } from "./recurrence.js";

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
  /**
   * On a schedule, as recurring templates: every N days, weeks (on some days) or months (on a day), at a time, from
   * a day and until one. Its steps act on no row: they add rows, create pages or call webhooks.
   */
  recurrenceInput.pick({ frequency: true, interval: true, weekdays: true, monthDay: true, time: true, timeZone: true, startDate: true }).extend({
    type: z.literal("schedule"),
    /** The last day it may run, or null for no end. */
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null),
  }),
]);
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>;
export const AUTOMATION_TRIGGERS = ["row_added", "property_changed", "date_reached", "schedule"] as const;
export type ScheduleTrigger = Extract<AutomationTrigger, { type: "schedule" }>;

/** The next time a scheduled automation runs, strictly after `after`; null once past its last day. */
export function nextScheduledRun(trigger: ScheduleTrigger, after: Date): Date | null {
  const at = nextOccurrence({ ...trigger, parentId: null, dateProperty: null, enabled: true }, after);
  if (!at || !trigger.endDate) return at;
  return dayIn(at, trigger.timeZone) > trigger.endDate ? null : at;
}

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
