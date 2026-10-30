import { z } from "zod";

/**
 * Dates written in plain words, in French or in English whatever the language of the interface: "demain 9h",
 * "next friday", "dans 3 jours", "15 novembre", "11/15 at 2pm", "rappel lundi 8h30"…
 *
 * Dates are wall-clock dates, as in date columns: "2026-11-15" for a day, "2026-11-15T09:00" with a time.
 */

export interface ParsedDate {
  /** "YYYY-MM-DD", or "YYYY-MM-DDTHH:mm" with a time. */
  date: string;
  /** The text asked for a reminder ("remind me…", "rappel…"). */
  remind: boolean;
}

/** Order of day and month in "03/04": the day first in French, the month first in English. */
export type DateOrder = "dmy" | "mdy";

// prettier-ignore
const WEEKDAYS: Record<string, number> = {
  dimanche: 0, dim: 0, sunday: 0, sun: 0,
  lundi: 1, lun: 1, monday: 1, mon: 1,
  mardi: 2, tuesday: 2, tue: 2, tues: 2,
  mercredi: 3, mer: 3, wednesday: 3, wed: 3,
  jeudi: 4, jeu: 4, thursday: 4, thu: 4, thur: 4, thurs: 4,
  vendredi: 5, ven: 5, friday: 5, fri: 5,
  samedi: 6, sam: 6, saturday: 6, sat: 6,
};

// prettier-ignore
const MONTHS: Record<string, number> = {
  janvier: 1, janv: 1, january: 1, jan: 1,
  fevrier: 2, fevr: 2, fev: 2, february: 2, feb: 2,
  mars: 3, march: 3, mar: 3,
  avril: 4, avr: 4, april: 4, apr: 4,
  mai: 5, may: 5,
  juin: 6, june: 6, jun: 6,
  juillet: 7, juil: 7, july: 7, jul: 7,
  aout: 8, august: 8, aug: 8,
  septembre: 9, sept: 9, september: 9, sep: 9,
  octobre: 10, october: 10, oct: 10,
  novembre: 11, november: 11, nov: 11,
  decembre: 12, december: 12, dec: 12,
};

// prettier-ignore
const NUMBERS: Record<string, number> = {
  un: 1, une: 1, a: 1, an: 1, one: 1, deux: 2, two: 2, trois: 3, three: 3, quatre: 4, four: 4, cinq: 5, five: 5,
  six: 6, sept: 7, seven: 7, huit: 8, eight: 8, neuf: 9, nine: 9, dix: 10, ten: 10, quinze: 15, fifteen: 15,
};

// prettier-ignore
const UNITS: Record<string, "minute" | "hour" | "day" | "week" | "month" | "year"> = {
  min: "minute", mins: "minute", minute: "minute", minutes: "minute",
  h: "hour", heure: "hour", heures: "hour", hour: "hour", hours: "hour",
  j: "day", jour: "day", jours: "day", d: "day", day: "day", days: "day",
  semaine: "week", semaines: "week", sem: "week", w: "week", week: "week", weeks: "week",
  mois: "month", month: "month", months: "month",
  an: "year", ans: "year", annee: "year", annees: "year", year: "year", years: "year",
};

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" of a local date. */
export function dayString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The local Date a date string stands for: midnight for a day. */
export function dateFromString(date: string): Date {
  const [y, m, d, hh, mm] = date.split(/[-T:]/).map(Number);
  return new Date(y!, m! - 1, d!, hh ?? 0, mm ?? 0);
}

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const valid = (d: Date, y: number, m: number, dd: number) => d.getFullYear() === y && d.getMonth() === m - 1 && d.getDate() === dd;

/** Without a year, the occurrence of a day and month closest to today: "10/12" in late December is this year's. */
function closest(today: Date, m: number, d: number): Date | null {
  const options = [-1, 0, 1].map((k) => today.getFullYear() + k).map((y) => (valid(day(y, m, d), y, m, d) ? day(y, m, d) : null));
  let best: Date | null = null;
  for (const o of options) if (o && (!best || Math.abs(o.getTime() - today.getTime()) < Math.abs(best.getTime() - today.getTime()))) best = o;
  return best;
}

/** A written year: "26" is 2026. */
const year = (text: string | undefined) => (text ? (text.length === 2 ? 2000 : 0) + Number(text) : null);

function numberOf(word: string): number | null {
  if (/^\d+$/.test(word)) return Number(word);
  return NUMBERS[word] ?? null;
}

/** Lowercase, without accents nor extra spaces and punctuation. */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[,;!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.$/, "");
}

