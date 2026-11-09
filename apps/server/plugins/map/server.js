// "map" plugin, server side. The places live in an ordinary Nootion database: a row per place, its coordinates in a
// "Place" column ("48.85837, 2.29448", the plugin's own column type) or in two number columns (latitude, longitude).
// Rows are read and written through Nootion's API as the user, so a person only sees and changes the places they could
// see and change in the database itself. Addresses are looked up with a Nominatim server (OpenStreetMap's by default),
// called from here so that its usage rules (one request a second, an identified client) are kept in one place.

const TEXTS = {
  en: {
    database: "Places to visit",
    place: "Place",
    address: "Address",
    country: "Country",
    status: "Status",
    todo: "To see",
    visited: "Seen",
    needPage: "Put the map in a page you can edit to create the database there.",
    noDatabase: "This database no longer exists, or you can't open it.",
    noCoords: "This database has no column for the coordinates: add a \"Place\" column (type Place), or two number columns named Latitude and Longitude.",
    badCoords: "Those aren't coordinates on Earth.",
    badQuery: "Type at least two characters.",
    geocoderDown: "The address search can't be reached: {error}",
    geocoderError: "The address search answered: {error}",
  },
  fr: {
    database: "Lieux à visiter",
    place: "Lieu",
    address: "Adresse",
    country: "Pays",
    status: "Statut",
    todo: "À voir",
    visited: "Vu",
    needPage: "Placez la carte dans une page que vous pouvez modifier pour y créer la base.",
    noDatabase: "Cette base n'existe plus, ou vous ne pouvez pas l'ouvrir.",
    noCoords: "Cette base n'a pas de colonne pour les coordonnées : ajoutez une colonne « Lieu » (type Lieu), ou deux colonnes nombre nommées Latitude et Longitude.",
    badCoords: "Ce ne sont pas des coordonnées terrestres.",
    badQuery: "Tapez au moins deux caractères.",
    geocoderDown: "Impossible de joindre la recherche d'adresse : {error}",
    geocoderError: "La recherche d'adresse a répondu : {error}",
  },
};

const DEFAULT_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const DEFAULT_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
const DEFAULT_GEOCODER = "https://nominatim.openstreetmap.org";
/** Results of the address search, kept a day (the same towns are looked up again and again). */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 1000;
/** Nominatim's public server allows one request a second. */
const GEOCODER_GAP_MS = 1100;

/** "48.85837, 2.29448" (also "48.85837 2.29448", or a Google Maps / OpenStreetMap link) → { lat, lng }, or null. */
export function parseCoords(text) {
  if (typeof text !== "string") return null;
  const num = "(-?\\d{1,3}(?:\\.\\d+)?)";
  const m =
    text.match(new RegExp(`@${num},${num}`)) ?? // https://www.google.com/maps/place/…/@48.85,2.29,17z
    text.match(new RegExp(`[?&]mlat=${num}&mlon=${num}`)) ?? // https://www.openstreetmap.org/?mlat=48.85&mlon=2.29
    text.match(new RegExp(`(?:^|[^\\d.])${num}\\s*[,;]\\s*${num}(?![\\d.])`)) ??
    text.trim().match(new RegExp(`^${num}\\s+${num}$`));
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return validCoords(lat, lng) ? { lat, lng } : null;
}

export const validCoords = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/** How the plugin writes coordinates in a "Place" cell: five decimals, about a metre. */
export const formatCoords = (lat, lng) => `${+lat.toFixed(5)}, ${+lng.toFixed(5)}`;

const norm = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * Which columns of a database hold what: coordinates (a Place column, or latitude and longitude numbers, or a text
 * column named like one holding coordinates), and optionally the address, country and status. Found by type and name,
 * so that any database with coordinates works, not only the one the plugin creates.
 */
