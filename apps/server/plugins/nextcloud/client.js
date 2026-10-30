// "nextcloud" plugin, browser side: a file picker (copies files into pages and "File" columns) and a link block.

const TEXTS = {
  en: {
    title: "Nextcloud",
    files: "Files",
    search: "Search in Nextcloud",
    empty: "This folder is empty.",
    noResult: "No file matches.",
    loading: "Loading…",
    insert: "Insert",
    insertN: "Insert {n} files",
    insertLink: "Insert the link",
    copying: "Copying…",
    cancel: "Cancel",
    close: "Close",
    connectedAs: "Connected as {name}",
    disconnect: "Disconnect",
    notConfigured: "The administrator hasn't set the Nextcloud address yet, in Administration › Plugins.",
    connectIntro: "Connect your Nextcloud account to pick your files. Nootion only sees what your account can see, and you can disconnect at any time.",
    connect: "Connect to Nextcloud",
    waiting: "Allow Nootion in the Nextcloud tab that just opened, then come back here.",
    usePassword: "Use an app password instead",
    login: "Nextcloud login",
    appPassword: "App password",
    appPasswordHelp: "Create one in Nextcloud: Settings › Security › Devices & sessions.",
    connectSubmit: "Connect",
    choose: "Choose a file or folder in Nextcloud",
    change: "Change",
    open: "Open in Nextcloud",
    folder: "Folder",
    selectFolder: "Choose this folder",
  },
  fr: {
    title: "Nextcloud",
    files: "Fichiers",
    search: "Rechercher dans Nextcloud",
    empty: "Ce dossier est vide.",
    noResult: "Aucun fichier ne correspond.",
    loading: "Chargement…",
    insert: "Insérer",
    insertN: "Insérer {n} fichiers",
    insertLink: "Insérer le lien",
    copying: "Copie en cours…",
    cancel: "Annuler",
    close: "Fermer",
    connectedAs: "Connecté en tant que {name}",
    disconnect: "Se déconnecter",
    notConfigured: "L'administrateur n'a pas encore indiqué l'adresse de Nextcloud, dans Administration › Plugins.",
    connectIntro:
      "Connectez votre compte Nextcloud pour choisir vos fichiers. Nootion ne voit que ce que votre compte peut voir, et vous pouvez vous déconnecter à tout moment.",
    connect: "Se connecter à Nextcloud",
    waiting: "Autorisez Nootion dans l'onglet Nextcloud qui vient de s'ouvrir, puis revenez ici.",
    usePassword: "Utiliser plutôt un mot de passe d'application",
    login: "Identifiant Nextcloud",
    appPassword: "Mot de passe d'application",
    appPasswordHelp: "Créez-en un dans Nextcloud : Paramètres › Sécurité › Appareils et sessions.",
    connectSubmit: "Connecter",
    choose: "Choisir un fichier ou un dossier dans Nextcloud",
    change: "Changer",
    open: "Ouvrir dans Nextcloud",
    folder: "Dossier",
    selectFolder: "Choisir ce dossier",
  },
};

const CSS = `
.nc-list { max-height: 50vh; overflow-y: auto; border: 1px solid rgba(128,128,128,.25); border-radius: 8px; }
.nc-row { display: flex; align-items: center; gap: 10px; padding: 6px 10px; cursor: pointer; font-size: 14px; }
.nc-row + .nc-row { border-top: 1px solid rgba(128,128,128,.12); }
.nc-row:hover { background: rgba(128,128,128,.10); }
.nc-row.nc-selected { background: rgba(59,130,246,.14); }
.nc-thumb { width: 32px; height: 32px; flex: none; border-radius: 4px; object-fit: cover; display: flex; align-items: center; justify-content: center; font-size: 20px; }
.nc-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nc-sub { font-size: 12px; opacity: .6; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nc-meta { font-size: 12px; opacity: .6; white-space: nowrap; }
.nc-input { width: 100%; box-sizing: border-box; border: 1px solid rgba(128,128,128,.4); border-radius: 6px; padding: 7px 10px; font-size: 14px; background: transparent; color: inherit; outline: none; }
.nc-input:focus { border-color: #3b82f6; }
.nc-crumbs { display: flex; flex-wrap: wrap; gap: 2px; align-items: center; font-size: 13px; margin: 10px 0 8px; }
.nc-crumbs button { background: none; border: 0; padding: 2px 4px; border-radius: 4px; color: inherit; cursor: pointer; }
.nc-crumbs button:hover { background: rgba(128,128,128,.12); }
.nc-link { background: none; border: 0; padding: 0; color: #3b82f6; cursor: pointer; font-size: 13px; }
.nc-link:hover { text-decoration: underline; }
.nc-error { color: #dc2626; font-size: 13px; margin-top: 8px; }
.nc-card { display: flex; align-items: center; gap: 10px; border: 1px solid rgba(128,128,128,.3); border-radius: 8px; padding: 8px 12px; }
.nc-card a { color: inherit; text-decoration: none; font-weight: 500; }
.nc-card a:hover { text-decoration: underline; }
.nc-choose { display: flex; align-items: center; gap: 8px; width: 100%; border: 1px dashed rgba(128,128,128,.45); border-radius: 8px; padding: 10px 12px; background: none; color: inherit; opacity: .75; cursor: pointer; font-size: 14px; text-align: left; }
.nc-choose:hover { opacity: 1; background: rgba(128,128,128,.08); }
`;