/** Takes the time out of the text ("9h", "9h30", "14:00", "2pm", "a midi"): [hours, minutes] and the rest. */
function takeTime(text: string): { time: [number, number] | null; rest: string } {
  const patterns: [RegExp, (m: RegExpMatchArray) => [number, number] | null][] = [
    [/(?:^| )(?:a |at |@ ?|vers |around )?(\d{1,2})(?:h(\d{2})?|:(\d{2})) ?(am|pm)?(?= |$)/, (m) => clock(Number(m[1]), Number(m[2] ?? m[3] ?? 0), m[4])],
    [/(?:^| )(?:a |at |@ ?|vers |around )?(\d{1,2}) ?(am|pm)(?= |$)/, (m) => clock(Number(m[1]), 0, m[2])],
    [/(?:^| )(?:a |at )?(midi|noon)(?= |$)/, () => [12, 0]],
    [/(?:^| )(?:a |at )?(minuit|midnight)(?= |$)/, () => [0, 0]],
  ];
  for (const [re, read] of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const time = read(m);
    if (!time) return { time: null, rest: "\u0000" };
    return { time, rest: (text.slice(0, m.index) + " " + text.slice(m.index! + m[0].length)).replace(/\s+/g, " ").trim() };
  }
  return { time: null, rest: text };
}

function clock(h: number, min: number, ampm?: string): [number, number] | null {
  if (ampm) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ampm === "pm" ? 12 : 0);
  }
  return h > 23 || min > 59 ? null : [h, min];
}

