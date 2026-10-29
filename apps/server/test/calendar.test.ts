import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { pages } from "../src/db/schema.js";
import { toICal } from "../src/ical.js";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let boris: Client;

beforeEach(async () => {
  app = await makeApp();
  boris = await setupAdmin(app);
});

const setContent = (pageId: string, content: unknown[]) =>
  app.db
    .update(pages)
    .set({ contentJson: { type: "doc", content } })
    .where(eq(pages.id, pageId))
    .run();
const calendar = (id: string, sources: unknown[]) => ({ type: "calendarBlock", attrs: { id, sources } });
/** Lines of an iCal document, unfolded. */
const lines = (body: string) => body.replace(/\r\n /g, "").split("\r\n");

async function invoices() {
  const ws = await boris.personalWorkspace();
  const d = (await boris.post("/api/databases", { workspaceId: ws, parentId: null, title: "Factures" })).json().database;
  const due = (await boris.post(`/api/databases/${d.id}/properties`, { name: "Échéance", type: "date", config: {} })).json().property;
  const titleId = d.properties[0].id;
  const add = async (title: string, value: unknown) =>
    (await boris.post(`/api/databases/${d.id}/rows`, { values: { [titleId]: title, [due.id]: value } })).json().row.id as string;
  const rows = {
    trip: await add("Voyage, Lyon; été", { start: "2026-11-02", end: "2026-11-04" }),
    call: await add("Appel", { start: "2026-11-05T09:30:00.000Z", end: null }),
    none: await add("Sans date", null),
  };
  return { id: d.id as string, due: due.id as string, rows };
}

describe("calendar feeds", () => {
  it("serves the dated rows of a calendar block as iCal, to anyone with the private link", async () => {
    const db = await invoices();
    const agenda = await boris.createPage(await boris.personalWorkspace(), "Agenda");
    setContent(agenda, [calendar("cal1", [{ databaseId: db.id, propertyId: null, color: "green" }])]);

    expect((await boris.get(`/api/calendar-feeds/${agenda}/cal1`)).json().feed).toBeNull();
    const feed = (await boris.post(`/api/calendar-feeds/${agenda}/cal1`)).json().feed;
    expect(feed.url).toMatch(/\/api\/ical\/[\w-]+\.ics$/);
    // Asking again gives the same link.
    expect((await boris.post(`/api/calendar-feeds/${agenda}/cal1`)).json().feed).toEqual(feed);
    expect((await boris.get(`/api/calendar-feeds/${agenda}/cal1`)).json().feed).toEqual(feed);

    const path = new URL(feed.url).pathname;
    const res = await new Client(app).get(path);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/calendar");
    const ics = lines(res.body);
    expect(ics[0]).toBe("BEGIN:VCALENDAR");
    expect(ics).toContain("X-WR-CALNAME:Agenda");
    expect(ics.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(2);
    expect(ics).toContain(`UID:${db.rows.trip}-${db.due}@nootion`);
    expect(ics).toContain("SUMMARY:Voyage\\, Lyon\\; été");
    // All-day range: the end day is exclusive.
    expect(ics).toContain("DTSTART;VALUE=DATE:20261102");
    expect(ics).toContain("DTEND;VALUE=DATE:20261105");
    // A time without an end lasts an hour.
    expect(ics).toContain("DTSTART:20261105T093000Z");
    expect(ics).toContain("DTEND:20261105T103000Z");
    expect(ics).toContain("COLOR:green");
    expect(ics).toContain("DESCRIPTION:Factures");
    expect(ics.some((l) => l.startsWith("URL:") && l.endsWith(`/page/${db.rows.call}`))).toBe(true);

    // Revoked: the link stops working.
    await boris.delete(`/api/calendar-feeds/${agenda}/cal1`);
    expect((await new Client(app).get(path)).statusCode).toBe(404);
  });

  it("stops when the block is removed, and needs access to the page", async () => {
    const db = await invoices();
    const agenda = await boris.createPage(await boris.personalWorkspace(), "Agenda");
    setContent(agenda, [calendar("cal1", [{ databaseId: db.id, propertyId: db.due, color: "blue" }])]);
    const path = new URL((await boris.post(`/api/calendar-feeds/${agenda}/cal1`)).json().feed.url).pathname;
    expect((await new Client(app).get(path)).statusCode).toBe(200);

    setContent(agenda, [{ type: "paragraph" }]);
    expect((await new Client(app).get(path)).statusCode).toBe(404);
    expect((await new Client(app).get("/api/ical/nope.ics")).statusCode).toBe(404);

    const alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "motdepasse-alice" });
    expect((await alice.post(`/api/calendar-feeds/${agenda}/cal1`)).statusCode).toBe(404);
  });

  it("leaves out the databases the reader can't see", async () => {
    const db = await invoices();
    const agenda = await boris.createPage(await boris.personalWorkspace(), "Agenda");
    setContent(agenda, [calendar("cal1", [{ databaseId: db.id, propertyId: null, color: "red" }])]);
    const alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "motdepasse-alice" });
    await boris.put(`/api/pages/${agenda}/shares`, { userId: await alice.id(), role: "viewer" });

    const path = new URL((await alice.post(`/api/calendar-feeds/${agenda}/cal1`)).json().feed.url).pathname;
    expect(lines((await new Client(app).get(path)).body)).not.toContain("BEGIN:VEVENT");

    await boris.put(`/api/pages/${db.id}/shares`, { userId: await alice.id(), role: "viewer" });
    expect(lines((await new Client(app).get(path)).body).filter((l) => l === "BEGIN:VEVENT")).toHaveLength(2);
  });

  it("keeps on public pages only the databases the link publishes", async () => {
    const db = await invoices();
    const ws = await boris.personalWorkspace();
    const agenda = await boris.createPage(ws, "Agenda");
    const inside = (await boris.post("/api/databases", { workspaceId: ws, parentId: agenda, title: "Tâches" })).json().database;
    setContent(agenda, [
      calendar("cal1", [
        { databaseId: db.id, propertyId: null, color: "red" },
        { databaseId: inside.id, propertyId: null, color: "blue" },
      ]),
    ]);
    const link = (await boris.put(`/api/pages/${agenda}/public-link`, {})).json().link;
    const pub = (await new Client(app).get(`/api/public/${link.token}/pages/${agenda}`)).json().page;
    expect(pub.content.content[0].attrs.sources).toEqual([{ databaseId: inside.id, propertyId: null, color: "blue" }]);
  });
});

describe("iCal output", () => {
  it("folds long lines without cutting characters, and keeps floating times", () => {
    const title = "é".repeat(100);
    const body = toICal(
      "Cal",
      [{ uid: "a", title, start: "2026-01-01T08:00", end: "2026-01-01T09:15", url: "http://x/page/a", calendar: "Db", color: "gray", updatedAt: new Date(0) }],
      "Sans titre",
    );
    for (const line of body.split("\r\n")) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    const ics = lines(body);
    expect(ics).toContain(`SUMMARY:${title}`);
    expect(ics).toContain("DTSTART:20260101T080000");
    expect(ics).toContain("DTEND:20260101T091500");
    expect(ics).toContain("COLOR:grey");
  });
});