function iconOf(entry) {
  if (entry.folder) return "📁";
  const type = entry.mimeType ?? "";
  if (type.startsWith("image/")) return "🖼️";
  if (type.startsWith("video/")) return "🎞️";
  if (type.startsWith("audio/")) return "🎵";
  if (type === "application/pdf") return "📕";
  if (/sheet|excel|csv/.test(type)) return "📊";
  if (/presentation|powerpoint/.test(type)) return "📽️";
  if (/zip|compressed|tar|7z|rar/.test(type)) return "🗜️";
  if (type.startsWith("text/") || /document|word|opendocument\.text/.test(type)) return "📝";
  return "📄";
}

function formatSize(bytes, locale) {
  if (!bytes) return "";
  const units = locale === "fr" ? ["o", "Ko", "Mo", "Go"] : ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) ((n /= 1024), i++);
  return `${n.toLocaleString(locale, { maximumFractionDigits: i ? 1 : 0 })} ${units[i]}`;
}

const parentOf = (path) => path.slice(0, path.lastIndexOf("/")) || "/";

export function activate(nootion) {
  const { React } = nootion;
  const { useEffect, useRef, useState } = React;
  const h = React.createElement;
  const { Modal, Button, showDialog } = nootion.ui;
  const T = TEXTS[nootion.locale] ?? TEXTS.en;
  const fmt = (text, vars) => text.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
  const message = (e) => (e instanceof Error ? e.message : String(e));

  if (!document.getElementById("nootion-nextcloud-css")) {
    const style = document.createElement("style");
    style.id = "nootion-nextcloud-css";
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  /** Connecting an account: the Nextcloud login page in a new tab, or an app password typed here. */
  function Connect({ onConnected }) {
    const [waiting, setWaiting] = useState(false);
    const [manual, setManual] = useState(false);
    const [login, setLogin] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
      if (!waiting) return;
      let stop = false;
      const timer = setInterval(async () => {
        try {
          const res = await nootion.api("/login/poll", { method: "POST" });
          if (res.connected && !stop) onConnected();
        } catch (e) {
          if (!stop) (setError(message(e)), setWaiting(false));
        }
      }, 2000);
      return () => ((stop = true), clearInterval(timer));
    }, [waiting]);

    async function start() {
      setError(null);
      // Opened right away, during the click, so that the browser doesn't block it.
      const tab = window.open("about:blank", "_blank");
      try {
        const { url } = await nootion.api("/login", { method: "POST" });
        if (tab) tab.location.href = url;
        else window.open(url, "_blank");
        setWaiting(true);
      } catch (e) {
        tab?.close();
        setError(message(e));
      }
    }

    async function submit(e) {
      e.preventDefault();
      setBusy(true);
      setError(null);
      try {
        await nootion.api("/login/password", { method: "POST", body: { login, password } });
        onConnected();
      } catch (err) {
        setError(message(err));
      } finally {
        setBusy(false);
      }
    }

    return h(
      "div",
      { "data-nextcloud-connect": "" },
      h("p", { style: { fontSize: 14, marginBottom: 14, opacity: 0.85 } }, T.connectIntro),
      waiting
        ? h("p", { style: { fontSize: 14, marginBottom: 12 }, "data-nextcloud-waiting": "" }, "⏳ ", T.waiting)
        : h(Button, { type: "button", onClick: start }, "☁️ ", T.connect),
      h("div", { style: { marginTop: 14 } }, h("button", { type: "button", className: "nc-link", onClick: () => setManual(!manual) }, T.usePassword)),
      manual &&
        h(
          "form",
          { onSubmit: submit, style: { marginTop: 10, display: "grid", gap: 8 } },
          h("input", {
            className: "nc-input",
            placeholder: T.login,
            value: login,
            onChange: (e) => setLogin(e.target.value),
            autoComplete: "username",
            name: "nc-login",
          }),
          h("input", {
            className: "nc-input",
            type: "password",
            placeholder: T.appPassword,
            value: password,
            onChange: (e) => setPassword(e.target.value),
            autoComplete: "off",
            name: "nc-password",
          }),
          h("div", { className: "nc-sub" }, T.appPasswordHelp),
          h("div", null, h(Button, { type: "submit", disabled: busy || !login || !password }, T.connectSubmit)),
        ),
      error && h("div", { className: "nc-error" }, error),
    );
  }

  function Row({ entry, selected, showFolder, onOpen, onToggle, selectable }) {
    const [broken, setBroken] = useState(false);
    const thumb =
      entry.preview && entry.fileId && !broken
        ? h("img", {
            className: "nc-thumb",
            src: `/api/plugins/nextcloud/preview?fileId=${encodeURIComponent(entry.fileId)}`,
            loading: "lazy",
            alt: "",
            onError: () => setBroken(true),
          })
        : h("span", { className: "nc-thumb" }, iconOf(entry));
    const meta = [entry.folder ? "" : formatSize(entry.size, nootion.locale), entry.modified ? new Date(entry.modified).toLocaleDateString(nootion.locale) : ""]
      .filter(Boolean)
      .join(" · ");
    return h(
      "div",
      {
        className: `nc-row${selected ? " nc-selected" : ""}`,
        "data-nextcloud-entry": entry.path,
        onClick: () => (entry.folder ? onOpen(entry.path) : selectable && onToggle(entry)),
      },
      selectable
        ? h("input", {
            type: "checkbox",
            checked: selected,
            onClick: (e) => e.stopPropagation(),
            onChange: () => onToggle(entry),
            "aria-label": entry.name,
          })
        : h("span", { style: { width: 13 } }),
      thumb,
      h(
        "div",
        { style: { flex: 1, minWidth: 0 } },
        h("div", { className: "nc-name" }, entry.name),
        showFolder && h("div", { className: "nc-sub" }, parentOf(entry.path)),
      ),
      h("span", { className: "nc-meta" }, meta),
    );
  }

  /**
   * The picker. "copy": files are copied into the page and given to `close`. "link": one file or folder is
   * given to `close` as is.
   */
  function Picker({ mode, pageId, multiple, close }) {
    const [status, setStatus] = useState(null);
    const [path, setPath] = useState("/");
    const [query, setQuery] = useState("");
    const [entries, setEntries] = useState(null);
    /** The open folder itself, to link to it. */
    const [folder, setFolder] = useState(null);
    const [selected, setSelected] = useState([]);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const seq = useRef(0);

    const loadStatus = () =>
      nootion
        .api("/status")
        .then(setStatus)
        .catch((e) => setError(message(e)));
    useEffect(() => void loadStatus(), []);

    useEffect(() => {
      if (!status?.connected) return;
      const n = ++seq.current;
      const q = query.trim();
      setError(null);
      const timer = setTimeout(
        async () => {
          try {
            const res = q ? await nootion.api(`/search?q=${encodeURIComponent(q)}`) : await nootion.api(`/files?path=${encodeURIComponent(path)}`);
            if (n === seq.current) (setEntries(res.entries), setFolder(res.folder ?? null));
          } catch (e) {
            if (n !== seq.current) return;
            setEntries([]);
            setError(message(e));
            // The app password was revoked in Nextcloud: back to the connection.
            if (/nextcloud_not_connected/.test(e?.code ?? "")) loadStatus();
          }
        },
        q ? 300 : 0,
      );
      setEntries(null);
      return () => clearTimeout(timer);
    }, [status?.connected, path, query]);

    const isSelected = (entry) => selected.some((s) => s.path === entry.path);
    const toggle = (entry) =>
      setSelected((list) => (list.some((s) => s.path === entry.path) ? list.filter((s) => s.path !== entry.path) : multiple ? [...list, entry] : [entry]));

    async function confirm(chosen = selected) {
      if (mode === "link") return close(chosen[0]);
      setBusy(true);
      setError(null);
      try {
        const { attachments } = await nootion.api("/import", { method: "POST", body: { pageId, paths: chosen.map((s) => s.path) } });
        close(attachments);
      } catch (e) {
        setError(message(e));
        setBusy(false);
      }
    }

    async function disconnect() {
      await nootion.api("/login", { method: "DELETE" }).catch(() => null);
      setSelected([]);
      setEntries(null);
      loadStatus();
    }

    let body;
    if (!status) body = h("p", { style: { fontSize: 14, opacity: 0.6 } }, error ?? T.loading);
    else if (!status.configured) body = h("p", { style: { fontSize: 14 } }, T.notConfigured);
    else if (!status.connected) body = h(Connect, { onConnected: loadStatus });
    else {
      const parts = path.split("/").filter(Boolean);
      const searching = !!query.trim();
      body = h(
        "div",
        null,
        h("input", { className: "nc-input", type: "search", placeholder: T.search, value: query, onChange: (e) => setQuery(e.target.value), autoFocus: true }),
        !searching &&
          h(
            "div",
            { className: "nc-crumbs" },
            h("button", { type: "button", onClick: () => setPath("/") }, "☁️ ", T.files),
            ...parts.map((part, i) => [
              h("span", { key: `s${i}`, style: { opacity: 0.4 } }, "›"),
              h("button", { key: `b${i}`, type: "button", onClick: () => setPath(`/${parts.slice(0, i + 1).join("/")}`) }, part),
            ]),
          ),
        searching && h("div", { style: { height: 10 } }),
        h(
          "div",
          { className: "nc-list", "data-nextcloud-list": "" },
          entries === null
            ? h("div", { className: "nc-row", style: { opacity: 0.6, cursor: "default" } }, T.loading)
            : entries.length === 0
              ? h("div", { className: "nc-row", style: { opacity: 0.6, cursor: "default" } }, searching ? T.noResult : T.empty)
              : entries.map((entry) =>
                  h(Row, {
                    key: entry.path,
                    entry,
                    selected: isSelected(entry),
                    showFolder: searching,
                    selectable: mode === "link" || !entry.folder,
                    onOpen: (p) => (setQuery(""), setPath(p)),
                    onToggle: toggle,
                  }),
                ),
        ),
        error && h("div", { className: "nc-error" }, error),
      );
    }

    const connected = status?.connected;
    const label = mode === "link" ? T.insertLink : busy ? T.copying : selected.length > 1 ? fmt(T.insertN, { n: selected.length }) : T.insert;
    return h(
      Modal,
      { title: T.title, onClose: () => close(), wide: true },
      body,
      h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: 8, marginTop: 14, flexWrap: "wrap" } },
        h(
          "div",
          { style: { flex: 1, minWidth: 0, fontSize: 12, opacity: 0.75 } },
          connected && [
            fmt(T.connectedAs, { name: status.account }),
            " · ",
            h("button", { key: "d", type: "button", className: "nc-link", onClick: disconnect }, T.disconnect),
          ],
        ),
        connected &&
          mode === "link" &&
          folder &&
          path !== "/" &&
          !query.trim() &&
          selected.length === 0 &&
          h(Button, { type: "button", variant: "ghost", onClick: () => confirm([folder]) }, T.selectFolder),
        h(Button, { type: "button", variant: "ghost", onClick: () => close() }, connected ? T.cancel : T.close),
        connected && h(Button, { type: "button", disabled: busy || selected.length === 0, onClick: () => confirm(), "data-nextcloud-insert": "" }, label),
      ),
    );
  }

  const pick = (mode, props = {}) => showDialog((close) => h(Picker, { mode, close, multiple: false, ...props }));

  nootion.registerFileSource({
    label: "Nextcloud",
    icon: "☁️",
    keywords: "nextcloud cloud drive",
    pick: ({ pageId, multiple }) => pick("copy", { pageId, multiple }),
  });

  /** A file or folder that opens in Nextcloud (for people who have access to it there). */
  function LinkBlock({ data, setData, editable }) {
    const choose = async () => {
      const entry = await pick("link");
      if (!entry) return;
      setData({ name: entry.name, path: entry.path, folder: !!entry.folder, size: entry.size ?? 0, mimeType: entry.mimeType ?? null, url: entry.url ?? null });
    };
    if (!data.path) {
      return editable ? h("button", { type: "button", className: "nc-choose", onClick: choose, "data-nextcloud-choose": "" }, "☁️ ", T.choose) : null;
    }
    const sub = [data.folder ? T.folder : formatSize(data.size, nootion.locale), parentOf(data.path)].filter(Boolean).join(" · ");
    return h(
      "div",
      { className: "nc-card", "data-nextcloud-link": "" },
      h("span", { style: { fontSize: 22 } }, iconOf(data)),
      h(
        "div",
        { style: { flex: 1, minWidth: 0 } },
        data.url ? h("a", { href: data.url, target: "_blank", rel: "noopener noreferrer", title: T.open }, data.name) : h("span", null, data.name),
        h("div", { className: "nc-sub" }, "Nextcloud · ", sub),
      ),
      editable && h(Button, { type: "button", variant: "ghost", className: "nootion-hover-only", onClick: choose }, T.change),
    );
  }

  nootion.registerBlock("link", LinkBlock);
}
