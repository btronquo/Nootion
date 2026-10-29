import { z } from "zod";
import { OPTION_COLORS, type OptionColor } from "./databases.js";

/** A database shown on a calendar block, with the date column its rows are placed on and their colour. */
export interface CalendarSource {
  databaseId: string;
  /** Null: the database's first date column. */
  propertyId: string | null;
  color: OptionColor;
}

export const calendarSourceSchema = z.object({
  databaseId: z.string().min(1).max(64),
  propertyId: z.string().min(1).max(64).nullable().default(null),
  color: z.enum(OPTION_COLORS).catch("blue"),
});

/** Sources of a calendar block, as stored in its node: entries that don't parse are left out. */
export function calendarSources(raw: unknown): CalendarSource[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((s) => {
    const parsed = calendarSourceSchema.safeParse(s);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Private iCal link of a calendar block, for one user. */
export interface CalendarFeed {
  url: string;
}
