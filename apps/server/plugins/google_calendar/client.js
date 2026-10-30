// "google_calendar" plugin, browser side: the "/google calendar" block sets up a sync, then shows how it is going.

const TEXTS = {
  en: {
    title: "Google Calendar",
    intro:
      "Sync a database with one of your Google calendars, both ways: rows with a date become events, and events created, moved or deleted in Google change the database.",
    notConfigured: "The administrator hasn't set up Google Calendar yet, in Administration › Plugins.",
    connect: "Connect to Google",
    connectedAs: "Google account: {email}",
    disconnect: "Disconnect",
    confirmDisconnect: "Disconnect your Google account? Your syncs will stop.",
    database: "Database",
    dateColumn: "Date column",
    calendar: "Google calendar",
    choose: "Choose…",
    noDateColumn: "This database has no date column.",
    start: "Sync",
    starting: "First sync…",
    synced: "{database} ⇄ {calendar}",
    details: 'Column "{column}" · {events} events · set up by {owner}',
    lastSync: "Synced {when}",
    never: "Not synced yet",
    syncNow: "Sync now",
    stop: "Stop syncing",
    confirmStop: "Stop syncing? Events already in Google stay there.",
    gone: "This sync no longer exists.",
    setUpAgain: "Set up again",
    loading: "Loading…",
    justNow: "just now",
    minutesAgo: "{n} min ago",
    hoursAgo: "{n} h ago",
    tip: "Tip: a calendar made for this keeps your other events out of the database.",
  },
  fr: {
    title: "Google Agenda",
    intro:
      "Synchronisez une base de données avec l'un de vos agendas Google, dans les deux sens : les lignes datées deviennent des événements, et les événements créés, déplacés ou supprimés dans Google modifient la base.",
    notConfigured: "L'administrateur n'a pas encore configuré Google Agenda, dans Administration › Plugins.",
    connect: "Se connecter à Google",
    connectedAs: "Compte Google : {email}",
    disconnect: "Se déconnecter",
    confirmDisconnect: "Déconnecter votre compte Google ? Vos synchronisations s'arrêteront.",
    database: "Base de données",
    dateColumn: "Colonne date",
    calendar: "Agenda Google",
    choose: "Choisir…",
    noDateColumn: "Cette base n'a pas de colonne date.",
    start: "Synchroniser",
    starting: "Première synchronisation…",
    synced: "{database} ⇄ {calendar}",
    details: "Colonne « {column} » · {events} événements · mise en place par {owner}",
    lastSync: "Synchronisé {when}",
    never: "Pas encore synchronisé",
    syncNow: "Synchroniser maintenant",
    stop: "Arrêter la synchro",
    confirmStop: "Arrêter la synchronisation ? Les événements déjà dans Google y restent.",
    gone: "Cette synchronisation n'existe plus.",
    setUpAgain: "La remettre en place",
    loading: "Chargement…",
    justNow: "à l'instant",
    minutesAgo: "il y a {n} min",
    hoursAgo: "il y a {n} h",
    tip: "Astuce : un agenda créé pour l'occasion évite d'importer tous vos autres événements dans la base.",
  },
};

const CSS = `
.gc-box { border: 1px solid rgba(128,128,128,.3); border-radius: 8px; padding: 12px 14px; font-size: 14px; }
.gc-head { display: flex; align-items: center; gap: 8px; font-weight: 600; }
.gc-sub { font-size: 12px; opacity: .65; }
.gc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin: 12px 0; }
.gc-grid label { display: grid; gap: 4px; font-size: 12px; opacity: .9; }
.gc-input { width: 100%; box-sizing: border-box; border: 1px solid rgba(128,128,128,.4); border-radius: 6px; padding: 6px 8px; font-size: 14px; background: transparent; color: inherit; }
.gc-input option { color: #111; }
.gc-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.gc-link { background: none; border: 0; padding: 0; color: #3b82f6; cursor: pointer; font-size: 12px; }
.gc-link:hover { text-decoration: underline; }
.gc-error { color: #dc2626; font-size: 13px; margin-top: 8px; }
`;

