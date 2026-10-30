// "google_calendar" plugin, server side: each person connects their Google account (OAuth), then syncs a database's
// date column with one of their calendars, both ways. Every minute: changes made in Google are read (incremental
// sync), then rows that changed in Nootion are sent to Google. When both sides changed, the latest change wins.
import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

// Overridable for tests.
const AUTH_URL = process.env.GOOGLE_AUTH_URL ?? "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_URL = process.env.GOOGLE_OAUTH_URL ?? "https://oauth2.googleapis.com";
const API_URL = process.env.GOOGLE_API_URL ?? "https://www.googleapis.com";
const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.calendarlist.readonly", "https://www.googleapis.com/auth/calendar.events"];
const TIMEOUT_MS = 20000;
const EVERY_MS = 60 * 1000;

const TEXTS = {
  en: {
    notConfigured: "The administrator hasn't set up Google Calendar yet (Administration › Plugins).",
    notConnected: "Connect your Google account first.",
    expired: "The connection to Google took too long or was refused: start again.",
    google: "Google answered: {error}",
    unreachable: "Google can't be reached: {error}",
    noSync: "This sync no longer exists.",
    notOwner: "Only {name}, who set up this sync, can change it.",
    notDate: "Choose a date column.",
    needEditor: "You need to be able to edit the database.",
    revoked: "{name}'s Google account is no longer connected: they have to connect it again.",
    link: "Open in Nootion",
  },
  fr: {
    notConfigured: "L'administrateur n'a pas encore configuré Google Agenda (Administration › Plugins).",
    notConnected: "Connectez d'abord votre compte Google.",
    expired: "La connexion à Google a pris trop de temps ou a été refusée : recommencez.",
    google: "Google a répondu : {error}",
    unreachable: "Impossible de joindre Google : {error}",
    noSync: "Cette synchronisation n'existe plus.",
    notOwner: "Seul(e) {name}, qui a mis en place cette synchronisation, peut la modifier.",
    notDate: "Choisissez une colonne de type date.",
    needEditor: "Il faut pouvoir modifier la base de données.",
    revoked: "Le compte Google de {name} n'est plus connecté : il faut le reconnecter.",
    link: "Ouvrir dans Nootion",
  },
};

