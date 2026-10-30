import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { nextOccurrence, type RecurrenceRule } from "@nootion/shared";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

const rule = (r: Partial<RecurrenceRule>): RecurrenceRule => ({
  frequency: "daily",
  interval: 1,
  weekdays: [],
  monthDay: 1,
  time: "08:00",
  timeZone: "Europe/Paris",
  startDate: "2026-10-01",
  parentId: null,
  dateProperty: null,
  enabled: true,
  ...r,
});
const next = (r: Partial<RecurrenceRule>, after: string) => nextOccurrence(rule(r), new Date(after))?.toISOString();

describe("next occurrence", () => {
  it("counts days, weeks and months from the start, at the time of day in the time zone", () => {
    // Paris is UTC+2 until October 25, 2026, then UTC+1.
    expect(next({}, "2026-10-20T05:00:00Z")).toBe("2026-10-20T06:00:00.000Z");
    expect(next({}, "2026-10-20T06:00:00Z")).toBe("2026-10-21T06:00:00.000Z");
    expect(next({}, "2026-10-25T05:00:00Z")).toBe("2026-10-25T07:00:00.000Z");
    // Every 3 days from Oct 1: the 1st, 4th… 19th, 22nd.
    expect(next({ interval: 3 }, "2026-10-20T00:00:00Z")).toBe("2026-10-22T06:00:00.000Z");
    // Not before the start.
    expect(next({ startDate: "2026-12-24" }, "2026-10-20T00:00:00Z")).toBe("2026-12-24T07:00:00.000Z");
    // Mondays and Thursdays, every other week from the week of Oct 1 (a Thursday).
    expect(next({ frequency: "weekly", weekdays: [1, 4], interval: 2 }, "2026-10-02T00:00:00Z")).toBe("2026-10-12T06:00:00.000Z");
    expect(next({ frequency: "weekly", weekdays: [1, 4], interval: 2 }, "2026-10-12T07:00:00Z")).toBe("2026-10-15T06:00:00.000Z");
    // The 31st is the last day in short months.
    expect(next({ frequency: "monthly", monthDay: 31, time: "18:30" }, "2027-02-01T00:00:00Z")).toBe("2027-02-28T17:30:00.000Z");
    expect(next({ frequency: "monthly", monthDay: 15, interval: 6 }, "2026-10-20T00:00:00Z")).toBe("2027-04-15T06:00:00.000Z");
    expect(next({ timeZone: "America/New_York", time: "23:00" }, "2026-10-20T00:00:00Z")).toBe("2026-10-20T03:00:00.000Z");
  });
});

let app: FastifyInstance;
let boris: Client;
let ws: string;

beforeEach(async () => {
  app = await makeApp();
  boris = await setupAdmin(app);
  ws = await boris.personalWorkspace();
});

const schedule = (id: string, body: Partial<RecurrenceRule>) => boris.put(`/api/pages/${id}/recurrence`, { ...rule({}), startDate: "2026-01-01", ...body });

describe("recurring templates", () => {
  it("makes rows from a row template, with the day in a date column", async () => {
    const db = (await boris.post("/api/databases", { workspaceId: ws, parentId: null, title: "Courses" })).json().database.id;
    const day = (await boris.post(`/api/databases/${db}/properties`, { name: "Jour", type: "date", config: {} })).json().property.id;
    const tpl = (await boris.post(`/api/databases/${db}/templates`)).json().template.id;
    await boris.patch(`/api/pages/${tpl}`, { title: "Liste" });

    const res = await schedule(tpl, { frequency: "weekly", weekdays: [6], time: "09:00", dateProperty: day });
    expect(res.statusCode).toBe(200);
    const due = new Date(res.json().recurrence.nextRunAt);
    expect(due.getTime()).toBeGreaterThan(Date.now());

    await app.recurrences.tick(new Date(due.getTime() + 60_000));
    await app.recurrences.tick(new Date(due.getTime() + 120_000));
    const rows = (await boris.post(`/api/databases/${db}/query`, {})).json().rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toMatch(/^Liste — sam\. /);
    expect(rows[0].values[day].start).toBe(due.toISOString().slice(0, 10));
    const after = (await boris.get(`/api/pages/${tpl}/recurrence`)).json().recurrence;
    expect(new Date(after.nextRunAt).getTime() - due.getTime()).toBe(7 * 86_400_000);
    expect(after).toMatchObject({ lastError: null });
  });

  it("makes pages from a page template in the chosen page, and says when it can't", async () => {
    const meetings = await boris.createPage(ws, "Réunions");
    const tpl = await boris.createPage(ws, "Réunion d'équipe");
    await boris.post(`/api/pages/${tpl}/content`, { markdown: "## Ordre du jour" });
    expect((await schedule(tpl, { parentId: meetings })).statusCode).toBe(400);
    await boris.patch(`/api/pages/${tpl}`, { template: true });

    expect((await schedule(tpl, { parentId: null })).statusCode).toBe(400);
    expect((await schedule(tpl, { parentId: meetings, frequency: "weekly", weekdays: [] })).statusCode).toBe(400);
    expect((await schedule(tpl, { parentId: meetings, timeZone: "Mars/Olympus" })).statusCode).toBe(400);
    const { recurrence } = (await schedule(tpl, { parentId: meetings })).json();

    await app.recurrences.tick(new Date(new Date(recurrence.nextRunAt).getTime() + 1000));
    const children = (await boris.get(`/api/workspaces/${ws}/pages`)).json().pages.filter((p: { parentId: string }) => p.parentId === meetings);
    expect(children).toHaveLength(1);
    expect(children[0].title).toMatch(/^Réunion d'équipe — /);
    expect((await boris.get(`/api/pages/${children[0].id}/content`)).json().markdown).toContain("Ordre du jour");

    // Paused: no next run. The parent gone: the next run says why it failed.
    expect((await schedule(tpl, { parentId: meetings, enabled: false })).json().recurrence.nextRunAt).toBeNull();
    const { recurrence: again } = (await schedule(tpl, { parentId: meetings })).json();
    await boris.delete(`/api/pages/${meetings}`);
    await app.recurrences.tick(new Date(new Date(again.nextRunAt).getTime() + 1000));
    expect((await boris.get(`/api/pages/${tpl}/recurrence`)).json().recurrence.lastError).toBeTruthy();

    const alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
    expect((await alice.delete(`/api/pages/${tpl}/recurrence`)).statusCode).toBe(404);
    expect((await boris.delete(`/api/pages/${tpl}/recurrence`)).statusCode).toBe(200);
    expect((await boris.get(`/api/pages/${tpl}/recurrence`)).json().recurrence).toBeNull();
  });
});