export function detectColumns(properties, pluginId = "map") {
  const named = (p, re) => re.test(norm(p.name));
  const isText = (p) => p.type === "text" || p.type === "url";
  const pick = (...tests) => {
    for (const test of tests) {
      const p = properties.find(test);
      if (p) return p.id;
    }
    return null;
  };
  const title = pick((p) => p.type === "title");
  const place = pick(
    (p) => p.type === "plugin" && p.config?.plugin?.id === pluginId && p.config.plugin.type === "place",
    (p) => isText(p) && named(p, /coord|gps|position|location|lieu|place|lat.*lon/),
  );
  const latCol = pick((p) => p.type === "number" && named(p, /^lat/));
  const lngCol = pick((p) => p.type === "number" && named(p, /^(lng|lon)/));
  const lat = place ? null : latCol;
  const lng = place ? null : lngCol;
  // Every column a row's coordinates may be read from, the one written first: a database can have a Place column and
  // also a text "Coordinates" column, or latitude and longitude, filled by hand or by an import.
  const sources = [
    ...properties
      .filter((p) => (p.type === "plugin" && p.config?.plugin?.id === pluginId && p.config.plugin.type === "place") || (isText(p) && named(p, /coord|gps|position|location|lieu|place|lat.*lon/)))
      .sort((a, b) => (a.id === place ? -1 : b.id === place ? 1 : 0))
      .map((p) => ({ place: p.id })),
    ...(latCol && lngCol ? [{ lat: latCol, lng: lngCol }] : []),
  ];
  const address = pick((p) => isText(p) && p.id !== place && named(p, /adres|address|addr/));
  const country = pick((p) => (isText(p) || p.type === "select") && named(p, /^(pays|country)/));
  const status = pick((p) => p.type === "select" && named(p, /statu|etat|state/), (p) => p.type === "select" && p.id !== country);
  return { title, place, lat: lat && lng ? lat : null, lng: lat && lng ? lng : null, address, country, status, sources };
}

