// Plugin « embed », côté serveur : aperçu d'un lien (titre, description, image) lu dans la page visée.
import { lookup } from "node:dns/promises";
import net from "node:net";

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 6000;
const cache = new Map();

export function activate(nootion) {
  const allowPrivate = nootion.settings.allowPrivateNetworks === true;

  nootion.route("GET", "/preview", async ({ query }) => {
    const url = parseUrl(query.url);
    if (!url) throw new nootion.HttpError(400, "bad_url", "Adresse invalide (http ou https uniquement).");
    const hit = cache.get(url.href);
    if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.data;
    const data = await preview(url, allowPrivate);
    if (cache.size > 500) cache.clear();
    cache.set(url.href, { at: Date.now(), data });
    return data;
  });

  return () => cache.clear();
}

function parseUrl(raw) {
  try {
    const url = new URL(String(raw ?? ""));
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** Loopback, private, link-local and other addresses that are not on the internet. */
export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return (
    v6 === "::" ||
    v6 === "::1" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    v6.startsWith("fe8") ||
    v6.startsWith("fe9") ||
    v6.startsWith("fea") ||
    v6.startsWith("feb")
  );
}

async function checkHost(url, allowPrivate) {
  if (allowPrivate) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addresses.length) throw new Error("adresse introuvable");
  if (addresses.some(isPrivateAddress)) throw new Error("adresse du réseau local refusée");
}

async function preview(start, allowPrivate) {
  let url = start;
  const fallback = { url: start.href, title: start.hostname, description: "", image: null, site: start.hostname };
  try {
    for (let hop = 0; hop < 4; hop++) {
      await checkHost(url, allowPrivate);
      const res = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "user-agent": "Mozilla/5.0 (compatible; Nootion link preview)", accept: "text/html,application/xhtml+xml" },
      });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        url = parseUrl(new URL(location, url).href);
        if (!url) return fallback;
        continue;
      }
      if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return fallback;
      const html = await readLimited(res);
      return { ...fallback, ...extractMeta(html, url) };
    }
  } catch {
    // Unreachable or refused: the block still shows the link itself.
  }
  return fallback;
}

async function readLimited(res) {
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(chunks));
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

/** Title, description, image and site name from the page's meta tags (Open Graph first). */
export function extractMeta(html, base) {
  const meta = {};
  for (const tag of html.match(/<meta\s[^>]*>/gi) ?? []) {
    const attrs = {};
    for (const m of tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) attrs[m[1].toLowerCase()] = m[3] ?? m[4];
    const key = (attrs.property ?? attrs.name ?? "").toLowerCase();
    if (key && attrs.content !== undefined && !(key in meta)) meta[key] = decode(attrs.content);
  }
  const title = meta["og:title"] ?? meta["twitter:title"] ?? decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "");
  let image = meta["og:image"] ?? meta["twitter:image"] ?? null;
  try {
    image = image ? new URL(image, base).href : null;
    if (image && !/^https?:/.test(image)) image = null;
  } catch {
    image = null;
  }
  return {
    url: base.href,
    title: (title || base.hostname).slice(0, 300),
    description: (meta["og:description"] ?? meta["description"] ?? meta["twitter:description"] ?? "").slice(0, 500),
    image,
    site: meta["og:site_name"] ?? base.hostname,
  };
}
