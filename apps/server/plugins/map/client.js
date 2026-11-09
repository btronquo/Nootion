// "map" plugin, browser side: the "/map" block, and the "Place" column type.
// The block draws the places of a database as pins on a map (Leaflet, served from the plugin's assets/ folder, with
// OpenStreetMap tiles). It looks up addresses, adds a place where one clicks, and lists the places nearest to the
// user's position or to the middle of the map, so that on a trip one sees at a glance what is worth a detour.

const TEXTS = {
  en: {
    title: "Map",
    intro: "Show the places of a database on a map. A new database holds a name, a place (coordinates), an address, a country and a status (to see / seen) for each place.",
    create: "Create a \"Places to visit\" database here",
    creating: "Creating the database…",
    existing: "Or show a database that already has coordinates:",
    choose: "Choose…",
    use: "Show it",
    notSetUp: "This map isn't set up yet.",
    signIn: "Sign in to see this map.",
    loading: "Loading the map…",
    search: "Search an address, a town, a place…",
    inList: "In the list",
    searching: "Searching…",
    noResult: "Nothing found.",
    nearMe: "Near me",
    locating: "Locating…",
    add: "Add a place",
    addHint: "Click on the map where the place is, or search its address above.",
    cancel: "Cancel",
    name: "Name",
    namePlaceholder: "Name of the place",
    status: "Status",
    addToList: "Add to the list",
    adding: "Adding…",
    lookingUp: "Looking up the address…",
    all: "All",
    nearby: "Nearest places",
    aroundMe: "around you",
    aroundCenter: "around the middle of the map",
    within: "within",
    anywhere: "anywhere",
    none: "No place here yet.",
    noneNear: "No place within this distance.",
    more: "Show more",
    open: "Open",
    directions: "Directions",
    move: "Move the pin",
    moveHint: "Drag the pin, then let go to save its new place.",
    fullscreen: "Full screen",
    exitFullscreen: "Leave full screen",
    fit: "Show every place",
    openDb: "Open the database",
    otherDb: "Show another database",
    unplaced: "{n} rows without coordinates aren't on the map.",
    insecure: "Your position needs a secure (https) connection to Nootion.",
    denied: "Your position wasn't given (check the browser's permission).",
    noGeo: "This browser doesn't give its position.",
    readOnly: "You can't add places to this database.",
    placeDialog: "Place",
    coords: "Coordinates",
    coordsHelp: "Latitude, longitude: 48.85837, 2.29448. A Google Maps or OpenStreetMap link works too.",
    myPosition: "Use my position",
    save: "Save",
    clear: "Clear",
    badCoords: "Those aren't coordinates.",
    showOnMap: "Show on a map",
    km: "{n} km",
    m: "{n} m",
  },
  fr: {
    title: "Carte",
    intro: "Affichez les lieux d'une base sur une carte. Une nouvelle base garde pour chaque lieu un nom, un lieu (coordonnées), une adresse, un pays et un statut (à voir / vu).",
    create: "Créer une base « Lieux à visiter » ici",
    creating: "Création de la base…",
    existing: "Ou afficher une base qui a déjà des coordonnées :",
    choose: "Choisir…",
    use: "L'afficher",
    notSetUp: "Cette carte n'est pas encore configurée.",
    signIn: "Connectez-vous pour voir cette carte.",
    loading: "Chargement de la carte…",
    search: "Chercher une adresse, une ville, un lieu…",
    inList: "Dans la liste",
    searching: "Recherche…",
    noResult: "Rien trouvé.",
    nearMe: "Près de moi",
    locating: "Localisation…",
    add: "Ajouter un lieu",
    addHint: "Cliquez sur la carte à l'endroit du lieu, ou cherchez son adresse ci-dessus.",
    cancel: "Annuler",
    name: "Nom",
    namePlaceholder: "Nom du lieu",
    status: "Statut",
    addToList: "Ajouter à la liste",
    adding: "Ajout…",
    lookingUp: "Recherche de l'adresse…",
    all: "Tous",
    nearby: "Lieux les plus proches",
    aroundMe: "autour de vous",
    aroundCenter: "autour du centre de la carte",
    within: "dans un rayon de",
    anywhere: "partout",
    none: "Aucun lieu pour l'instant.",
    noneNear: "Aucun lieu à cette distance.",
    more: "Voir plus",
    open: "Ouvrir",
    directions: "Itinéraire",
    move: "Déplacer l'épingle",
    moveHint: "Faites glisser l'épingle, puis lâchez-la pour enregistrer sa nouvelle place.",
    fullscreen: "Plein écran",
    exitFullscreen: "Quitter le plein écran",
    fit: "Voir tous les lieux",
    openDb: "Ouvrir la base",
    otherDb: "Afficher une autre base",
    unplaced: "{n} lignes sans coordonnées ne sont pas sur la carte.",
    insecure: "Votre position demande une connexion sécurisée (https) à Nootion.",
    denied: "Votre position n'a pas été donnée (vérifiez l'autorisation du navigateur).",
    noGeo: "Ce navigateur ne donne pas sa position.",
    readOnly: "Vous ne pouvez pas ajouter de lieux à cette base.",
    placeDialog: "Lieu",
    coords: "Coordonnées",
    coordsHelp: "Latitude, longitude : 48.85837, 2.29448. Un lien Google Maps ou OpenStreetMap marche aussi.",
    myPosition: "Utiliser ma position",
    save: "Enregistrer",
    clear: "Effacer",
    badCoords: "Ce ne sont pas des coordonnées.",
    showOnMap: "Voir sur une carte",
    km: "{n} km",
    m: "{n} m",
  },
};

const RADII = [5, 20, 50, 100, 300, 0];
const PAGE = 8;

