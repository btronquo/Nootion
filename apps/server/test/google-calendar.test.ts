import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";
import { startFakeGoogle, type FakeGoogle } from "./google-fake.js";

let app: FastifyInstance;
let g: FakeGoogle;
let boris: Client;
let db: string;
let due: string;
let team: string;
const CAL = "famille@group.calendar.google.com";

beforeEach(async () => {
  g = await startFakeGoogle();
  process.env.GOOGLE_AUTH_URL = `${g.url}/auth`;
  process.env.GOOGLE_OAUTH_URL = g.url;
  process.env.GOOGLE_API_URL = g.url;
  app = await makeApp();
  boris = await setupAdmin(app);
  team = (await boris.post("/api/workspaces", { name: "Maison" })).json().workspace.id;
  const database = (await boris.post("/api/databases", { workspaceId: team, parentId: null, title: "Tâches" })).json().database;
  db = database.id;
  due = (await boris.post(`/api/databases/${db}/properties`, { name: "Échéance", type: "date", config: {} })).json().property.id;
});

afterEach(async () => {
  await app.close();
  await g.close();
  delete process.env.GOOGLE_AUTH_URL;
  delete process.env.GOOGLE_OAUTH_URL;
  delete process.env.GOOGLE_API_URL;
});

async function connect(c: Client) {
  await boris.patch("/api/admin/plugins/google_calendar", { enabled: true, values: { clientId: "client-id", clientSecret: "client-secret" } });
  const start = await c.get("/api/plugins/google_calendar/oauth/start?return=/page/abc");
  expect(start.statusCode).toBe(302);
  const to = new URL(start.headers.location as string);
  expect(to.origin + to.pathname).toBe(`${g.url}/auth`);
  expect(to.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/plugins/google_calendar/oauth/callback");
  expect(to.searchParams.get("access_type")).toBe("offline");
  const back = await c.get(`/api/plugins/google_calendar/oauth/callback?code=good-code&state=${to.searchParams.get("state")}`);
  expect(back.statusCode).toBe(302);
  expect(back.headers.location).toBe("/page/abc?google=connected");
}

const addRow = async (title: string, date: { start: string; end?: string } | null) =>
  (await boris.post(`/api/databases/${db}/rows`, { title, values: date ? { [due]: date } : {}, templateId: null })).json().row.id as string;
const rows = async () =>
  Object.fromEntries(
    ((await boris.get(`/api/databases/${db}`)).json().database.rows as { title: string; values: Record<string, unknown> }[]).map((r) => {
      const v = r.values[due] as { start: string; end?: string | null } | null;
      return [r.title, v ? { start: v.start, end: v.end ?? null } : null];
    }),
  );
const live = () => [...g.events.values()].filter((e) => e.status === "confirmed");
const eventNamed = (summary: string) => live().find((e) => e.summary === summary);

describe("google calendar plugin", () => {
  it("connects each person's Google account with OAuth", async () => {
    await connect(boris);
    expect((await boris.get("/api/plugins/google_calendar/status")).json()).toEqual({ configured: true, connected: true, email: "boris@gmail.com" });
    const stored = app.db.$client.prepare("select value from plugin_user_data where plugin_id = 'google_calendar'").all() as { value: string }[];
    expect(stored[0]!.value).not.toContain("refresh-1");
    expect((await boris.get("/api/plugins/google_calendar/calendars")).json().calendars).toEqual([
      { id: CAL, name: "Famille", color: "#7986cb", timeZone: "Europe/Paris", primary: false },
    ]);

    // A state that isn't theirs, or used twice, is refused.
    const alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
    const start = new URL((await boris.get("/api/plugins/google_calendar/oauth/start")).headers.location as string);
    expect((await alice.get(`/api/plugins/google_calendar/oauth/callback?code=good-code&state=${start.searchParams.get("state")}`)).statusCode).toBe(400);
    expect((await alice.get("/api/plugins/google_calendar/status")).json().connected).toBe(false);
    // Going back to the app after signing in only goes to a page of Nootion.
    const evil = new URL((await alice.get("/api/plugins/google_calendar/oauth/start?return=//evil.example")).headers.location as string);
    expect((await alice.get(`/api/plugins/google_calendar/oauth/callback?code=good-code&state=${evil.searchParams.get("state")}`)).headers.location).toBe(
      "/?google=connected",
    );

    expect((await boris.get("/api/plugins/accounts")).json().accounts).toEqual([{ pluginId: "google_calendar", name: "Google Agenda", account: "boris@gmail.com" }]);
    expect((await boris.request("DELETE", "/api/plugins/accounts/google_calendar")).statusCode).toBe(200);
    expect(g.revoked).toEqual(["refresh-1"]);
    expect((await boris.get("/api/plugins/google_calendar/calendars")).statusCode).toBe(409);
  });

  it("syncs rows and events both ways", async () => {
    await connect(boris);
    const dentist = await addRow("Dentiste", { start: "2026-11-05T09:30" });
    await addRow("Vacances", { start: "2026-12-20", end: "2026-12-24" });
    await addRow("Sans date", null);
    g.put({ id: "bday", summary: "Anniversaire Léa", start: { date: "2026-11-10" }, end: { date: "2026-11-11" } });

    const created = await boris.post("/api/plugins/google_calendar/syncs", { databaseId: db, propertyId: due, calendarId: CAL });
    expect(created.statusCode, created.body).toBe(200);
    const sync = created.json().sync;
    expect(sync).toMatchObject({
      databaseTitle: "Tâches",
      propertyName: "Échéance",
      calendarName: "Famille",
      ownerName: "Boris",
      mine: true,
      error: null,
      events: 3,
    });

    // Rows with a date became events (in the calendar's time zone, all-day events end the day after)…
    expect(eventNamed("Dentiste")).toMatchObject({
      start: { dateTime: "2026-11-05T09:30:00", timeZone: "Europe/Paris" },
      end: { dateTime: "2026-11-05T10:30:00", timeZone: "Europe/Paris" },
      extendedProperties: { private: { nootionRow: dentist } },
      description: `Ouvrir dans Nootion : http://localhost:3000/page/${dentist}`,
    });
    expect(eventNamed("Vacances")).toMatchObject({ start: { date: "2026-12-20" }, end: { date: "2026-12-25" } });
    // …and events became rows.
    expect(await rows()).toEqual({
      Dentiste: { start: "2026-11-05T09:30", end: null },
      Vacances: { start: "2026-12-20", end: "2026-12-24" },
      "Sans date": null,
      "Anniversaire Léa": { start: "2026-11-10", end: null },
    });

    // Nothing changed: nothing is written.
    const before = g.calls.length;
    const again = await boris.post(`/api/plugins/google_calendar/syncs/${sync.id}/run`);
    expect(again.json().sync.error).toBeNull();
    expect(g.calls.slice(before).filter((c) => !c.startsWith("GET"))).toEqual([]);

    // Changes in Google: an event moved (with a time zone offset), one deleted, one added.
    g.put({
      id: eventNamed("Dentiste")!.id,
      summary: "Dentiste (Dr Martin)",
      start: { dateTime: "2026-11-06T13:00:00Z" },
      end: { dateTime: "2026-11-06T14:30:00Z" },
    });
    g.remove("bday");
    g.put({ id: "meeting", summary: "Réunion école", start: { dateTime: "2026-11-12T18:00:00+01:00" }, end: { dateTime: "2026-11-12T19:00:00+01:00" } });
    await boris.post(`/api/plugins/google_calendar/syncs/${sync.id}/run`);
    expect(await rows()).toEqual({
      "Dentiste (Dr Martin)": { start: "2026-11-06T14:00", end: "2026-11-06T15:30" },
      Vacances: { start: "2026-12-20", end: "2026-12-24" },
      "Sans date": null,
      "Réunion école": { start: "2026-11-12T18:00", end: null },
    });
    // The deleted event's row went to the trash.
    const trash = (await boris.get(`/api/workspaces/${team}/trash`)).json();
    expect(JSON.stringify(trash)).toContain("Anniversaire Léa");

    // Changes in Nootion: a row renamed, a date removed, a row trashed, a new dated row.
    const all = (await boris.get(`/api/databases/${db}`)).json().database.rows as { id: string; title: string }[];
    const id = (title: string) => all.find((r) => r.title === title)!.id;
    await boris.patch(`/api/databases/${db}/rows/${id("Vacances")}`, { title: "Vacances au ski" });
    await boris.patch(`/api/databases/${db}/rows/${id("Dentiste (Dr Martin)")}`, { values: { [due]: null } });
    await boris.post(`/api/databases/${db}/rows/delete`, { ids: [id("Réunion école")] });
    await addRow("Courses", { start: "2026-11-07" });
    const res = (await boris.post(`/api/plugins/google_calendar/syncs/${sync.id}/run`)).json().sync;
    expect(res).toMatchObject({ error: null, events: 2 });
    expect(
      live()
        .map((e) => e.summary)
        .sort(),
    ).toEqual(["Courses", "Vacances au ski"]);

    // Then nothing more to do on either side.
    const n = g.calls.length;
    await boris.post(`/api/plugins/google_calendar/syncs/${sync.id}/run`);
    expect(g.calls.slice(n).filter((c) => !c.startsWith("GET"))).toEqual([]);
    expect(Object.keys(await rows()).sort()).toEqual(["Courses", "Sans date", "Vacances au ski"]);
  });

  it("starts over when Google's sync token expires, and shows errors on the sync", async () => {
    await connect(boris);
    await addRow("Dentiste", { start: "2026-11-05T09:30" });
    const sync = (await boris.post("/api/plugins/google_calendar/syncs", { databaseId: db, propertyId: due, calendarId: CAL })).json().sync;
    // Forget the token: the next run reads everything again without making duplicates.
    const file = `${(app as unknown as { config: { dataDir: string } }).config.dataDir}/plugin-data/google_calendar/syncs.json`;
    const fs = await import("node:fs");
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    saved[sync.id].syncToken = "expired";
    fs.writeFileSync(file, JSON.stringify(saved));
    await boris.patch("/api/admin/plugins/google_calendar", { enabled: true });
    await boris.post(`/api/plugins/google_calendar/syncs/${sync.id}/run`);
    expect(live()).toHaveLength(1);
    expect(Object.keys(await rows())).toEqual(["Dentiste"]);

    // Access removed in the Google account: the sync says so.
    g.revoked.push("refresh-1");
    await boris.patch("/api/admin/plugins/google_calendar", { enabled: true });
    const failed = (await boris.post(`/api/plugins/google_calendar/syncs/${sync.id}/run`)).json().sync;
    expect(failed.error).toBe("Le compte Google de Boris n'est plus connecté : il faut le reconnecter.");
  });

  it("only shows a sync to people who can see the database, and only its owner stops it", async () => {
    await connect(boris);
    const sync = (await boris.post("/api/plugins/google_calendar/syncs", { databaseId: db, propertyId: due, calendarId: CAL })).json().sync;
    const alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
    expect((await alice.get(`/api/plugins/google_calendar/syncs/${sync.id}`)).statusCode).toBe(404);
    expect((await alice.request("DELETE", `/api/plugins/google_calendar/syncs/${sync.id}`)).statusCode).toBe(403);
    // A column that isn't a date is refused.
    const title = (await boris.get(`/api/databases/${db}`)).json().database.properties.find((p: { type: string }) => p.type === "title").id;
    expect((await boris.post("/api/plugins/google_calendar/syncs", { databaseId: db, propertyId: title, calendarId: CAL })).statusCode).toBe(400);
    expect((await boris.request("DELETE", `/api/plugins/google_calendar/syncs/${sync.id}`)).statusCode).toBe(200);
    expect((await boris.get(`/api/plugins/google_calendar/syncs/${sync.id}`)).statusCode).toBe(404);
  });
});