export function activate(nootion) {
  const clientId = String(nootion.settings.clientId ?? "").trim();
  const clientSecret = String(nootion.settings.clientSecret ?? "").trim();
  const configured = !!clientId && !!clientSecret;
  const redirectUri = `${nootion.appUrl}/api/plugins/google_calendar/oauth/callback`;
  const lang = () => TEXTS[nootion.locale()] ?? TEXTS.en;
  const text = (key, vars = {}) => lang()[key].replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
  const fail = (status, code, key, vars) => new nootion.HttpError(status, code, text(key, vars));
  /** OAuth requests waiting for Google's answer, by state. */
  const pending = new Map();

  // --- Syncs, kept in a file of the plugin's folder ------------------------------------------------

  const file = path.join(nootion.dataDir, "syncs.json");
  /** @type {Record<string, Sync>} */
  let syncs = {};
  try {
    syncs = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    syncs = {};
  }
  const save = () => {
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(syncs));
    fs.renameSync(`${file}.tmp`, file);
  };

  // --- Google ------------------------------------------------------------------------------------

  async function call(url, init = {}) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw fail(502, "google_unreachable", "unreachable", { error: e?.cause?.code ?? e?.message ?? String(e) });
    }
  }

  async function googleError(res) {
    const data = await res.json().catch(() => null);
    const error = data?.error?.message ?? data?.error_description ?? data?.error ?? `HTTP ${res.status}`;
    return fail(502, "google_error", "google", { error: typeof error === "string" ? error : JSON.stringify(error) });
  }

  async function tokenRequest(params) {
    const res = await call(`${OAUTH_URL}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }).toString(),
    });
    if (!res.ok) {
      const err = await googleError(res);
      err.revoked = res.status === 400 || res.status === 401;
      throw err;
    }
    return res.json();
  }

  /** A valid access token for the user, refreshed when it is about to expire. */
  async function accessToken(userId) {
    const acc = nootion.userSecrets.get(userId);
    if (!acc?.refreshToken || acc.clientId !== clientId) throw fail(409, "google_not_connected", "notConnected");
    if (acc.accessToken && acc.expiresAt > Date.now() + 60_000) return acc.accessToken;
    let data;
    try {
      data = await tokenRequest({ grant_type: "refresh_token", refresh_token: acc.refreshToken });
    } catch (e) {
      // Access was removed in the Google account: forget it.
      if (e.revoked) nootion.userSecrets.delete(userId);
      throw e.revoked ? fail(409, "google_not_connected", "notConnected") : e;
    }
    const next = { ...acc, accessToken: data.access_token, expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000 };
    nootion.userSecrets.set(userId, next);
    return next.accessToken;
  }

  /** Calls Google Calendar's API as the user. 404 and 410 come back as null. */
  async function google(userId, method, apiPath, body, retried = false) {
    const res = await call(`${API_URL}/calendar/v3${apiPath}`, {
      method,
      headers: { authorization: `Bearer ${await accessToken(userId)}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && !retried) {
      // The access token was refused before it expired (access removed?): get a new one, or learn it's over.
      const acc = nootion.userSecrets.get(userId);
      if (acc) nootion.userSecrets.set(userId, { ...acc, accessToken: null, expiresAt: 0 });
      return google(userId, method, apiPath, body, true);
    }
    if (res.status === 404 || res.status === 410) return null;
    if (!res.ok) throw await googleError(res);
    return res.status === 204 ? {} : res.json();
  }

  // --- Account ---------------------------------------------------------------------------------

  nootion.route("GET", "/status", ({ user }) => {
    const acc = configured ? nootion.userSecrets.get(user.id) : null;
    const connected = !!acc?.refreshToken && acc.clientId === clientId;
    return { configured, connected, email: connected ? acc.email : null };
  });

  // The browser goes there; Google sends it back to /oauth/callback.
  nootion.route("GET", "/oauth/start", ({ user, query }) => {
    if (!configured) throw fail(400, "google_not_configured", "notConfigured");
    const state = randomBytes(24).toString("base64url");
    const back = typeof query.return === "string" && /^\/(?!\/)/.test(query.return) ? query.return : "/";
    pending.set(state, { userId: user.id, back, at: Date.now() });
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });
    return nootion.redirect(`${AUTH_URL}?${params}`);
  });

  nootion.route("GET", "/oauth/callback", async ({ user, query }) => {
    const p = pending.get(String(query.state ?? ""));
    pending.delete(String(query.state ?? ""));
    if (!p || p.userId !== user.id || Date.now() - p.at > 15 * 60 * 1000 || !query.code) throw fail(400, "google_oauth_failed", "expired");
    const data = await tokenRequest({ grant_type: "authorization_code", code: String(query.code), redirect_uri: redirectUri });
    if (!data.refresh_token) throw fail(400, "google_oauth_failed", "expired");
    nootion.userSecrets.set(user.id, {
      clientId,
      refreshToken: data.refresh_token,
      accessToken: data.access_token,
      expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000,
      email: emailOf(data.id_token),
    });
    const sep = p.back.includes("?") ? "&" : "?";
    return nootion.redirect(`${p.back}${sep}google=connected`);
  });

  async function disconnect(userId) {
    const acc = nootion.userSecrets.get(userId);
    nootion.userSecrets.delete(userId);
    if (acc?.refreshToken) {
      await call(`${OAUTH_URL}/revoke`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: acc.refreshToken }).toString(),
      }).catch(() => null);
    }
    // Their syncs can't run any more.
    for (const s of Object.values(syncs)) if (s.userId === userId) delete syncs[s.id];
    save();
  }

  nootion.route("DELETE", "/account", async ({ user }) => {
    await disconnect(user.id);
    return { connected: false };
  });

  // Listed in "My account › Connected services".
  nootion.connectedAccount({
    describe: (userId) => {
      const acc = configured ? nootion.userSecrets.get(userId) : null;
      return acc?.refreshToken && acc.clientId === clientId ? (acc.email ?? "Google") : null;
    },
    disconnect,
  });

  /** Calendars the user can add events to. */
  nootion.route("GET", "/calendars", async ({ user }) => {
    const items = [];
    let pageToken = "";
    do {
      const data = await google(
        user.id,
        "GET",
        `/users/me/calendarList?minAccessRole=writer&maxResults=250${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
      );
      items.push(...(data?.items ?? []));
      pageToken = data?.nextPageToken ?? "";
    } while (pageToken);
    return {
      calendars: items
        .map((c) => ({
          id: c.id,
          name: c.summaryOverride ?? c.summary ?? c.id,
          color: c.backgroundColor ?? null,
          timeZone: c.timeZone ?? "UTC",
          primary: !!c.primary,
        }))
        .sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name)),
    };
  });

  // --- Syncs -----------------------------------------------------------------------------------

  const canView = (userId, s) => !!nootion.pages.role(userId, s.databaseId);
  const findSync = (id) => {
    const s = syncs[id];
    if (!s) throw fail(404, "not_found", "noSync");
    return s;
  };
  const describe = (s, userId) => ({
    id: s.id,
    databaseId: s.databaseId,
    databaseTitle: s.databaseTitle,
    propertyName: s.propertyName,
    calendarName: s.calendarName,
    ownerName: s.ownerName,
    mine: s.userId === userId,
    lastSync: s.lastSync,
    error: s.error,
    events: Object.keys(s.links).length,
  });

  nootion.route("POST", "/syncs", async ({ user, body }) => {
    if (!configured) throw fail(400, "google_not_configured", "notConfigured");
    const databaseId = String(body?.databaseId ?? "");
    const propertyId = String(body?.propertyId ?? "");
    const calendarId = String(body?.calendarId ?? "");
    const { database } = await nootion.request(user.id, "GET", `/databases/${encodeURIComponent(databaseId)}`);
    if (database.role !== "editor" && database.role !== "full") throw fail(403, "forbidden", "needEditor");
    const prop = database.properties.find((p) => p.id === propertyId);
    if (prop?.type !== "date") throw fail(400, "bad_property", "notDate");
    const calendar = await google(user.id, "GET", `/users/me/calendarList/${encodeURIComponent(calendarId)}`);
    if (!calendar) throw fail(404, "not_found", "noSync");
    const s = {
      id: randomUUID(),
      userId: user.id,
      ownerName: user.name,
      databaseId,
      databaseTitle: database.title,
      propertyId,
      propertyName: prop.name,
      calendarId,
      calendarName: calendar.summaryOverride ?? calendar.summary ?? calendarId,
      timeZone: calendar.timeZone ?? "UTC",
      syncToken: null,
      lastSync: null,
      error: null,
      links: {},
    };
    syncs[s.id] = s;
    save();
    await run(s);
    return { sync: describe(s, user.id) };
  });

  nootion.route("GET", "/syncs/:id", ({ user, params }) => {
    const s = findSync(params.id);
    if (!canView(user.id, s)) throw fail(404, "not_found", "noSync");
    return { sync: describe(s, user.id) };
  });

  nootion.route("POST", "/syncs/:id/run", async ({ user, params }) => {
    const s = findSync(params.id);
    if (!canView(user.id, s)) throw fail(404, "not_found", "noSync");
    await run(s);
    return { sync: describe(s, user.id) };
  });

  nootion.route("DELETE", "/syncs/:id", ({ user, params }) => {
    const s = findSync(params.id);
    if (s.userId !== user.id && user.role !== "admin") throw fail(403, "forbidden", "notOwner", { name: s.ownerName });
    delete syncs[s.id];
    save();
    return { ok: true };
  });

  // --- Syncing ----------------------------------------------------------------------------------

  const running = new Map();
  /** Runs a sync, once at a time; errors are kept on the sync, to be shown. */
  function run(s) {
    if (!running.has(s.id)) {
      running.set(
        s.id,
        syncOnce(s)
          .then(() => (s.error = null))
          .catch((e) => {
            s.error = e?.code === "google_not_connected" ? text("revoked", { name: s.ownerName }) : (e?.message ?? String(e));
            nootion.log.warn(`sync ${s.id}: ${s.error}`);
          })
          .finally(() => {
            running.delete(s.id);
            if (syncs[s.id]) save();
          }),
      );
    }
    return running.get(s.id);
  }

  async function syncOnce(s) {
    const tz = s.timeZone;
    const cal = `/calendars/${encodeURIComponent(s.calendarId)}/events`;
    const { database } = await nootion.request(s.userId, "GET", `/databases/${encodeURIComponent(s.databaseId)}`);
    const prop = database.properties.find((p) => p.id === s.propertyId);
    if (prop?.type !== "date") throw fail(400, "bad_property", "notDate");
    s.databaseTitle = database.title;
    s.propertyName = prop.name;
    const rows = new Map(database.rows.map((r) => [r.id, r]));
    const rowState = (r) => {
      const v = r.values[s.propertyId];
      return v?.start ? state(r.title ?? "", v.start, v.end ?? null) : null;
    };
    const byEvent = new Map(Object.entries(s.links).map(([rowId, l]) => [l.eventId, rowId]));

    // 1. What changed in Google since last time (everything, the first time).
    const changed = [];
    let pageToken = "";
    let nextSyncToken = null;
    for (;;) {
      const params = new URLSearchParams({ maxResults: "250" });
      if (s.syncToken) params.set("syncToken", s.syncToken);
      if (pageToken) params.set("pageToken", pageToken);
      const data = await google(s.userId, "GET", `${cal}?${params}`);
      if (!data) {
        // The sync token expired: read everything again.
        if (!s.syncToken) throw fail(404, "not_found", "noSync");
        s.syncToken = null;
        changed.length = 0;
        pageToken = "";
        continue;
      }
      changed.push(...(data.items ?? []));
      pageToken = data.nextPageToken ?? "";
      if (!pageToken) {
        nextSyncToken = data.nextSyncToken ?? null;
        break;
      }
    }

    for (const e of changed) {
      // Changed occurrences of a repeating event are left alone: the repeating event is one row.
      if (e.recurringEventId) continue;
      let rowId = byEvent.get(e.id) ?? null;
      const tagged = e.extendedProperties?.private?.nootionRow;
      if (!rowId && tagged && rows.has(tagged) && !s.links[tagged]) {
        // Made by this sync, but its link was lost.
        rowId = tagged;
        s.links[rowId] = { eventId: e.id, pushed: rowState(rows.get(rowId)) };
        byEvent.set(e.id, rowId);
      }
      const row = rowId ? rows.get(rowId) : null;
      if (e.status === "cancelled") {
        if (rowId) {
          if (row) await nootion.request(s.userId, "POST", `/databases/${s.databaseId}/rows/delete`, { ids: [rowId] });
          rows.delete(rowId);
          delete s.links[rowId];
          byEvent.delete(e.id);
        }
        continue;
      }
      const remote = eventState(e, tz);
      if (!remote) continue;
      if (row) {
        const link = s.links[rowId];
        const local = rowState(row);
        if (same(remote, link.pushed)) continue; // our own change, coming back
        // Changed on both sides: the latest one wins (Nootion's is sent below).
        if (!same(local, link.pushed) && new Date(row.updatedAt) > new Date(e.updated ?? 0)) continue;
        const res = await nootion.request(s.userId, "PATCH", `/databases/${s.databaseId}/rows/${rowId}`, {
          title: remote.title,
          values: { [s.propertyId]: { start: remote.start, end: remote.end } },
        });
        rows.set(rowId, res.row);
        link.pushed = remote;
      } else if (!rowId) {
        const res = await nootion.request(s.userId, "POST", `/databases/${s.databaseId}/rows`, {
          title: remote.title,
          values: { [s.propertyId]: { start: remote.start, end: remote.end } },
          templateId: null,
        });
        rows.set(res.row.id, res.row);
        s.links[res.row.id] = { eventId: e.id, pushed: remote };
        byEvent.set(e.id, res.row.id);
        // Tags the event, to find its row again.
        await google(s.userId, "PATCH", `${cal}/${encodeURIComponent(e.id)}`, { extendedProperties: { private: { nootionRow: res.row.id } } });
      }
    }
    if (nextSyncToken) s.syncToken = nextSyncToken;

    // 2. Rows that changed in Nootion.
    for (const [rowId, row] of rows) {
      const local = rowState(row);
      const link = s.links[rowId];
      if (!local) {
        if (link) {
          await google(s.userId, "DELETE", `${cal}/${encodeURIComponent(link.eventId)}`);
          delete s.links[rowId];
        }
        continue;
      }
      if (link && same(local, link.pushed)) continue;
      const event = {
        summary: local.title,
        ...toGoogle(local, tz),
        extendedProperties: { private: { nootionRow: rowId } },
      };
      let saved = link ? await google(s.userId, "PATCH", `${cal}/${encodeURIComponent(link.eventId)}`, { ...event, status: "confirmed" }) : null;
      if (!saved) saved = await google(s.userId, "POST", cal, { ...event, description: `${lang().link} : ${nootion.appUrl}/page/${rowId}` });
      s.links[rowId] = { eventId: saved.id, pushed: local };
    }
    // Rows gone from the database (in the trash, or moved away).
    for (const [rowId, link] of Object.entries(s.links)) {
      if (rows.has(rowId)) continue;
      await google(s.userId, "DELETE", `${cal}/${encodeURIComponent(link.eventId)}`);
      delete s.links[rowId];
    }
    s.lastSync = new Date().toISOString();
  }

  nootion.every(EVERY_MS, async () => {
    for (const s of Object.values(syncs)) await run(s);
  });

  return () => pending.clear();
}

/** A row or event as compared between both sides: an end equal to the default one (1 hour, or the same day) is none. */
export function state(title, start, end) {
  let e = end && end !== start ? end : null;
  if (e && start.includes("T") && e === addMinutes(start, 60)) e = null;
  return { title: title.trim(), start, end: e };
}

const same = (a, b) => !!a && !!b && a.title === b.title && a.start === b.start && a.end === b.end;

/** "2026-11-02" + n days. */
export function addDays(date, n) {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "2026-11-02T09:30" + n minutes, as wall-clock time. */
export function addMinutes(dateTime, n) {
  const d = new Date(`${dateTime}:00Z`);
  d.setUTCMinutes(d.getUTCMinutes() + n);
  return d.toISOString().slice(0, 16);
}

/** An instant as wall-clock time in a time zone: "2026-11-02T09:30". */
export function wallClock(instant, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(instant))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** A Google event's title and dates as Nootion stores them (the end of an all-day event is the last day). */
export function eventState(e, timeZone) {
  if (e.start?.date) {
    const last = e.end?.date ? addDays(e.end.date, -1) : null;
    return state(e.summary ?? "", e.start.date, last && last > e.start.date ? last : null);
  }
  if (e.start?.dateTime) {
    return state(e.summary ?? "", wallClock(e.start.dateTime, timeZone), e.end?.dateTime ? wallClock(e.end.dateTime, timeZone) : null);
  }
  return null;
}

/** Start and end of a Google event from a row's dates. */
export function toGoogle({ start, end }, timeZone) {
  if (!start.includes("T")) {
    const last = end && !end.includes("T") && end > start ? end : start;
    return { start: { date: start }, end: { date: addDays(last, 1) } };
  }
  let stop = end ?? addMinutes(start, 60);
  if (!stop.includes("T")) stop = `${stop}${start.slice(10)}`;
  if (stop <= start) stop = addMinutes(start, 60);
  return { start: { dateTime: `${start}:00`, timeZone }, end: { dateTime: `${stop}:00`, timeZone } };
}

/** The email in a Google id token (it comes straight from Google over HTTPS, so it isn't checked again). */
function emailOf(idToken) {
  try {
    return JSON.parse(Buffer.from(String(idToken).split(".")[1], "base64url").toString()).email ?? null;
  } catch {
    return null;
  }
}