const CSS = `
.mp-box { border: 1px solid rgba(128,128,128,.3); border-radius: 8px; font-size: 14px; overflow: hidden; }
.mp-pad { padding: 12px 14px; }
.mp-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-weight: 600; font-size: 15px; }
.mp-sub { font-size: 12px; opacity: .65; font-weight: 400; }
.mp-note { font-size: 13px; margin-top: 8px; opacity: .8; }
.mp-error { color: #dc2626; font-size: 13px; margin-top: 6px; }
.mp-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.mp-input { box-sizing: border-box; border: 1px solid rgba(128,128,128,.4); border-radius: 6px; padding: 6px 8px; font-size: 14px; background: transparent; color: inherit; font-family: inherit; min-width: 0; }
.mp-input option { color: #111; }
.mp-btn { display: inline-flex; align-items: center; gap: 4px; border: 1px solid rgba(128,128,128,.35); background: transparent; color: inherit; border-radius: 6px; padding: 5px 10px; font-size: 13px; cursor: pointer; font-family: inherit; white-space: nowrap; }
.mp-btn:hover { background: rgba(128,128,128,.1); }
.mp-btn[aria-pressed="true"] { border-color: #2563eb; background: rgba(37,99,235,.14); }
.mp-btn:disabled { opacity: .5; cursor: default; }
.mp-btn.mp-primary { background: #2563eb; border-color: #2563eb; color: #fff; }
.mp-btn.mp-primary:hover { background: #1d4ed8; }
.mp-icon { padding: 5px 8px; }
.mp-bar { display: flex; gap: 6px; padding: 8px; flex-wrap: wrap; align-items: center; border-bottom: 1px solid rgba(128,128,128,.2); }
.mp-search { position: relative; flex: 1 1 220px; min-width: 0; }
.mp-search .mp-input { width: 100%; }
.mp-results { position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 1001; background: #fff; color: #111; border: 1px solid rgba(128,128,128,.35); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.18); max-height: 320px; overflow-y: auto; font-size: 13px; }
.dark .mp-results { background: #262626; color: #eee; }
.mp-results button { display: block; width: 100%; text-align: left; border: 0; background: transparent; color: inherit; padding: 7px 10px; cursor: pointer; font-family: inherit; font-size: 13px; }
.mp-results button:hover, .mp-results button[data-active="true"] { background: rgba(37,99,235,.12); }
.mp-results small { display: block; opacity: .6; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mp-results .mp-group { font-size: 11px; text-transform: uppercase; letter-spacing: .03em; opacity: .55; padding: 6px 10px 2px; }
.mp-results .mp-empty { padding: 8px 10px; opacity: .65; }
.mp-chips { display: flex; gap: 6px; flex-wrap: wrap; padding: 6px 8px 0; }
.mp-chip { border: 1px solid rgba(128,128,128,.35); background: transparent; color: inherit; border-radius: 999px; padding: 1px 10px; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; font-family: inherit; }
.mp-chip[aria-pressed="true"] { border-color: #2563eb; background: rgba(37,99,235,.14); }
.mp-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex: none; }
.mp-wrap { position: relative; }
.mp-map { height: min(62vh, 460px); min-height: 260px; z-index: 0; }
.mp-adding .mp-map, .mp-adding .mp-map .leaflet-grab { cursor: crosshair; }
.nootion-content .mp-map img, .mp-map img { margin: 0 !important; border-radius: 0 !important; max-width: none !important; }
.mp-hint { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); z-index: 1000; background: rgba(17,17,17,.82); color: #fff; font-size: 12px; padding: 5px 10px; border-radius: 6px; max-width: calc(100% - 100px); text-align: center; pointer-events: none; }
.mp-card { position: absolute; left: 8px; right: 8px; bottom: 8px; z-index: 1000; margin: 0 auto; max-width: 420px; background: #fff; color: #111; border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,.25); padding: 10px 12px; font-size: 13px; }
.dark .mp-card { background: #262626; color: #eee; }
.mp-card .mp-input { width: 100%; }
.mp-card .mp-addr { font-size: 12px; opacity: .7; margin: 4px 0 8px; }
.mp-list { padding: 8px 12px 12px; }
.mp-list-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 13px; }
.mp-list-head b { font-weight: 600; }
.mp-list-head .mp-input { padding: 2px 6px; font-size: 12px; }
.mp-box .mp-items { list-style: none !important; margin: 6px 0 0 !important; padding: 0 !important; }
.mp-box .mp-items li::before, .mp-box .mp-items li::marker { content: none !important; }
.mp-box .mp-items li { margin: 0 !important; padding: 0 !important; display: block; }
.mp-item { display: flex; align-items: center; gap: 8px; width: 100%; border: 0; background: transparent; color: inherit; text-align: left; padding: 5px 4px; border-radius: 6px; cursor: pointer; font-family: inherit; font-size: 13px; }
.mp-item:hover { background: rgba(128,128,128,.1); }
.mp-item .mp-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mp-item .mp-name small { opacity: .6; margin-left: 6px; }
.mp-item .mp-dist { font-size: 12px; opacity: .7; white-space: nowrap; font-variant-numeric: tabular-nums; }
.mp-link { background: none; border: 0; padding: 0; color: #3b82f6 !important; cursor: pointer; font-size: 12px; text-decoration: none !important; font-family: inherit; }
.mp-link:hover { text-decoration: underline !important; }
.mp-foot { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; margin-top: 8px; font-size: 12px; }
.mp-full { position: fixed !important; inset: 0; z-index: 70; background: #fff; border-radius: 0; display: flex; flex-direction: column; overflow-y: auto; }
.dark .mp-full { background: #191919; }
.mp-full .mp-map { height: 70vh; flex: none; }
.mp-pin { background: none; border: 0; }
.mp-pin svg { display: block; filter: drop-shadow(0 1px 2px rgba(0,0,0,.35)); }
.mp-pin span { position: absolute; left: 0; top: 4px; width: 28px; text-align: center; font-size: 13px; line-height: 20px; }
.mp-me { width: 14px; height: 14px; border-radius: 50%; background: #2563eb; border: 3px solid #fff; box-shadow: 0 0 0 2px rgba(37,99,235,.35), 0 1px 4px rgba(0,0,0,.4); box-sizing: border-box; }
.mp-popup { font-size: 13px; min-width: 160px; }
.mp-popup b { font-size: 14px; display: block; margin-bottom: 2px; }
.mp-popup .mp-addr { opacity: .75; font-size: 12px; margin-bottom: 4px; }
.mp-popup .mp-meta { display: flex; gap: 6px; align-items: center; font-size: 12px; margin-bottom: 6px; }
.mp-popup .mp-acts { display: flex; gap: 10px; flex-wrap: wrap; }
.mp-popup a, .mp-popup button { color: #2563eb; background: none; border: 0; padding: 0; font-size: 12px; cursor: pointer; text-decoration: none; font-family: inherit; }
.mp-popup a:hover, .mp-popup button:hover { text-decoration: underline !important; }
.mp-map .leaflet-bar a, .mp-popup a, .mp-map .leaflet-popup-close-button { text-decoration: none !important; }
.dark .mp-map .leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) brightness(.9) contrast(.9); }
.dark .mp-map .leaflet-popup-content-wrapper, .dark .mp-map .leaflet-popup-tip { background: #262626; color: #eee; }
.dark .mp-map .leaflet-control-zoom a, .dark .mp-map .leaflet-bar a { background: #262626; color: #eee; border-color: #444; }
.dark .mp-map .leaflet-control-attribution { background: rgba(30,30,30,.75); color: #bbb; }
.dark .mp-map .leaflet-control-attribution a { color: #8ab4f8; }
.mp-map .leaflet-container, .mp-map { font-family: inherit; }
.mp-cell { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 13px; }
.mp-cell button { background: none; border: 0; padding: 0; color: inherit; cursor: pointer; font: inherit; overflow: hidden; text-overflow: ellipsis; }
.mp-cell a { color: inherit; text-decoration: none; overflow: hidden; text-overflow: ellipsis; }
.mp-cell .mp-ph { opacity: .45; }
.mp-dialog { display: grid; gap: 10px; font-size: 14px; }
.mp-dialog .mp-input { width: 100%; }
.mp-dialog .mp-results { position: static; box-shadow: none; max-height: 220px; }
.mp-dialog .mp-help { font-size: 12px; opacity: .65; }
.mp-dialog .mp-acts { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
`;

