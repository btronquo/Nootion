import { z } from "zod";

/**
 * Recurring templates: a page or row template that makes a new page (or row) on a schedule, every N days, weeks
 * (on some weekdays) or months (on a day of the month), at a time of day in the time zone of the person who set it.
 */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const recurrenceInput = z.object({
  frequency: z.enum(["daily", "weekly", "monthly"]),
  interval: z.number().int().min(1).max(52).default(1),
  /** weekly: the days, 0 = Sunday … 6 = Saturday. */
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  /** monthly: the day of the month; the last day for short months. */
  monthDay: z.number().int().min(1).max(31).default(1),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default("08:00"),
  timeZone: z.string().min(1).max(64),
  /** The first day it may run; the intervals count from it. */
  startDate: day,
  /** Page templates: the page the new pages go in. */
  parentId: z.string().min(1).max(64).nullable().default(null),
  /** Row templates: a date column that gets the day of the run. */
  dateProperty: z.string().min(1).max(64).nullable().default(null),
  enabled: z.boolean().default(true),
});
export type RecurrenceRule = z.infer<typeof recurrenceInput>;

export interface Recurrence extends RecurrenceRule {
  templateId: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
}

/** The wall-clock date and time of an instant in a time zone. */
function wallClock(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), hh: get("hour") % 24, mm: get("minute"), ss: get("second") };
}

/** The instant a wall-clock time happens in a time zone (the later one when clocks go back, shifted when they skip). */
export function zonedInstant(y: number, m: number, d: number, hh: number, mm: number, timeZone: string): Date {
  const wanted = Date.UTC(y, m - 1, d, hh, mm);
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const w = wallClock(new Date(guess), timeZone);
    const seen = Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm, w.ss);
    if (seen === wanted) break;
    guess += wanted - seen;
  }
  return new Date(guess);
}

const DAY_MS = 86_400_000;
const dayNumber = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);

/** The next time a rule runs, strictly after `after`; null if it never does. */
export function nextOccurrence(rule: RecurrenceRule, after: Date): Date | null {
  const [sy, sm, sd] = rule.startDate.split("-").map(Number) as [number, number, number];
  const start = dayNumber(sy, sm, sd);
  const [hh, mm] = rule.time.split(":").map(Number) as [number, number];
  const now = wallClock(after, rule.timeZone);
  const first = Math.max(start, dayNumber(now.y, now.m, now.d));
  // Weeks start on Monday: day 0 (1970-01-01) was a Thursday.
  const week = (n: number) => Math.floor((n + 3) / 7);
  const limit = 400 * rule.interval + 62;
  for (let n = first; n < first + limit; n++) {
    const date = new Date(n * DAY_MS);
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth() + 1;
    const d = date.getUTCDate();
    let matches = false;
    if (rule.frequency === "daily") matches = (n - start) % rule.interval === 0;
    else if (rule.frequency === "weekly") matches = rule.weekdays.includes(date.getUTCDay()) && (week(n) - week(start)) % rule.interval === 0;
    else {
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const months = (y - sy) * 12 + (m - sm);
      matches = d === Math.min(rule.monthDay, lastDay) && months % rule.interval === 0;
    }
    if (!matches) continue;
    const at = zonedInstant(y, m, d, hh, mm, rule.timeZone);
    if (at > after) return at;
  }
  return null;
}

/** The day (YYYY-MM-DD) an instant falls on in a time zone. */
export function dayIn(at: Date, timeZone: string): string {
  const w = wallClock(at, timeZone);
  return `${w.y}-${String(w.m).padStart(2, "0")}-${String(w.d).padStart(2, "0")}`;
}