export function activate(nootion) {
  const { React } = nootion;
  const { useEffect, useState } = React;
  const h = React.createElement;
  const { Button } = nootion.ui;
  const T = TEXTS[nootion.locale] ?? TEXTS.en;
  const fmt = (text, vars) => text.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
  const message = (e) => (e instanceof Error ? e.message : String(e));
  const getJson = async (url) => {
    const res = await fetch(url, { credentials: "same-origin" });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.message ?? `HTTP ${res.status}`);
    return data;
  };

  if (!document.getElementById("nootion-gcal-css")) {
    const style = document.createElement("style");
    style.id = "nootion-gcal-css";
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function ago(iso) {
    const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (minutes < 1) return T.justNow;
    if (minutes < 60) return fmt(T.minutesAgo, { n: minutes });
    if (minutes < 48 * 60) return fmt(T.hoursAgo, { n: Math.round(minutes / 60) });
    return new Date(iso).toLocaleDateString(nootion.locale);
  }

  const Head = ({ children }) => h("div", { className: "gc-head" }, h("span", null, "📅"), children);

  /** Choosing the database, its date column and the calendar. */
  function Setup({ onCreated }) {
    const [status, setStatus] = useState(null);
    const [databases, setDatabases] = useState(null);
    const [calendars, setCalendars] = useState(null);
    const [databaseId, setDatabaseId] = useState("");
    const [columns, setColumns] = useState(null);
    const [propertyId, setPropertyId] = useState("");
    const [calendarId, setCalendarId] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    const loadStatus = () =>
      nootion
        .api("/status")
        .then(setStatus)
        .catch((e) => setError(message(e)));
    useEffect(() => void loadStatus(), []);

    useEffect(() => {
      if (!status?.connected) return;
      getJson("/api/databases")
        .then((d) => setDatabases(d.databases))
        .catch((e) => setError(message(e)));
      nootion
        .api("/calendars")
        .then((d) => {
          setCalendars(d.calendars);
          if (d.calendars.length === 1) setCalendarId(d.calendars[0].id);
        })
        .catch((e) => setError(message(e)));
    }, [status?.connected]);

    useEffect(() => {
      setColumns(null);
      setPropertyId("");
      if (!databaseId) return;
      getJson(`/api/databases/${encodeURIComponent(databaseId)}`)
        .then((d) => {
          const dates = d.database.properties.filter((p) => p.type === "date");
          setColumns(dates);
          if (dates.length === 1) setPropertyId(dates[0].id);
        })
        .catch((e) => setError(message(e)));
    }, [databaseId]);

    async function start() {
      setBusy(true);
      setError(null);
      try {
        const { sync } = await nootion.api("/syncs", { method: "POST", body: { databaseId, propertyId, calendarId } });
        onCreated(sync.id);
      } catch (e) {
        setError(message(e));
        setBusy(false);
      }
    }

    async function disconnect() {
      if (!confirm(T.confirmDisconnect)) return;
      await nootion.api("/account", { method: "DELETE" }).catch(() => null);
      loadStatus();
    }

    let body;
    if (!status) body = h("p", { className: "gc-sub" }, error ?? T.loading);
    else if (!status.configured) body = h("p", { style: { marginTop: 8 } }, T.notConfigured);
    else if (!status.connected) {
      body = h(
        "div",
        null,
        h("p", { style: { margin: "8px 0 10px", opacity: 0.85 } }, T.intro),
        h(
          Button,
          {
            type: "button",
            onClick: () => (window.location.href = `/api/plugins/google_calendar/oauth/start?return=${encodeURIComponent(window.location.pathname)}`),
            "data-gcal-connect": "",
          },
          T.connect,
        ),
      );
    } else {
      const select = (label, value, onChange, options, extra = {}) =>
        h(
          "label",
          null,
          label,
          h(
            "select",
            { className: "gc-input", value, onChange: (e) => onChange(e.target.value), "aria-label": label, ...extra },
            h("option", { value: "" }, options === null ? T.loading : T.choose),
            ...(options ?? []).map((o) => h("option", { key: o.id, value: o.id }, o.name)),
          ),
        );
      body = h(
        "div",
        null,
        h("p", { style: { margin: "8px 0 0", opacity: 0.85 } }, T.intro),
        h(
          "div",
          { className: "gc-grid" },
          select(
            T.database,
            databaseId,
            setDatabaseId,
            databases && databases.map((d) => ({ id: d.id, name: `${d.icon ? `${d.icon} ` : ""}${d.title || "—"}` })),
          ),
          select(T.dateColumn, propertyId, setPropertyId, databaseId ? columns : [], { disabled: !databaseId }),
          select(T.calendar, calendarId, setCalendarId, calendars),
        ),
        databaseId && columns?.length === 0 && h("div", { className: "gc-error" }, T.noDateColumn),
        h("div", { className: "gc-sub" }, T.tip),
        h(
          "div",
          { className: "gc-row" },
          h(
            Button,
            { type: "button", disabled: busy || !databaseId || !propertyId || !calendarId, onClick: start, "data-gcal-start": "" },
            busy ? T.starting : T.start,
          ),
          h("span", { className: "gc-sub", style: { flex: 1, textAlign: "right" } }, fmt(T.connectedAs, { email: status.email ?? "?" }), " · "),
          h("button", { type: "button", className: "gc-link", onClick: disconnect }, T.disconnect),
        ),
      );
    }
    return h(
      "div",
      { className: "gc-box", "data-gcal-setup": "" },
      h(Head, null, T.title),
      body,
      error && status && h("div", { className: "gc-error" }, error),
    );
  }

  /** A running sync: what it links, when it last ran, and its error if any. */
  function Status({ syncId, editable, onGone }) {
    const [sync, setSync] = useState(null);
    const [gone, setGone] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    const load = () =>
      nootion
        .api(`/syncs/${encodeURIComponent(syncId)}`)
        .then((d) => setSync(d.sync))
        .catch((e) => (e?.status === 404 ? setGone(true) : setError(message(e))));
    useEffect(() => {
      void load();
      const timer = setInterval(load, 30000);
      return () => clearInterval(timer);
    }, [syncId]);

    async function act(fn) {
      setBusy(true);
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(message(e));
      } finally {
        setBusy(false);
      }
    }

    if (gone) {
      return h(
        "div",
        { className: "gc-box" },
        h(Head, null, T.title),
        h("p", { className: "gc-sub", style: { marginTop: 6 } }, T.gone),
        editable && h("div", { className: "gc-row" }, h(Button, { type: "button", variant: "ghost", onClick: onGone }, T.setUpAgain)),
      );
    }
    if (!sync) return h("div", { className: "gc-box" }, h(Head, null, T.title), h("p", { className: "gc-sub" }, error ?? T.loading));
    return h(
      "div",
      { className: "gc-box", "data-gcal-sync": "" },
      h(Head, null, fmt(T.synced, { database: sync.databaseTitle || "—", calendar: sync.calendarName })),
      h("div", { className: "gc-sub", style: { marginTop: 4 } }, fmt(T.details, { column: sync.propertyName, events: sync.events, owner: sync.ownerName })),
      h("div", { className: "gc-sub", "data-gcal-last": "" }, sync.lastSync ? fmt(T.lastSync, { when: ago(sync.lastSync) }) : T.never),
      (sync.error || error) && h("div", { className: "gc-error" }, sync.error ?? error),
      editable &&
        h(
          "div",
          { className: "gc-row" },
          h(
            Button,
            {
              type: "button",
              variant: "ghost",
              disabled: busy,
              onClick: () => act(async () => setSync((await nootion.api(`/syncs/${syncId}/run`, { method: "POST" })).sync)),
            },
            T.syncNow,
          ),
          sync.mine &&
            h(
              Button,
              {
                type: "button",
                variant: "ghost",
                disabled: busy,
                onClick: () =>
                  confirm(T.confirmStop) &&
                  act(async () => {
                    await nootion.api(`/syncs/${syncId}`, { method: "DELETE" });
                    onGone();
                  }),
              },
              T.stop,
            ),
        ),
    );
  }

  function SyncBlock({ data, setData, editable }) {
    if (data.syncId) return h(Status, { syncId: data.syncId, editable, onGone: () => setData({}) });
    return editable ? h(Setup, { onCreated: (syncId) => setData({ syncId }) }) : null;
  }

  nootion.registerBlock("sync", SyncBlock);
}
