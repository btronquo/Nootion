import { dayString } from "./dates.js";

/**
 * Repeating to-dos. A repeating to-do is checked like any other and stays checked until the next time it is due,
 * when it unchecks by itself and its date (the first date written in it) moves to that day.
 *
 * The rule is kept on the to-do as text: "2d" every two days, "1w" every week, "1w:1,4" every week on Monday and
 * Thursday (0 = Sunday), "1m" every month, "1m:10" every month on the 10th, "1y" every year.
 */
export const TASK_REPEAT_UNITS = ["d", "w", "m", "y"] as const;
export type TaskRepeatUnit = (typeof TASK_REPEAT_UNITS)[number];

export interface TaskRepeat {
  every: number;
  unit: TaskRepeatUnit;
  /** Weekly: the days it is due, 0 = Sunday … 6 = Saturday; empty for "a week after". */
  weekdays: number[];
  /** Monthly: the day of the month it is due (the last day for shorter months); null for "a month after". */
  monthDay: number | null;
}

/** The choices offered first in a to-do's menu; others are made in its "Custom" dialog. */
export const TASK_REPEAT_CHOICES = ["1d", "1w", "1m", "1y"] as const;

/** The rule a to-do's `repeat` attribute holds, or null when it doesn't repeat (or holds something else). */
export function parseTaskRepeat(value: unknown): TaskRepeat | null {
  if (typeof value !== "string") return null;
  const m = /^([1-9]\d?)([dwmy])(?::(\d{1,2}(?:,\d{1,2}){0,6}))?$/.exec(value);
  if (!m) return null;
  const unit = m[2] as TaskRepeatUnit;
  const list = m[3] ? m[3].split(",").map(Number) : [];
  if (list.length && unit !== "w" && unit !== "m") return null;
  if (unit === "w" && list.some((d) => d > 6)) return null;
  if (unit === "m" && (list.length > 1 || list.some((d) => d < 1 || d > 31))) return null;
  return {
    every: Number(m[1]),
    unit,
    weekdays: unit === "w" ? [...new Set(list)].sort((a, b) => a - b) : [],
    monthDay: unit === "m" && list.length ? list[0]! : null,
  };
}

/** The text kept on the to-do for a rule. */
export function taskRepeatString(r: TaskRepeat): string {
  const every = Math.min(99, Math.max(1, Math.round(r.every)));
  if (r.unit === "w" && r.weekdays.length) return `${every}w:${[...new Set(r.weekdays)].sort((a, b) => a - b).join(",")}`;
  if (r.unit === "m" && r.monthDay) return `${every}m:${r.monthDay}`;
  return `${every}${r.unit}`;
}

const pad = (n: number) => String(n).padStart(2, "0");
const daysIn = (y: number, m: number) => new Date(y, m, 0).getDate();
const parts = (day: string) => day.split("-").map(Number) as [number, number, number];
const addDays = (day: string, n: number) => {
  const [y, m, d] = parts(day);
  return dayString(new Date(y, m - 1, d + n));
};
/** `n` months after a day, on `dayOfMonth` (or the last day of a shorter month). */
const addMonths = (day: string, n: number, dayOfMonth: number) => {
  const [y, m] = parts(day);
  const months = m - 1 + n;
  const ny = y + Math.floor(months / 12);
  const nm = (months % 12) + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(dayOfMonth, daysIn(ny, nm)))}`;
};

/**
 * The day a to-do checked on `from` unchecks: the next day it is due, strictly after `from` (a day, "2026-11-11").
 * `from` is the day it was checked, or its date when that is later (checked early, it waits for the time after).
 */
export function nextTaskDay(repeat: TaskRepeat, from: string): string {
  const [y, m, d] = parts(from);
  const n = repeat.every;
  switch (repeat.unit) {
    case "d":
      return addDays(from, n);
    case "w": {
      if (!repeat.weekdays.length) return addDays(from, 7 * n);
      // Weeks start on Monday; the week of `from`, then every n weeks after it.
      const weekday = new Date(y, m - 1, d).getDay();
      const monday = addDays(from, -((weekday + 6) % 7));
      for (let week = 0; ; week += n) {
        for (let i = 0; i < 7; i++) {
          const day = addDays(monday, week * 7 + i);
          if (day > from && repeat.weekdays.includes((i + 1) % 7)) return day;
        }
      }
    }
    case "m": {
      if (!repeat.monthDay) return addMonths(from, n, d);
      for (let k = 0; ; k += n) {
        const day = addMonths(from, k, repeat.monthDay);
        if (day > from) return day;
      }
    }
    case "y":
      return addMonths(from, 12 * n, d);
  }
}
