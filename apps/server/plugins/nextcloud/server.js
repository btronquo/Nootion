// "nextcloud" plugin, server side: each user connects their Nextcloud account (Login Flow v2, an app password),
// then browses and searches their files over WebDAV, and copies the ones they pick into Nootion.

const TIMEOUT_MS = 15000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
/** Connections waiting for the user to log in to Nextcloud, by user id. */
const pending = new Map();

const TEXTS = {
  en: {
    notConfigured: "The administrator hasn't set the Nextcloud address yet (Administration › Plugins).",
    notConnected: "Connect your Nextcloud account first.",
    unreachable: "Nextcloud can't be reached: {error}",
    refused: "Nextcloud refused the request ({status}).",
    badLogin: "Nextcloud refused this login or app password.",
    expired: "The connection took too long: start again.",
    notFound: "This file or folder no longer exists in Nextcloud.",
    tooMany: "Pick at most 20 files at a time.",
  },
  fr: {
    notConfigured: "L'administrateur n'a pas encore indiqué l'adresse de Nextcloud (Administration › Plugins).",
    notConnected: "Connectez d'abord votre compte Nextcloud.",
    unreachable: "Impossible de joindre Nextcloud : {error}",
    refused: "Nextcloud a refusé la demande ({status}).",
    badLogin: "Nextcloud a refusé cet identifiant ou ce mot de passe d'application.",
    expired: "La connexion a pris trop de temps : recommencez.",
    notFound: "Ce fichier ou dossier n'existe plus dans Nextcloud.",
    tooMany: "Choisissez au plus 20 fichiers à la fois.",
  },
};