/** Pin colours, by select option colour (the app's own palette, light and dark). */
const pinColor = (color) => `var(--nt-${color || "gray"}, #6b7280)`;

/** Distance in km between two points (haversine). */
export function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Same reading as the server's: "48.85837, 2.29448", "48.85837 2.29448", or a Google Maps / OpenStreetMap link. */
export function parseCoords(text) {
  if (typeof text !== "string") return null;
  const num = "(-?\\d{1,3}(?:\\.\\d+)?)";
  const m =
    text.match(new RegExp(`@${num},${num}`)) ??
    text.match(new RegExp(`[?&]mlat=${num}&mlon=${num}`)) ??
    text.match(new RegExp(`(?:^|[^\\d.])${num}\\s*[,;]\\s*${num}(?![\\d.])`)) ??
    text.trim().match(new RegExp(`^${num}\\s+${num}$`));
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

const formatCoords = (lat, lng) => `${+lat.toFixed(5)}, ${+lng.toFixed(5)}`;

const norm = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export function activate(nootion) {
  const { React } = nootion;
  const { useEffect, useMemo, useRef, useState, useCallback } = React;
  const h = React.createElement;
  const T = TEXTS[nootion.locale] ?? TEXTS.en;
  const fmt = (text, vars) => text.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
  const message = (e) => (e instanceof Error ? e.message : String(e));
  const pageUrl = (id) => `/page/${id}`;
  const assets = `/api/plugins/${nootion.id}/assets/leaflet`;
  const distanceText = (km) => (km < 1 ? fmt(T.m, { n: Math.round(km * 100) * 10 }) : fmt(T.km, { n: km < 10 ? km.toFixed(1).replace(".", nootion.locale === "fr" ? "," : ".") : Math.round(km).toLocaleString(nootion.locale) }));
  const isEmoji = (icon) => typeof icon === "string" && icon.length > 0 && icon.length <= 8 && !icon.includes("/");

  if (!document.getElementById("nootion-map-css")) {
    const style = document.createElement("style");
    style.id = "nootion-map-css";
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // --- Leaflet, loaded the first time a map is shown --------------------------------------------

  let leaflet = null;
  function loadLeaflet() {
    if (window.L?.map) return Promise.resolve(window.L);
    if (leaflet) return leaflet;
    leaflet = new Promise((resolve, reject) => {
      if (!document.getElementById("nootion-leaflet-css")) {
        const link = document.createElement("link");
        link.id = "nootion-leaflet-css";
        link.rel = "stylesheet";
        link.href = `${assets}/leaflet.css`;
        document.head.appendChild(link);
      }
      const script = document.createElement("script");
      script.src = `${assets}/leaflet.js`;
      script.onload = () => (window.L?.map ? resolve(window.L) : reject(new Error("Leaflet")));
      script.onerror = () => {
        leaflet = null;
        reject(new Error("Leaflet can't be loaded"));
      };
      document.head.appendChild(script);
    });
    return leaflet;
  }

  let config = null;
  const loadConfig = () => (config ??= nootion.api("/config").catch((e) => ((config = null), Promise.reject(e))));

  /** Address search, shared by the block and the "Place" cell: results a moment after typing stops. */
  function useSearch(query) {
    const [state, setState] = useState({ results: [], busy: false, error: null, for: "" });
    useEffect(() => {
      const q = query.trim();
      if (q.length < 3 && !parseCoords(q)) {
        setState({ results: [], busy: false, error: null, for: "" });
        return;
      }
      let gone = false;
      setState((s) => ({ ...s, busy: true }));
      const timer = setTimeout(() => {
        nootion
          .api(`/search?q=${encodeURIComponent(q)}`)
          .then((r) => !gone && setState({ results: r.results, busy: false, error: null, for: q }))
          .catch((e) => !gone && setState({ results: [], busy: false, error: message(e), for: q }));
      }, 450);
      return () => {
        gone = true;
        clearTimeout(timer);
      };
    }, [query]);
    return state;
  }

  /**
   * Keeps the editor (ProseMirror) from taking clicks, drags and keys meant for the map. Only for elements drawn by
   * Leaflet: React listens at its root, so stopping events there would also stop React's own handlers. (The editor
   * already leaves alone the inputs and buttons of a block.)
   */
  const ALL_EVENTS = ["mousedown", "pointerdown", "touchstart", "click", "dblclick", "contextmenu", "keydown", "keyup", "keypress", "paste", "copy", "cut"];
  const PRESS_EVENTS = ["mousedown", "pointerdown", "touchstart"];
  function useIsolated(ref, types = ALL_EVENTS) {
    useEffect(() => {
      const el = ref.current;
      if (!el) return;
      const stop = (e) => e.stopPropagation();
      types.forEach((t) => el.addEventListener(t, stop));
      return () => types.forEach((t) => el.removeEventListener(t, stop));
    }, [ref]);
  }

  // --- Setup: create a database or pick one ------------------------------------------------------

  function Setup({ setData, editable, pageId }) {
    const [dbs, setDbs] = useState(null);
    const [picked, setPicked] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => {
      if (!editable) return;
      nootion
        .api("/databases")
        .then((r) => setDbs(r.databases))
        .catch((e) => setError(message(e)));
    }, [editable]);
    const create = async () => {
      setBusy(true);
      setError(null);
      try {
        const { databaseId } = await nootion.api("/databases", { method: "POST", body: { pageId } });
        setData({ databaseId });
      } catch (e) {
        setError(message(e));
        setBusy(false);
      }
    };
    return h(
      "div",
      { className: "mp-box mp-pad" },
      h("div", { className: "mp-head" }, "🗺️ ", T.title),
      !editable
        ? h("div", { className: "mp-note" }, T.notSetUp)
        : h(
            React.Fragment,
            null,
            h("div", { className: "mp-note" }, T.intro),
            h("div", { className: "mp-row" }, h("button", { type: "button", className: "mp-btn mp-primary", disabled: busy || !pageId, onClick: create }, busy ? T.creating : `📍 ${T.create}`)),
            dbs &&
              dbs.length > 0 &&
              h(
                "div",
                { className: "mp-row" },
                h("span", { className: "mp-sub" }, T.existing),
                h(
                  "select",
                  { className: "mp-input", value: picked, onChange: (e) => setPicked(e.target.value) },
                  h("option", { value: "" }, T.choose),
                  dbs.map((d) => h("option", { key: d.id, value: d.id }, `${isEmoji(d.icon) ? `${d.icon} ` : ""}${d.title || "—"}`)),
                ),
                h("button", { type: "button", className: "mp-btn", disabled: !picked, onClick: () => setData({ databaseId: picked }) }, T.use),
              ),
          ),
      error && h("div", { className: "mp-error", role: "alert" }, error),
    );
  }

  // --- The map ----------------------------------------------------------------------------------

  function pinIcon(L, color, icon, draft) {
    const fill = draft ? "#6b7280" : pinColor(color);
    const inner = isEmoji(icon) && !draft ? `<span>${icon.replace(/[<>&"]/g, "")}</span>` : "";
    const dot = inner ? `<circle cx="14" cy="14" r="9" fill="#fff"/>` : `<circle cx="14" cy="14" r="4.5" fill="#fff"/>`;
    return L.divIcon({
      className: "mp-pin",
      html: `<svg width="28" height="38" viewBox="0 0 28 38" aria-hidden="true"><path d="M14 37s12-12.4 12-23A12 12 0 0 0 2 14c0 10.6 12 23 12 23z" fill="${fill}" stroke="#fff" stroke-width="2"${draft ? ' stroke-dasharray="3 2"' : ""}/>${dot}</svg>${inner}`,
      iconSize: [28, 38],
      iconAnchor: [14, 37],
      popupAnchor: [0, -32],
    });
  }

  function MapView({ data, setData, editable }) {
    const boxRef = useRef(null);
    const mapEl = useRef(null);
    const map = useRef(null);
    const L = useRef(null);
    const layer = useRef(null);
    const markers = useRef(new Map());
    const draftMarker = useRef(null);
    const meMarker = useRef(null);
    const fitted = useRef(false);
    const modeRef = useRef({ adding: false, canAdd: false });

    const [ready, setReady] = useState(false);
    const [info, setInfo] = useState(null);
    const [error, setError] = useState(null);
    const [signIn, setSignIn] = useState(false);
    const [query, setQuery] = useState("");
    const [focus, setFocus] = useState(false);
    const [active, setActive] = useState(-1);
    const [shown, setShown] = useState(null); // status ids shown; null: all
    const [me, setMe] = useState(null);
    const [locating, setLocating] = useState(false);
    const [center, setCenter] = useState(null);
    const [radius, setRadius] = useState(() => (typeof data.radius === "number" ? data.radius : 50));
    const [limit, setLimit] = useState(PAGE);
    const [adding, setAdding] = useState(false);
    const [draft, setDraft] = useState(null);
    const [full, setFull] = useState(false);
    const [moving, setMoving] = useState(null);
    useIsolated(mapEl);
    // A press anywhere in the block (but on its handle) mustn't select the whole block in the editor. Presses only:
    // React's click handlers below still get their clicks.
    useIsolated(boxRef, PRESS_EVENTS);

    const canAdd = editable && !!info?.database.canEdit && !!(info.columns.place || info.columns.lat);
    modeRef.current = { adding, canAdd };
    const search = useSearch(query);

    const load = useCallback(async () => {
      try {
        const r = await nootion.api(`/places?db=${encodeURIComponent(data.databaseId)}`);
        setInfo(r);
        setError(null);
      } catch (e) {
        if (e?.status === 401) setSignIn(true);
        else setError(message(e));
      }
    }, [data.databaseId]);

    useEffect(() => {
      load();
      const again = () => document.visibilityState === "visible" && load();
      document.addEventListener("visibilitychange", again);
      return () => document.removeEventListener("visibilitychange", again);
    }, [load]);

    // The map itself, made once.
    useEffect(() => {
      let gone = false;
      Promise.all([loadLeaflet(), loadConfig()])
        .then(([leafletLib, cfg]) => {
          if (gone || !mapEl.current) return;
          L.current = leafletLib;
          const m = leafletLib.map(mapEl.current, { worldCopyJump: true, zoomControl: true }).setView([46.6, 2.4], 5);
          leafletLib.tileLayer(cfg.tileUrl, { maxZoom: 19, attribution: cfg.attribution }).addTo(m);
          layer.current = leafletLib.layerGroup().addTo(m);
          const pick = (e) => {
            if (!modeRef.current.canAdd) return;
            startDraftRef.current({ lat: e.latlng.lat, lng: e.latlng.lng }, null);
          };
          m.on("click", (e) => modeRef.current.adding && pick(e));
          m.on("contextmenu", pick); // right click, or a long press on a phone
          m.on("moveend", () => {
            const c = m.getCenter();
            setCenter({ lat: c.lat, lng: ((((c.lng + 180) % 360) + 360) % 360) - 180 });
          });
          map.current = m;
          setCenter({ lat: 46.6, lng: 2.4 });
          setReady(true);
        })
        .catch((e) => !gone && setError(message(e)));
      return () => {
        gone = true;
        map.current?.remove();
        map.current = null;
      };
    }, []);

    // Follows the block's size (columns, full screen, a narrowed window).
    useEffect(() => {
      if (!ready || !mapEl.current || typeof ResizeObserver === "undefined") return;
      const ro = new ResizeObserver(() => map.current?.invalidateSize());
      ro.observe(mapEl.current);
      return () => ro.disconnect();
    }, [ready]);

    const statuses = info?.statuses ?? [];
    const statusOf = (id) => statuses.find((s) => s.id === id);
    const visible = useMemo(() => (info?.places ?? []).filter((p) => !shown || shown.includes(p.status ?? "")), [info, shown]);

    // Pins.
    useEffect(() => {
      if (!ready || !info) return;
      const lib = L.current;
      layer.current.clearLayers();
      markers.current.clear();
      for (const p of visible) {
        const marker = lib.marker([p.lat, p.lng], { icon: pinIcon(lib, statusOf(p.status)?.color, p.icon), title: p.title, riseOnHover: true });
        marker.bindPopup(() => popupFor(p, marker), { maxWidth: 260 });
        marker.addTo(layer.current);
        markers.current.set(p.id, marker);
      }
      if (!fitted.current) {
        fitted.current = true;
        fitAll(visible, false);
      }
    }, [ready, info, visible]);

    function fitAll(places = visible, animate = true) {
      const m = map.current;
      if (!m || places.length === 0) return;
      if (places.length === 1) m.setView([places[0].lat, places[0].lng], 12, { animate });
      else m.fitBounds(places.map((p) => [p.lat, p.lng]), { padding: [30, 30], maxZoom: 13, animate });
    }

    function popupFor(p, marker) {
      const el = document.createElement("div");
      el.className = "mp-popup";
      const add = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        el.appendChild(n);
        return n;
      };
      add("b", null, `${isEmoji(p.icon) ? `${p.icon} ` : ""}${p.title || "—"}`);
      if (p.address) add("div", "mp-addr", p.address);
      const meta = add("div", "mp-meta");
      const st = statusOf(p.status);
      if (st) {
        const dot = document.createElement("span");
        dot.className = "mp-dot";
        dot.style.background = pinColor(st.color);
        meta.append(dot, document.createTextNode(st.name));
      }
      const ref = meRef.current;
      if (ref) meta.append(document.createTextNode(`${st ? " · " : ""}${distanceText(distanceKm(ref, p))}`));
      if (p.country && !(p.address ?? "").includes(p.country)) meta.append(document.createTextNode(` · ${p.country}`));
      if (!meta.childNodes.length) meta.remove();
      const acts = add("div", "mp-acts");
      const open = document.createElement("a");
      open.href = pageUrl(p.id);
      open.textContent = `↗ ${T.open}`;
      const go = document.createElement("a");
      go.href = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
      go.target = "_blank";
      go.rel = "noopener noreferrer";
      go.textContent = `🧭 ${T.directions}`;
      acts.append(open, go);
      if (canAddRef.current) {
        const mv = document.createElement("button");
        mv.type = "button";
        mv.textContent = `✥ ${T.move}`;
        mv.onclick = () => {
          marker.closePopup();
          marker.dragging.enable();
          setMoving(p.id);
          marker.once("dragend", async () => {
            marker.dragging.disable();
            const { lat, lng } = marker.getLatLng();
            try {
              await nootion.api(`/places/${p.id}`, { method: "PATCH", body: { db: data.databaseId, lat, lng } });
              await load();
            } catch (e) {
              setError(message(e));
            }
            setMoving(null);
          });
        };
        acts.append(mv);
      }
      return el;
    }
    const canAddRef = useRef(false);
    canAddRef.current = canAdd;
    const meRef = useRef(null);
    meRef.current = me;
    const startDraftRef = useRef(null);
    startDraftRef.current = startDraft;

    // The place being added: a dashed pin that can be dragged, and a card to name it.
    function startDraft(at, found) {
      setAdding(false);
      setDraft({ lat: at.lat, lng: at.lng, title: found?.name ?? "", address: found?.label ?? "", country: found?.country ?? null, status: defaultStatus(), looking: !found, busy: false, error: null });
      if (!found) {
        nootion
          .api(`/reverse?lat=${at.lat}&lng=${at.lng}`)
          .then(({ result }) =>
            setDraft((d) =>
              d && d.lat === at.lat && d.lng === at.lng
                ? { ...d, looking: false, title: d.title || result?.name || "", address: result?.label ?? "", country: result?.country ?? null }
                : d,
            ),
          )
          .catch(() => setDraft((d) => (d ? { ...d, looking: false } : d)));
      }
    }
    const defaultStatus = () => (statuses.find((s) => s.id === "todo") ?? statuses[0])?.id ?? null;

    useEffect(() => {
      const lib = L.current;
      const m = map.current;
      if (!ready || !lib || !m) return;
      if (!draft) {
        draftMarker.current?.remove();
        draftMarker.current = null;
        return;
      }
      if (!draftMarker.current) {
        draftMarker.current = lib.marker([draft.lat, draft.lng], { icon: pinIcon(lib, null, null, true), draggable: canAdd, zIndexOffset: 1000 }).addTo(m);
        draftMarker.current.on("dragend", () => {
          const { lat, lng } = draftMarker.current.getLatLng();
          setDraft((d) => (d ? { ...d, lat, lng } : d));
        });
      } else draftMarker.current.setLatLng([draft.lat, draft.lng]);
    }, [ready, draft?.lat, draft?.lng, !!draft]);

    const saveDraft = async () => {
      setDraft((d) => ({ ...d, busy: true, error: null }));
      try {
        await nootion.api("/places", {
          method: "POST",
          body: { db: data.databaseId, title: draft.title.trim(), lat: draft.lat, lng: draft.lng, address: draft.address || null, country: draft.country, status: draft.status },
        });
        setDraft(null);
        await load();
      } catch (e) {
        setDraft((d) => ({ ...d, busy: false, error: message(e) }));
      }
    };

    // Where the user is.
    const locate = () => {
      if (!window.isSecureContext) return setError(T.insecure);
      if (!navigator.geolocation) return setError(T.noGeo);
      setLocating(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocating(false);
          setError(null);
          const at = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setMe(at);
          map.current?.setView([at.lat, at.lng], 11);
        },
        (e) => {
          setLocating(false);
          setError(e.code === 1 ? T.denied : message(e.message || e));
        },
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 5 * 60 * 1000 },
      );
    };
    useEffect(() => {
      const lib = L.current;
      if (!ready || !lib || !me) return;
      meMarker.current?.remove();
      meMarker.current = lib.marker([me.lat, me.lng], { icon: lib.divIcon({ className: "", html: '<div class="mp-me"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }), interactive: false, zIndexOffset: 500 }).addTo(map.current);
    }, [ready, me]);

    const flyTo = (p, zoom = 14) => {
      const m = map.current;
      if (!m) return;
      m.setView([p.lat, p.lng], Math.max(m.getZoom(), zoom));
      const marker = markers.current.get(p.id);
      if (marker) setTimeout(() => marker.openPopup(), 50);
    };

    // Full screen: the box covers the window; Escape leaves it.
    useEffect(() => {
      setTimeout(() => map.current?.invalidateSize(), 60);
      if (!full) return;
      const esc = (e) => e.key === "Escape" && setFull(false);
      document.addEventListener("keydown", esc);
      document.body.style.overflow = "hidden";
      return () => {
        document.removeEventListener("keydown", esc);
        document.body.style.overflow = "";
      };
    }, [full]);

    // Nearest places, to the user's position or to the middle of the map.
    const origin = me ?? center;
    const near = useMemo(() => {
      if (!origin) return [];
      return visible
        .map((p) => ({ p, d: distanceKm(origin, p) }))
        .filter((x) => !radius || x.d <= radius)
        .sort((a, b) => a.d - b.d);
    }, [visible, origin?.lat, origin?.lng, radius]);

    // Search: places of the list first, then addresses.
    const q = norm(query.trim());
    const local = q.length >= 2 ? (info?.places ?? []).filter((p) => norm(`${p.title} ${p.address ?? ""} ${p.country ?? ""}`).includes(q)).slice(0, 5) : [];
    const found = search.for ? search.results : [];
    const options = [...local.map((p) => ({ kind: "place", p })), ...found.map((r) => ({ kind: "result", r }))];
    const choose = (o) => {
      setFocus(false);
      setActive(-1);
      if (o.kind === "place") {
        flyTo(o.p);
        return;
      }
      const r = o.r;
      map.current?.setView([r.lat, r.lng], r.kind === "city" || r.kind === "administrative" ? 11 : 14);
      if (canAdd) startDraft({ lat: r.lat, lng: r.lng }, r);
    };
    const onKey = (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(options.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(-1, i - 1));
      } else if (e.key === "Enter" && options.length) {
        e.preventDefault();
        choose(options[Math.max(0, active)]);
      } else if (e.key === "Escape") setFocus(false);
    };

    if (signIn) return h("div", { className: "mp-box mp-pad" }, h("div", { className: "mp-head" }, "🗺️ ", T.title), h("div", { className: "mp-note" }, T.signIn));

    const btn = (props, ...children) => h("button", { type: "button", className: "mp-btn", ...props }, ...children);

    return h(
      "div",
      { className: `mp-box${full ? " mp-full" : ""}`, ref: boxRef, "data-map": "" },
      h(
        "div",
        { className: "mp-bar" },
        h(
          "div",
          { className: "mp-search" },
          h("input", {
            className: "mp-input",
            type: "search",
            value: query,
            placeholder: T.search,
            "aria-label": T.search,
            onChange: (e) => {
              setQuery(e.target.value);
              setFocus(true);
              setActive(-1);
            },
            onFocus: () => setFocus(true),
            onBlur: () => setTimeout(() => setFocus(false), 250),
            onKeyDown: onKey,
          }),
          focus &&
            q.length >= 2 &&
            h(
              "div",
              { className: "mp-results", role: "listbox" },
              local.length > 0 && h("div", { className: "mp-group" }, T.inList),
              options.map((o, i) =>
                h(
                  "button",
                  { key: o.kind === "place" ? `p${o.p.id}` : `r${i}`, type: "button", role: "option", "data-active": i === active, onClick: () => choose(o) },
                  o.kind === "place" ? `📍 ${o.p.title || "—"}` : o.r.name,
                  h("small", null, o.kind === "place" ? o.p.address ?? o.p.country ?? "" : o.r.label),
                ),
              ),
              search.busy && h("div", { className: "mp-empty" }, T.searching),
              !search.busy && search.error && h("div", { className: "mp-empty mp-error" }, search.error),
              !search.busy && !search.error && search.for && options.length === 0 && h("div", { className: "mp-empty" }, T.noResult),
            ),
        ),
        btn({ onClick: locate, disabled: locating || !ready, "aria-pressed": !!me, title: T.nearMe }, "📍 ", locating ? T.locating : T.nearMe),
        canAdd && btn({ onClick: () => (setDraft(null), setAdding(!adding)), "aria-pressed": adding }, "＋ ", T.add),
        btn({ className: "mp-btn mp-icon", onClick: () => fitAll(), disabled: !visible.length, title: T.fit, "aria-label": T.fit }, "⤢"),
        btn({ className: "mp-btn mp-icon", onClick: () => setFull(!full), title: full ? T.exitFullscreen : T.fullscreen, "aria-label": full ? T.exitFullscreen : T.fullscreen }, full ? "✕" : "⛶"),
      ),
      statuses.length > 1 &&
        h(
          "div",
          { className: "mp-chips" },
          h("button", { type: "button", className: "mp-chip", "aria-pressed": !shown, onClick: () => setShown(null) }, T.all),
          statuses.map((s) =>
            h(
              "button",
              {
                key: s.id,
                type: "button",
                className: "mp-chip",
                "aria-pressed": !!shown?.includes(s.id),
                onClick: () => {
                  const next = shown?.includes(s.id) ? shown.filter((x) => x !== s.id) : [...(shown ?? []), s.id];
                  setShown(next.length ? next : null);
                },
              },
              h("span", { className: "mp-dot", style: { background: pinColor(s.color) } }),
              s.name,
            ),
          ),
        ),
      h(
        "div",
        { className: `mp-wrap${adding ? " mp-adding" : ""}`, style: { marginTop: statuses.length > 1 ? 6 : 0 } },
        // Leaflet adds its own classes to this element: React must never rewrite its className.
        h("div", { ref: mapEl, className: "mp-map" }),
        !ready && !error && h("div", { className: "mp-hint" }, T.loading),
        adding && h("div", { className: "mp-hint" }, T.addHint),
        moving && h("div", { className: "mp-hint" }, T.moveHint),
        draft &&
          h(
            "div",
            { className: "mp-card" },
            h("input", {
              className: "mp-input",
              value: draft.title,
              placeholder: T.namePlaceholder,
              "aria-label": T.name,
              autoFocus: true,
              onChange: (e) => setDraft({ ...draft, title: e.target.value }),
              onKeyDown: (e) => {
                if (e.key === "Enter" && !draft.busy) saveDraft();
                if (e.key === "Escape") setDraft(null);
              },
            }),
            h("div", { className: "mp-addr" }, draft.looking ? T.lookingUp : draft.address || formatCoords(draft.lat, draft.lng)),
            h(
              "div",
              { className: "mp-row", style: { marginTop: 0 } },
              statuses.length > 0 &&
                h(
                  "select",
                  { className: "mp-input", style: { width: "auto" }, value: draft.status ?? "", "aria-label": T.status, onChange: (e) => setDraft({ ...draft, status: e.target.value || null }) },
                  statuses.map((s) => h("option", { key: s.id, value: s.id }, s.name)),
                ),
              h("span", { style: { flex: 1 } }),
              btn({ onClick: () => setDraft(null) }, T.cancel),
              btn({ className: "mp-btn mp-primary", disabled: draft.busy, onClick: saveDraft }, draft.busy ? T.adding : T.addToList),
            ),
            draft.error && h("div", { className: "mp-error", role: "alert" }, draft.error),
          ),
      ),
      error && h("div", { className: "mp-error mp-pad", role: "alert", style: { paddingTop: 6, paddingBottom: 0 } }, error),
      h(
        "div",
        { className: "mp-list" },
        h(
          "div",
          { className: "mp-list-head" },
          h("b", null, T.nearby),
          h("span", { className: "mp-sub" }, me ? T.aroundMe : T.aroundCenter, ", ", T.within),
          h(
            "select",
            {
              className: "mp-input",
              value: radius,
              onChange: (e) => {
                const r = Number(e.target.value);
                setRadius(r);
                setLimit(PAGE);
                if (editable) setData({ ...data, radius: r });
              },
            },
            RADII.map((r) => h("option", { key: r, value: r }, r ? fmt(T.km, { n: r }) : T.anywhere)),
          ),
        ),
        info && !info.places.length
          ? h("div", { className: "mp-note" }, T.none)
          : near.length === 0 && info
            ? h("div", { className: "mp-note" }, T.noneNear)
            : h(
                "ul",
                { className: "mp-items" },
                near.slice(0, limit).map(({ p, d }) => {
                  const st = statusOf(p.status);
                  return h(
                    "li",
                    { key: p.id },
                    h(
                      "button",
                      { type: "button", className: "mp-item", onClick: () => flyTo(p) },
                      h("span", { className: "mp-dot", style: { background: pinColor(st?.color) }, title: st?.name }),
                      h("span", { className: "mp-name" }, `${isEmoji(p.icon) ? `${p.icon} ` : ""}${p.title || "—"}`, p.country && h("small", null, p.country)),
                      h("span", { className: "mp-dist" }, distanceText(d)),
                    ),
                  );
                }),
              ),
        near.length > limit && h("button", { type: "button", className: "mp-link", onClick: () => setLimit(limit + PAGE * 2) }, T.more),
        h(
          "div",
          { className: "mp-foot" },
          info && h("a", { className: "mp-link", href: pageUrl(info.database.id) }, `${isEmoji(info.database.icon) ? info.database.icon : "🗂️"} ${T.openDb}`),
          editable && h("button", { type: "button", className: "mp-link", onClick: () => setData({}) }, T.otherDb),
          info?.unplaced > 0 && h("span", { className: "mp-sub" }, fmt(T.unplaced, { n: info.unplaced })),
          info && editable && !canAdd && info.database && !info.database.canEdit && h("span", { className: "mp-sub" }, T.readOnly),
        ),
      ),
    );
  }

  function MapBlock(props) {
    return props.data?.databaseId ? h(MapView, { ...props, key: props.data.databaseId }) : h(Setup, props);
  }

  // --- The "Place" column type --------------------------------------------------------------------

  function PlaceDialog({ value, close }) {
    const [text, setText] = useState(value ?? "");
    const [query, setQuery] = useState("");
    const [error, setError] = useState(null);
    const [locating, setLocating] = useState(false);
    const search = useSearch(query);
    const { Modal, Button } = nootion.ui;
    const save = () => {
      if (!text.trim()) return close({ value: null });
      const c = parseCoords(text);
      if (!c) return setError(T.badCoords);
      close({ value: formatCoords(c.lat, c.lng) });
    };
    const locate = () => {
      if (!window.isSecureContext) return setError(T.insecure);
      if (!navigator.geolocation) return setError(T.noGeo);
      setLocating(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocating(false);
          setText(formatCoords(pos.coords.latitude, pos.coords.longitude));
        },
        (e) => {
          setLocating(false);
          setError(e.code === 1 ? T.denied : String(e.message || e));
        },
        { timeout: 15000 },
      );
    };
    return h(
      Modal,
      { title: `📍 ${T.placeDialog}`, onClose: () => close() },
      h(
        "div",
        { className: "mp-dialog" },
        h("input", { className: "mp-input", type: "search", value: query, placeholder: T.search, autoFocus: true, onChange: (e) => setQuery(e.target.value) }),
        (search.busy || search.for) &&
          h(
            "div",
            { className: "mp-results" },
            search.results.map((r, i) =>
              h(
                "button",
                {
                  key: i,
                  type: "button",
                  onClick: () => {
                    setText(formatCoords(r.lat, r.lng));
                    setError(null);
                  },
                },
                r.name,
                h("small", null, r.label),
              ),
            ),
            search.busy && h("div", { className: "mp-empty" }, T.searching),
            !search.busy && search.error && h("div", { className: "mp-empty mp-error" }, search.error),
            !search.busy && !search.error && search.for && !search.results.length && h("div", { className: "mp-empty" }, T.noResult),
          ),
        h(
          "label",
          { style: { display: "grid", gap: 4, fontSize: 12 } },
          T.coords,
          h("input", {
            className: "mp-input",
            value: text,
            placeholder: "48.85837, 2.29448",
            onChange: (e) => {
              setText(e.target.value);
              setError(null);
            },
            onKeyDown: (e) => e.key === "Enter" && save(),
          }),
          h("span", { className: "mp-help" }, T.coordsHelp),
        ),
        error && h("div", { className: "mp-error", role: "alert" }, error),
        h(
          "div",
          { className: "mp-acts" },
          h(Button, { variant: "ghost", onClick: locate, disabled: locating }, `📍 ${locating ? T.locating : T.myPosition}`),
          h("span", { style: { flex: 1 } }),
          value && h(Button, { variant: "ghost", onClick: () => close({ value: null }) }, T.clear),
          h(Button, { variant: "primary", onClick: save }, T.save),
        ),
      ),
    );
  }

  function PlaceCell({ value, setValue, editable }) {
    const c = parseCoords(value ?? "");
    const label = c ? formatCoords(c.lat, c.lng) : value;
    const osm = c ? `https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lng}#map=15/${c.lat}/${c.lng}` : null;
    const edit = async (e) => {
      e.stopPropagation();
      const r = await nootion.ui.showDialog((close) => h(PlaceDialog, { value, close }));
      if (r) setValue(r.value);
    };
    if (!editable) {
      return value ? h("span", { className: "mp-cell" }, osm ? h("a", { href: osm, target: "_blank", rel: "noopener noreferrer", title: T.showOnMap, onClick: (e) => e.stopPropagation() }, `📍 ${label}`) : label) : null;
    }
    return h(
      "span",
      { className: "mp-cell" },
      h("button", { type: "button", onClick: edit }, value ? `📍 ${label}` : h("span", { className: "mp-ph" }, "📍")),
      osm && h("a", { href: osm, target: "_blank", rel: "noopener noreferrer", title: T.showOnMap, "aria-label": T.showOnMap, onClick: (e) => e.stopPropagation(), style: { opacity: 0.55, fontSize: 11 } }, "↗"),
    );
  }

  nootion.registerBlock("map", MapBlock);
  nootion.registerPropertyType("place", { Cell: PlaceCell });
}