export function activate(nootion) {
  const lang = () => TEXTS[nootion.locale()] ?? TEXTS.en;
  const text = (key, vars = {}) => lang()[key].replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
  const fail = (status, code, key, vars) => new nootion.HttpError(status, code, text(key, vars));
  const api = (user, method, path, body) => nootion.request(user.id, method, path, body);
  const setting = (key, fallback) => String(nootion.settings[key] ?? "").trim() || fallback;

  /** Every row of a database (the API gives them a thousand at a time). */
  async function allRows(user, databaseId) {
    const rows = [];
    let cursor;
    for (;;) {
      const page = await api(user, "POST", `/databases/${databaseId}/query`, { limit: 1000, ...(cursor ? { cursor } : {}) });
      rows.push(...page.rows);
      if (!page.nextCursor) return { rows, properties: page.properties };
      cursor = page.nextCursor;
    }
  }

  /** The database's details, or a 404 the user can read. */
  async function database(user, databaseId) {
    if (typeof databaseId !== "string" || !nootion.pages.role(user.id, databaseId)) throw fail(404, "map_no_database", "noDatabase");
    const { database: db } = await api(user, "GET", `/databases/${databaseId}`).catch(() => {
      throw fail(404, "map_no_database", "noDatabase");
    });
    return db;
  }

  const statusesOf = (properties, columns) =>
    (properties.find((p) => p.id === columns.status)?.config?.options ?? []).map((o) => ({ id: o.id, name: o.name, color: o.color ?? "gray" }));

  /** A row as a place on the map, or null when it has no coordinates. */
  function toPlace(row, columns, properties) {
    const v = row.values ?? {};
    let coords = null;
    for (const src of columns.sources ?? []) {
      coords = src.place ? parseCoords(v[src.place]) : validCoords(v[src.lat], v[src.lng]) ? { lat: v[src.lat], lng: v[src.lng] } : null;
      if (coords) break;
    }
    if (!coords) return null;
    const country = columns.country ? v[columns.country] : null;
    const countryName = typeof country === "string" ? (properties.find((p) => p.id === columns.country)?.config?.options?.find((o) => o.id === country)?.name ?? country) : null;
    return {
      id: row.id,
      title: row.title ?? "",
      icon: row.icon ?? null,
      lat: coords.lat,
      lng: coords.lng,
      address: columns.address && typeof v[columns.address] === "string" ? v[columns.address] : null,
      country: countryName,
      status: columns.status && typeof v[columns.status] === "string" ? v[columns.status] : null,
    };
  }

  function coordValues(columns, lat, lng) {
    if (!validCoords(lat, lng)) throw fail(400, "map_bad_coords", "badCoords");
    if (columns.place) return { [columns.place]: formatCoords(lat, lng) };
    if (columns.lat && columns.lng) return { [columns.lat]: lat, [columns.lng]: lng };
    throw fail(409, "map_no_coords", "noCoords");
  }

  // --- Creating the database ----------------------------------------------------------------------

  async function createDatabase(user, pageId) {
    const role = typeof pageId === "string" ? nootion.pages.role(user.id, pageId) : null;
    if (!role || role === "viewer" || role === "commenter") throw fail(403, "map_need_page", "needPage");
    const { page } = await api(user, "GET", `/pages/${pageId}`);
    const { database: db } = await api(user, "POST", "/databases", { workspaceId: page.workspaceId, parentId: pageId, title: text("database") });
    await api(user, "PATCH", `/pages/${db.id}`, { icon: "📍" }).catch(() => {});
    const prop = (name, type, config = {}) => api(user, "POST", `/databases/${db.id}/properties`, { name, type, config });
    await prop(text("status"), "select", {
      options: [
        { id: "todo", name: text("todo"), color: "blue" },
        { id: "visited", name: text("visited"), color: "green" },
      ],
    });
    await prop(text("place"), "plugin", { plugin: { id: nootion.id, type: "place" } });
    await prop(text("address"), "text");
    await prop(text("country"), "text");
    return db.id;
  }

  // --- Address search (Nominatim) ----------------------------------------------------------------

  const cache = new Map();
  let nextSlot = 0;
  /** Waits for the next free second, so that the geocoder is never called more than once a second. */
  async function slot() {
    const now = Date.now();
    const at = Math.max(now, nextSlot);
    nextSlot = at + GEOCODER_GAP_MS;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }

  async function geocoder(path, params) {
    const base = setting("geocoderUrl", DEFAULT_GEOCODER).replace(/\/+$/, "");
    const email = setting("contactEmail", "");
    const query = new URLSearchParams({ format: "jsonv2", addressdetails: "1", "accept-language": nootion.locale(), ...params, ...(email ? { email } : {}) });
    const url = `${base}/${path}?${query}`;
    const hit = cache.get(url);
    if (hit && hit.at > Date.now() - CACHE_TTL_MS) return hit.value;
    await slot();
    let res;
    try {
      res = await fetch(url, { headers: { "user-agent": "Nootion map plugin (self-hosted notes app)", accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    } catch (e) {
      throw fail(502, "map_geocoder_down", "geocoderDown", { error: e?.cause?.code ?? e?.message ?? String(e) });
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw fail(502, "map_geocoder_error", "geocoderError", { error: data?.error?.message ?? data?.error ?? `HTTP ${res.status}` });
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(url, { at: Date.now(), value: data });
    return data;
  }

  /** A Nominatim result as the browser gets it. */
  const toResult = (r) => {
    const label = String(r.display_name ?? "");
    const a = r.address ?? {};
    const name = r.name || a.tourism || a.amenity || a.road || label.split(",")[0] || "";
    return { name, label, lat: Number(r.lat), lng: Number(r.lon), country: a.country ?? null, kind: r.type ?? null };
  };

  // --- Routes ---------------------------------------------------------------------------------------

  // The map's tiles: shared pages need them too.
  nootion.route("GET", "/config", () => ({ tileUrl: setting("tileUrl", DEFAULT_TILES), attribution: setting("tileAttribution", DEFAULT_ATTRIBUTION) }), { public: true });

  // Databases the map can show.
  nootion.route("GET", "/databases", async ({ user }) => {
    const { databases } = await api(user, "GET", "/databases");
    return { databases: databases.map((d) => ({ id: d.id, title: d.title, icon: d.icon })) };
  });

  // Creates a "Places to visit" database under the page.
  nootion.route("POST", "/databases", async ({ user, body }) => ({ databaseId: await createDatabase(user, body?.pageId) }));

  // The places of a database: rows with coordinates.
  nootion.route("GET", "/places", async ({ user, query }) => {
    const db = await database(user, query.db);
    const { rows, properties } = await allRows(user, db.id);
    const columns = detectColumns(properties, nootion.id);
    const places = [];
    let unplaced = 0;
    for (const row of rows) {
      const place = toPlace(row, columns, properties);
      if (place) places.push(place);
      else unplaced++;
    }
    return {
      database: { id: db.id, title: db.title, icon: db.icon, canEdit: db.role === "editor" || db.role === "full" },
      columns,
      statuses: statusesOf(properties, columns),
      places,
      unplaced,
    };
  });

  // Adds a place: a new row.
  nootion.route("POST", "/places", async ({ user, body }) => {
    const db = await database(user, body?.db);
    const columns = detectColumns(db.properties, nootion.id);
    const values = coordValues(columns, Number(body.lat), Number(body.lng));
    if (columns.address && body.address) values[columns.address] = String(body.address).slice(0, 2000);
    const country = columns.country && db.properties.find((p) => p.id === columns.country);
    if (country && body.country && country.type !== "select") values[columns.country] = String(body.country).slice(0, 200);
    if (country?.type === "select" && body.country && country.config?.options?.some((o) => norm(o.name) === norm(body.country))) values[columns.country] = String(body.country);
    if (columns.status && body.status) values[columns.status] = String(body.status);
    const title = String(body.title ?? "").trim().slice(0, 500);
    const { row } = await api(user, "POST", `/databases/${db.id}/rows`, { title, values });
    return { place: toPlace(row, columns, db.properties) };
  });

  // Moves a place.
  nootion.route("PATCH", "/places/:rowId", async ({ user, params, body }) => {
    const db = await database(user, body?.db);
    const columns = detectColumns(db.properties, nootion.id);
    const { row } = await api(user, "PATCH", `/databases/${db.id}/rows/${params.rowId}`, { values: coordValues(columns, Number(body.lat), Number(body.lng)) });
    return { place: toPlace(row, columns, db.properties) };
  });

  // Looks up an address or a place's name. Coordinates typed or pasted (a Google Maps link…) are read as they are.
  nootion.route("GET", "/search", async ({ query }) => {
    const q = String(query.q ?? "").trim().slice(0, 300);
    const coords = parseCoords(q);
    if (coords) return { results: [{ name: formatCoords(coords.lat, coords.lng), label: "", lat: coords.lat, lng: coords.lng, country: null, kind: "coordinates" }] };
    if (q.length < 2) throw fail(400, "map_bad_query", "badQuery");
    const data = await geocoder("search", { q, limit: "6" });
    return { results: (Array.isArray(data) ? data : []).map(toResult).filter((r) => validCoords(r.lat, r.lng)) };
  });

  // What is at a point of the map (to name a place added with a click).
  nootion.route("GET", "/reverse", async ({ query }) => {
    const lat = Number(query.lat);
    const lng = Number(query.lng);
    if (!validCoords(lat, lng)) throw fail(400, "map_bad_coords", "badCoords");
    const data = await geocoder("reverse", { lat: String(lat), lon: String(lng), zoom: "18" });
    return { result: data && !data.error ? toResult({ ...data, lat, lon: lng }) : null };
  });
}