export function activate(nootion) {
  const base = cleanUrl(nootion.settings.url);
  const browserBase = cleanUrl(nootion.settings.browserUrl) ?? base;
  const text = (key, vars = {}) => (TEXTS[nootion.locale()] ?? TEXTS.en)[key].replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
  const fail = (status, code, key, vars) => new nootion.HttpError(status, code, text(key, vars));

  /** Calls Nextcloud; network errors and refusals become errors in the user's language. */
  async function call(url, init = {}, timeout = TIMEOUT_MS) {
    let res;
    try {
      res = await fetch(url, { ...init, headers: { "user-agent": "Nootion", ...init.headers }, signal: AbortSignal.timeout(timeout), redirect: "manual" });
    } catch (e) {
      throw fail(502, "nextcloud_unreachable", "unreachable", { error: e?.cause?.code ?? e?.message ?? String(e) });
    }
    return res;
  }

  function needBase() {
    if (!base) throw fail(400, "nextcloud_not_configured", "notConfigured");
    return base;
  }

  /** The user's account, or an error asking them to connect it. */
  function account(user) {
    needBase();
    const acc = nootion.userSecrets.get(user.id);
    if (!acc || acc.base !== base) throw fail(409, "nextcloud_not_connected", "notConnected");
    return acc;
  }

  const auth = (acc) => ({ authorization: `Basic ${Buffer.from(`${acc.loginName}:${acc.appPassword}`).toString("base64")}` });
  const davRoot = (acc) => `${base}/remote.php/dav/files/${encodeURIComponent(acc.userId)}`;
  const davUrl = (acc, path) => davRoot(acc) + encodePath(path);

  async function checked(res) {
    if (res.status === 401) throw fail(409, "nextcloud_not_connected", "notConnected");
    if (res.status === 404) throw fail(404, "nextcloud_not_found", "notFound");
    if (!res.ok && res.status !== 207) throw fail(502, "nextcloud_refused", "refused", { status: res.status });
    return res;
  }

  /** Who the login and app password belong to (null when Nextcloud refuses them). */
  async function whoAmI(loginName, appPassword) {
    const res = await call(`${base}/ocs/v1.php/cloud/user?format=json`, {
      headers: { ...auth({ loginName, appPassword }), "ocs-apirequest": "true", accept: "application/json" },
    });
    if (res.status === 401 || res.status === 403) return null;
    await checked(res);
    const data = (await res.json())?.ocs?.data;
    return data?.id ? { userId: String(data.id), displayName: String(data["display-name"] ?? data.displayname ?? data.id) } : null;
  }

  async function save(user, loginName, appPassword) {
    const who = await whoAmI(loginName, appPassword);
    if (!who) throw fail(400, "nextcloud_bad_login", "badLogin");
    nootion.userSecrets.set(user.id, { base, loginName, appPassword, ...who });
    return { connected: true, account: who.displayName };
  }

  nootion.route("GET", "/status", ({ user }) => {
    if (!base) return { configured: false, connected: false, account: null, url: null };
    const acc = nootion.userSecrets.get(user.id);
    const connected = !!acc && acc.base === base;
    return { configured: true, connected, account: connected ? acc.displayName : null, url: browserBase };
  });

  // Login Flow v2: Nextcloud gives a page where the user logs in and allows Nootion, then an app password.
  nootion.route("POST", "/login", async ({ user }) => {
    needBase();
    const res = await checked(await call(`${base}/index.php/login/v2`, { method: "POST" }));
    const data = await res.json();
    pending.set(user.id, { token: data.poll.token, endpoint: swapBase(data.poll.endpoint, browserBase, base), at: Date.now() });
    return { url: swapBase(data.login, base, browserBase) };
  });

  nootion.route("POST", "/login/poll", async ({ user }) => {
    const p = pending.get(user.id);
    if (!p || Date.now() - p.at > 20 * 60 * 1000) throw fail(400, "nextcloud_login_expired", "expired");
    const res = await call(p.endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: p.token }).toString(),
    });
    // 404 until the user has allowed access.
    if (res.status === 404) return { connected: false, account: null };
    await checked(res);
    const data = await res.json();
    pending.delete(user.id);
    return save(user, data.loginName, data.appPassword);
  });

  // Without the login page: a login and an app password made in Nextcloud (Settings › Security).
  nootion.route("POST", "/login/password", async ({ user, body }) => {
    needBase();
    const loginName = String(body?.login ?? "").trim();
    const appPassword = String(body?.password ?? "").trim();
    if (!loginName || !appPassword) throw fail(400, "nextcloud_bad_login", "badLogin");
    return save(user, loginName, appPassword);
  });

  nootion.route("DELETE", "/login", async ({ user }) => {
    const acc = nootion.userSecrets.get(user.id);
    nootion.userSecrets.delete(user.id);
    pending.delete(user.id);
    // Revokes the app password in Nextcloud too, when it is still reachable.
    if (acc?.base === base && base) {
      await call(`${base}/ocs/v2.php/core/apppassword`, { method: "DELETE", headers: { ...auth(acc), "ocs-apirequest": "true" } }).catch(() => null);
    }
    return { connected: false };
  });

  /** A folder's content: folders first, then files, by name. */
  nootion.route("GET", "/files", async ({ user, query }) => {
    const acc = account(user);
    const path = normalizePath(query.path);
    const res = await checked(
      await call(davUrl(acc, path), { method: "PROPFIND", headers: { ...auth(acc), depth: "1", "content-type": "application/xml" }, body: PROPFIND_BODY }),
    );
    const all = parseMultistatus(await res.text(), acc.userId);
    const self = all.find((e) => e.path === path);
    const entries = all.filter((e) => e !== self);
    entries.sort((a, b) => (a.folder === b.folder ? a.name.localeCompare(b.name) : a.folder ? -1 : 1));
    return { path, folder: self ? withUrl(self) : null, entries: entries.map((e) => withUrl(e)) };
  });

  /** Files and folders whose name holds the words typed. */
  nootion.route("GET", "/search", async ({ user, query }) => {
    const acc = account(user);
    const q = String(query.q ?? "")
      .trim()
      .slice(0, 100);
    if (!q) return { entries: [] };
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const body = SEARCH_BODY.replace("{scope}", xmlEscape(`/files/${acc.userId}`)).replace("{like}", xmlEscape(like));
    const res = await checked(await call(`${base}/remote.php/dav/`, { method: "SEARCH", headers: { ...auth(acc), "content-type": "text/xml" }, body }));
    return { entries: parseMultistatus(await res.text(), acc.userId).map((e) => withUrl(e)) };
  });

  /** A small preview of an image or document, as Nextcloud makes it. */
  nootion.route("GET", "/preview", async ({ user, query }) => {
    const acc = account(user);
    const params = new URLSearchParams({ fileId: String(query.fileId ?? ""), x: "96", y: "96", a: "0", mode: "cover" });
    const res = await checked(await call(`${base}/index.php/core/preview?${params}`, { headers: auth(acc) }));
    return nootion.binary(Buffer.from(await res.arrayBuffer()), (res.headers.get("content-type") ?? "").split(";")[0]);
  });

  /** Copies files into the page (or database row), as attachments. */
  nootion.route("POST", "/import", async ({ user, body }) => {
    const acc = account(user);
    const pageId = String(body?.pageId ?? "");
    const paths = Array.isArray(body?.paths) ? body.paths.map(normalizePath) : [];
    if (paths.length > 20) throw fail(400, "nextcloud_too_many", "tooMany");
    const role = nootion.pages.role(user.id, pageId);
    if (role !== "editor" && role !== "full") throw new nootion.HttpError(404, "not_found", text("notFound"));
    const attachments = [];
    for (const path of paths) {
      const res = await checked(await call(davUrl(acc, path), { headers: auth(acc) }, DOWNLOAD_TIMEOUT_MS));
      attachments.push(
        await nootion.attachments.create({
          userId: user.id,
          pageId,
          filename: path.split("/").pop(),
          mimeType: res.headers.get("content-type") ?? "application/octet-stream",
          data: res.body,
        }),
      );
    }
    return { attachments };
  });

  function withUrl(e) {
    return { ...e, url: e.fileId ? `${browserBase}/index.php/f/${e.fileId}` : null };
  }

  return () => pending.clear();
}