/** The day a text without its time stands for, or a precise moment ("dans 2 heures"). */
function takeDay(text: string, today: Date, now: Date, order: DateOrder): Date | { at: Date } | null {
  if (/^(ce soir|tonight)$/.test(text)) return today;
  // Little words around the date: "le 15", "on friday", "the 15th", "for tomorrow".
  const t = text
    .replace(/^(le|on|the|pour|for|this|ce|cette) /, "")
    .replace(/ (le|on|the)$/, "")
    .trim();
  if (t === "" || /^(aujourd'?hui|auj|today|tdy|now|maintenant)$/.test(t)) return today;
  if (/^(demain|tomorrow|tmrw?|tmw)$/.test(t)) return addDays(today, 1);
  if (/^(hier|yesterday)$/.test(t)) return addDays(today, -1);
  if (/^(apres[- ]demain|(the )?day after tomorrow)$/.test(t)) return addDays(today, 2);
  if (/^(avant[- ]hier|(the )?day before yesterday)$/.test(t)) return addDays(today, -2);

  // Monday of next week, first day of next month.
  if (/^((la )?semaine prochaine|next week)$/.test(t)) return addDays(today, 7 - ((today.getDay() + 6) % 7));
  if (/^((le )?mois prochain|next month)$/.test(t)) return day(today.getFullYear(), today.getMonth() + 2, 1);
  if (/^((l')?annee prochaine|next year)$/.test(t)) return day(today.getFullYear() + 1, 1, 1);
  if (/^((ce )?week-?end|(this )?weekend)$/.test(t)) return addDays(today, (6 - today.getDay() + 7) % 7);

  // Days of the week: the next one ("vendredi"), the one of next week ("vendredi prochain", "next friday").
  let m = t.match(/^(?:(next|prochain) )?([a-z]+)(?: (prochain|next))?$/);
  if (m && WEEKDAYS[m[2]!] !== undefined) {
    const wd = WEEKDAYS[m[2]!]!;
    if (m[1] || m[3]) {
      const monday = addDays(today, 7 - ((today.getDay() + 6) % 7));
      return addDays(monday, (wd + 6) % 7);
    }
    return addDays(today, ((wd - today.getDay() + 6) % 7) + 1);
  }

  // "dans 3 jours", "in 2 weeks", "dans une heure", "3 days ago", "il y a 2 jours".
  m = t.match(/^(dans|in|il y a) ([a-z0-9]+) ([a-z]+)$/) ?? t.match(/^()([a-z0-9]+) ([a-z]+) (ago)$/);
  if (m) {
    const n = numberOf(m[2]!);
    const unit = UNITS[m[3]!];
    if (n === null || !unit) return null;
    const sign = m[1] === "il y a" || m[4] === "ago" ? -1 : 1;
    if (unit === "minute" || unit === "hour") {
      const at = new Date(now.getTime() + sign * n * (unit === "hour" ? 3_600_000 : 60_000));
      at.setSeconds(0, 0);
      return { at };
    }
    if (unit === "day") return addDays(today, sign * n);
    if (unit === "week") return addDays(today, sign * 7 * n);
    if (unit === "month") {
      // 31 January plus a month is the last day of February.
      const last = day(today.getFullYear(), today.getMonth() + 2 + sign * n, 0).getDate();
      return day(today.getFullYear(), today.getMonth() + 1 + sign * n, Math.min(today.getDate(), last));
    }
    return day(today.getFullYear() + sign * n, today.getMonth() + 1, today.getDate());
  }

  // ISO: 2026-11-15.
  m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return valid(day(y, mo, d), y, mo, d) ? day(y, mo, d) : null;
  }

  // 15/11, 15/11/2026, 15.11.26, 15-11-2026 (11/15 with the month first).
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    const [d, mo] = order === "dmy" ? [a, b] : [b, a];
    const y = year(m[3]);
    if (y === null) return closest(today, mo, d);
    return valid(day(y, mo, d), y, mo, d) ? day(y, mo, d) : null;
  }

  // "15 novembre", "1er nov 2026", "15th of november", "november 15", "nov 15th, 2026".
  const named =
    t.match(/^(?<d>\d{1,2})(?:er|st|nd|rd|th)?(?: of)? (?<mo>[a-z]+)(?: (?<y>\d{4}))?$/) ??
    t.match(/^(?<mo>[a-z]+) (?<d>\d{1,2})(?:st|nd|rd|th)?(?: (?<y>\d{4}))?$/);
  if (named?.groups) {
    const d = Number(named.groups.d);
    const mo = MONTHS[named.groups.mo!];
    if (!mo) return null;
    if (!named.groups.y) return closest(today, mo, d);
    const y = Number(named.groups.y);
    return valid(day(y, mo, d), y, mo, d) ? day(y, mo, d) : null;
  }

  // "le 15", "the 15th": this month's if still to come, else next month's.
  m = t.match(/^(\d{1,2})(?:er|st|nd|rd|th)?$/);
  if (m && /^(le|the) /.test(text)) {
    const d = Number(m[1]);
    for (let k = 0; k < 3; k++) {
      const c = day(today.getFullYear(), today.getMonth() + 1 + k, d);
      if (c.getDate() === d && c >= today) return c;
    }
  }
  return null;
}

/**
 * The date a text stands for, or null when it isn't one. Both French and English words are understood; `order` only
 * decides how "03/04" is read.
 */
export function parseNaturalDate(input: string, now: Date = new Date(), order: DateOrder = "dmy"): ParsedDate | null {
  let text = normalize(input);
  let remind = false;
  const r = text.match(/^(rappelle[- ]moi|rappel(?:er)?|remind(?: me)?|reminder)(?: (?:de |to |on |le |a |at ))?(.*)$/);
  if (r) {
    remind = true;
    text = r[2]!.trim();
  }
  if (!text && !remind) return null;
  const { time, rest } = takeTime(text);
  if (rest === "\u0000") return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Times of day: "ce soir" alone means this evening.
  const evening = /^(ce soir|tonight)$/.test(rest);
  const found = takeDay(rest, today, now, order);
  if (!found) return null;
  if ("at" in found) return { date: `${dayString(found.at)}T${pad(found.at.getHours())}:${pad(found.at.getMinutes())}`, remind };
  const [h, min] = time ?? (evening ? [19, 0] : [null, null]);
  return { date: h === null ? dayString(found) : `${dayString(found)}T${pad(h)}:${pad(min!)}`, remind };
}

/** Reminder choices, in minutes before the date. For a day without a time, they count from 9:00 that day. */
export const DAY_REMINDERS = [0, 1440, 2880, 10080] as const;
export const TIME_REMINDERS = [0, 5, 15, 30, 60, 1440] as const;
/** Hour of the reminder for a day without a time. */
export const DAY_REMINDER_HOUR = 9;

/** When a reminder set `minutesBefore` a date goes off, in this device's time zone. */
export function reminderTime(date: string, minutesBefore: number): Date {
  const at = dateFromString(date);
  if (!date.includes("T")) at.setHours(DAY_REMINDER_HOUR, 0, 0, 0);
  return new Date(at.getTime() - minutesBefore * 60_000);
}

/** A reminder set on a date in a page. */
export interface Reminder {
  id: string;
  pageId: string;
  pageTitle: string;
  pageIcon: string | null;
  /** The date as written in the page. */
  date: string;
  remindAt: string;
  /** The line of text the date is in. */
  text: string;
  /** Its time has come. */
  due: boolean;
}

export const pushSubscriptionInput = z.object({
  endpoint: z.url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});
