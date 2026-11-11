import { dateFromString, dayString } from "./dates.js";

/**
 * Repeating to-dos: a to-do that, once checked, unchecks itself and moves its date (the first date written in it) to
 * the next time it is due. Kept on the to-do as text: "1d" every day, "2w" every two weeks, "1m" every month, "1y"
 * every year.
 */
export const TASK_REPEAT_UNITS = ["d", "w", "m", "y"] as const;
export type TaskRepeatUnit = (typeof TASK_REPEAT_UNITS)[number];

export interface TaskRepeat {
  every: number;
  unit: TaskRepeatUnit;
}

/** The choices offered in a to-do's menu. */
export const TASK_REPEAT_CHOICES = ["1d", "1w", "2w", "1m", "1y"] as const;

/** The rule a to-do's `repeat` attribute holds, or null when it doesn't repeat (or holds something else). */
export function parseTaskRepeat(value: unknown): TaskRepeat | null {
  if (typeof value !== "string") return null;
  const m = /^([1-9]\d?)([dwmy])$/.exec(value);
  return m ? { every: Number(m[1]), unit: m[2] as TaskRepeatUnit } : null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const daysIn = (y: number, m: number) => new Date(y, m, 0).getDate();

/** The date `steps` repeats after `date`, the same time of day; a day of the month that doesn't exist becomes the last one. */
function shift(date: string, repeat: TaskRepeat, steps: number): string {
  const [day, time] = date.split("T") as [string, string | undefined];
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const n = repeat.every * steps;
  let next: string;
  if (repeat.unit === "d" || repeat.unit === "w") {
    next = dayString(new Date(y, m - 1, d + n * (repeat.unit === "w" ? 7 : 1)));
  } else {
    const months = m - 1 + n * (repeat.unit === "y" ? 12 : 1);
    const ny = y + Math.floor(months / 12);
    const nm = (months % 12) + 1;
    next = `${ny}-${pad(nm)}-${pad(Math.min(d, daysIn(ny, nm)))}`;
  }
  return time ? `${next}T${time}` : next;
}

/**
 * The date a repeating to-do moves to when checked: the next one in its rhythm that is still to come (after today
 * for a day, after now for a day and time). Checked early, it moves by one repeat. The rhythm counts from the date
 * written, so "the 31st, every month" stays on the 31st when it can.
 */
export function nextTaskDate(date: string, repeat: TaskRepeat, now: Date = new Date()): string {
  const today = dayString(now);
  const toCome = (d: string) => (d.includes("T") ? dateFromString(d) > now : d > today);
  // Skips over the repeats missed meanwhile without trying them one by one (a daily to-do left for years).
  const elapsed = Math.max(0, (now.getTime() - dateFromString(date).getTime()) / 86_400_000);
  const perStep = { d: 1, w: 7, m: 28, y: 365 }[repeat.unit] * repeat.every;
  let steps = Math.max(1, Math.floor(elapsed / perStep) - 1);
  while (steps > 1 && toCome(shift(date, repeat, steps - 1))) steps--;
  while (!toCome(shift(date, repeat, steps))) steps++;
  return shift(date, repeat, steps);
}
