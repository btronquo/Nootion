import { eq } from "drizzle-orm";
import { calendarDateProp, calendarSources, type CalendarSource, type DateValue } from "@nootion/shared";
import { pages } from "./db/schema.js";
import type { Db } from "./db/index.js";
import type { ProseMirrorNode } from "./collab.js";
import { getPageMeta } from "./pages.js";
import { getPageRole } from "./permissions.js";
import { listProperties, listRowPages, toRow } from "./databases.js";

/** Sources of the calendar block with this id in a page's content, or null if the block is gone. */
export function findCalendarBlock(content: ProseMirrorNode | null | undefined, blockId: string): CalendarSource[] | null {
  if (!content) return null;
  if (content.type === "calendarBlock" && content.attrs?.id === blockId) return calendarSources(content.attrs.sources);
  for (const child of content.content ?? []) {
    const found = findCalendarBlock(child, blockId);
    if (found) return found;
  }
  return null;
}

export interface CalendarEvent {
  uid: string;
  title: string;
  /** Stored date: YYYY-MM-DD, or a date and time. */
  start: string;
  end: string | null;
  url: string;
  /** Name of the database it comes from. */
  calendar: string;
  color: string;
  updatedAt: Date;
}

/**
 * Dated rows of a calendar block, as one user sees them: databases they can no longer read are left out.
 * Null when the user can't read the page, or the block was removed.
 */
export function calendarEvents(db: Db, userId: string, pageId: string, blockId: string, appUrl: string): { title: string; events: CalendarEvent[] } | null {
  if (!getPageRole(db, userId, pageId)) return null;
  const page = db.select({ title: pages.title, content: pages.contentJson }).from(pages).where(eq(pages.id, pageId)).get();
  const sources = findCalendarBlock(page?.content as ProseMirrorNode | null, blockId);
  if (!page || !sources) return null;
  const events: CalendarEvent[] = [];
  for (const source of sources) {
    const meta = getPageMeta(db, source.databaseId);
    if (meta?.kind !== "database" || !getPageRole(db, userId, meta.id)) continue;
    const properties = listProperties(db, meta.id);
    const prop = calendarDateProp(properties, source.propertyId);
    if (!prop) continue;
    for (const r of listRowPages(db, meta.id)) {
      const value = toRow(r, properties).values[prop.id] as DateValue | string | null;
      if (!value) continue;
      const { start, end } = typeof value === "string" ? { start: value, end: null } : value;
      if (!start) continue;
      events.push({
        uid: `${r.id}-${prop.id}`,
        title: r.title,
        start,
        end: end ?? null,
        url: `${appUrl}/page/${r.id}`,
        calendar: meta.title,
        color: source.color,
        updatedAt: r.updatedAt,
      });
    }
  }
  return { title: page.title, events };
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n: number) => String(n).padStart(2, "0");

/** YYYYMMDD of the day after a YYYY-MM-DD day (all-day events end the next day, exclusive). */
function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

const utcStamp = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

/** A date and time: in UTC when it carries a time zone, else as "floating" local time. */
function dateTime(value: string, plusHours = 0): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!m) return null;
  if (m[7]) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return utcStamp(new Date(d.getTime() + plusHours * 3600_000));
  }
  // Floating time: shifted as if it were UTC, then written without the Z.
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]! + plusHours, +m[5]!, +(m[6] ?? 0)));
  return utcStamp(d).slice(0, -1);
}

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Lines are folded at 75 bytes, without cutting a UTF-8 character. */
function fold(line: string): string {
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    if (bytes + size > (out.length ? 74 : 75)) {
      out.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join("\r\n ");
}

function eventLines(e: CalendarEvent, untitled: string): string[] | null {
  const lines = ["BEGIN:VEVENT", `UID:${e.uid}@nootion`, `DTSTAMP:${utcStamp(e.updatedAt)}`];
  const day = DAY.exec(e.start);
  if (day) {
    const endDay = e.end ? e.end.slice(0, 10) : e.start;
    lines.push(`DTSTART;VALUE=DATE:${day[1]}${day[2]}${day[3]}`, `DTEND;VALUE=DATE:${nextDay(endDay > e.start ? endDay : e.start)}`);
  } else {
    const start = dateTime(e.start);
    if (!start) return null;
    // An end without a time (or before the start) is ignored: the event lasts an hour.
    const end = e.end && e.end > e.start ? dateTime(e.end) : null;
    lines.push(`DTSTART:${start}`, `DTEND:${end ?? dateTime(e.start, 1)}`);
  }
  lines.push(
    `SUMMARY:${escapeText(e.title || untitled)}`,
    `DESCRIPTION:${escapeText(e.calendar)}`,
    `CATEGORIES:${escapeText(e.calendar || untitled)}`,
    `URL:${e.url}`,
    `COLOR:${e.color === "gray" ? "grey" : e.color}`,
    "END:VEVENT",
  );
  return lines;
}

/** iCalendar (RFC 5545) document of a calendar block's events. */
export function toICal(title: string, events: CalendarEvent[], untitled: string): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nootion//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(title || untitled)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...events.flatMap((e) => eventLines(e, untitled) ?? []),
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
