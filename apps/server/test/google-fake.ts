import http from "node:http";
import type { AddressInfo } from "node:net";

/** A Google Calendar event, as the fake keeps it. */
export interface FakeEvent {
  id: string;
  status: "confirmed" | "cancelled";
  summary?: string;
  description?: string;
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
  updated: string;
  extendedProperties?: { private?: Record<string, string> };
  recurringEventId?: string;
  seq: number;
}

/** A tiny stand-in for Google: OAuth (token, revoke) and Calendar (calendar list, events with sync tokens). */
export interface FakeGoogle {
  url: string;
  /** Requests received, as "METHOD path". */
  calls: string[];
  events: Map<string, FakeEvent>;
  /** Adds or changes an event as if someone did it in Google. */
  put: (e: Partial<FakeEvent> & { id: string }) => void;
  /** Deletes an event as if someone did it in Google. */
  remove: (id: string) => void;
  revoked: string[];
  close: () => Promise<void>;
}

const CALENDAR = { id: "famille@group.calendar.google.com", summary: "Famille", timeZone: "Europe/Paris", accessRole: "owner", backgroundColor: "#7986cb" };

export async function startFakeGoogle(): Promise<FakeGoogle> {
  const calls: string[] = [];
  const revoked: string[] = [];
  const events = new Map<string, FakeEvent>();
  let seq = 0;
  let clock = Date.parse("2026-11-01T08:00:00Z");
  const now = () => new Date((clock += 1000)).toISOString();
  let nextId = 1;
  let url = "";

  const put = (e: Partial<FakeEvent> & { id: string }) => {
    const old = events.get(e.id);
    const merged = {
      ...(old ?? { status: "confirmed" }),
      ...e,
      extendedProperties: { private: { ...old?.extendedProperties?.private, ...e.extendedProperties?.private } },
      updated: now(),
      seq: ++seq,
    } as FakeEvent;
    events.set(e.id, merged);
    return merged;
  };
  const shown = ({ seq: _seq, ...e }: FakeEvent) => e;

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const u = new URL(req.url!, url);
      calls.push(`${req.method} ${u.pathname}`);
      const json = (status: number, data: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(data));
      };
      // The page where people sign in and allow access: here it says yes right away.
      if (req.method === "GET" && u.pathname === "/auth") {
        const back = new URL(u.searchParams.get("redirect_uri")!);
        back.searchParams.set("code", "good-code");
        back.searchParams.set("state", u.searchParams.get("state")!);
        res.writeHead(302, { location: back.href });
        return res.end();
      }
      if (req.method === "POST" && u.pathname === "/token") {
        const form = new URLSearchParams(body);
        if (form.get("client_id") !== "client-id" || form.get("client_secret") !== "client-secret") return json(401, { error: "invalid_client" });
        if (form.get("grant_type") === "authorization_code") {
          if (form.get("code") !== "good-code") return json(400, { error: "invalid_grant" });
          const idToken = `x.${Buffer.from(JSON.stringify({ email: "boris@gmail.com" })).toString("base64url")}.y`;
          return json(200, { access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600, id_token: idToken });
        }
        if (form.get("refresh_token") !== "refresh-1" || revoked.includes("refresh-1")) return json(400, { error: "invalid_grant" });
        return json(200, { access_token: "access-2", expires_in: 3600 });
      }
      if (req.method === "POST" && u.pathname === "/revoke") {
        revoked.push(new URLSearchParams(body).get("token")!);
        return json(200, {});
      }
      if (!/^Bearer access-\d$/.test(req.headers.authorization ?? "") || revoked.includes("refresh-1"))
        return json(401, { error: { message: "Invalid Credentials" } });
      const path = u.pathname.replace(/^\/calendar\/v3/, "");
      if (path === "/users/me/calendarList") return json(200, { items: [CALENDAR] });
      if (path === `/users/me/calendarList/${encodeURIComponent(CALENDAR.id)}` || path === `/users/me/calendarList/${CALENDAR.id}`) return json(200, CALENDAR);
      const m = decodeURIComponent(path).match(/^\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
      if (!m || m[1] !== CALENDAR.id) return json(404, { error: { message: "Not Found" } });
      const id = m[2];
      if (!id && req.method === "GET") {
        const token = u.searchParams.get("syncToken");
        if (token === "expired") return json(410, { error: { message: "Sync token is no longer valid" } });
        const since = token ? Number(token.slice(1)) : -1;
        const items = [...events.values()].filter((e) => (token ? e.seq > since : e.status !== "cancelled"));
        return json(200, { items: items.map(shown), nextSyncToken: `s${seq}` });
      }
      if (!id && req.method === "POST") {
        const input = JSON.parse(body);
        return json(200, shown(put({ ...input, id: `evt${nextId++}`, status: "confirmed" })));
      }
      const existing = id ? events.get(id) : undefined;
      if (!existing) return json(404, { error: { message: "Not Found" } });
      if (req.method === "PATCH") {
        if (existing.status === "cancelled" && JSON.parse(body).status !== "confirmed") return json(410, { error: { message: "Deleted" } });
        return json(200, shown(put({ ...JSON.parse(body), id: id! })));
      }
      if (req.method === "DELETE") {
        if (existing.status === "cancelled") return json(410, { error: { message: "Deleted" } });
        put({ id: id!, status: "cancelled" });
        res.writeHead(204);
        return res.end();
      }
      json(405, {});
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    calls,
    events,
    revoked,
    put: (e) => void put(e),
    remove: (id) => void put({ id, status: "cancelled" }),
    close: () => new Promise((r) => server.close(() => r())),
  };
}