const PROPS = `<d:prop><d:displayname/><d:getcontentlength/><d:getcontenttype/><d:getlastmodified/><d:resourcetype/><oc:fileid/><oc:size/><nc:has-preview/></d:prop>`;
const NS = `xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns"`;
const PROPFIND_BODY = `<?xml version="1.0"?><d:propfind ${NS}>${PROPS}</d:propfind>`;
const SEARCH_BODY = `<?xml version="1.0"?><d:searchrequest ${NS}><d:basicsearch><d:select>${PROPS}</d:select><d:from><d:scope><d:href>{scope}</d:href><d:depth>infinity</d:depth></d:scope></d:from><d:where><d:like><d:prop><d:displayname/></d:prop><d:literal>{like}</d:literal></d:like></d:where><d:orderby><d:order><d:prop><d:getlastmodified/></d:prop><d:descending/></d:order></d:orderby><d:limit><d:nresults>50</d:nresults></d:limit></d:basicsearch></d:searchrequest>`;

/** The address without its trailing slash, or null when it isn't http(s). */
function cleanUrl(raw) {
  try {
    const url = new URL(String(raw ?? "").trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** Moves an address Nextcloud gave from one of its addresses to the other (internal one for the server, public one for the browser). */
function swapBase(url, from, to) {
  return from && to && url.startsWith(from) ? to + url.slice(from.length) : url;
}

/** "/Photos/2026" from what the browser sends; ".." can't leave the user's files. */
export function normalizePath(raw) {
  const parts = [];
  for (const part of String(raw ?? "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

const encodePath = (path) => path.split("/").map(encodeURIComponent).join("/");

const xmlEscape = (s) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
const xmlUnescape = (s) =>
  s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[\da-f]+);/gi, (m, e) => {
    const named = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }[e.toLowerCase()];
    if (named) return named;
    return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });

/** The value of an element, whatever its namespace prefix: "" when empty, null when missing. */
function prop(xml, name) {
  const m = xml.match(new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*?(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>)`));
  return m ? xmlUnescape(m[1] ?? "").trim() : null;
}

/** Files and folders of a WebDAV answer (PROPFIND or SEARCH), with paths relative to the user's files. */
export function parseMultistatus(xml, userId) {
  const out = [];
  const prefix = `/remote.php/dav/files/${encodeURIComponent(userId)}`;
  for (const [, block] of xml.matchAll(/<(?:[\w-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/g)) {
    const href = prop(block, "href");
    // Properties Nextcloud doesn't have are listed again under a 404 propstat: only read the 200 one.
    const ok = [...block.matchAll(/<(?:[\w-]+:)?propstat\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?propstat>/g)]
      .map((m) => m[1])
      .find((p) => /\b200\b/.test(prop(p, "status") ?? ""));
    if (!href || !ok) continue;
    const at = href.indexOf(prefix);
    if (at < 0) continue;
    const path = normalizePath(
      href
        .slice(at + prefix.length)
        .split("/")
        .map((s) => decodeURIComponent(s))
        .join("/"),
    );
    const folder = /<(?:[\w-]+:)?collection\b/.test(prop(ok, "resourcetype") ?? "");
    const size = Number(prop(ok, folder ? "size" : "getcontentlength") ?? prop(ok, "size") ?? 0);
    const modified = prop(ok, "getlastmodified");
    out.push({
      path,
      name: path === "/" ? "/" : path.split("/").pop(),
      folder,
      size: Number.isFinite(size) ? size : 0,
      mimeType: folder ? null : prop(ok, "getcontenttype") || "application/octet-stream",
      modified: modified ? new Date(modified).toISOString() : null,
      fileId: prop(ok, "fileid") || null,
      preview: prop(ok, "has-preview") === "true",
    });
  }
  return out;
}
