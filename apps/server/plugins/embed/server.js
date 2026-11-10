// "embed" plugin, server side: preview of a link (title, description, image) read from the linked page.
const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 6000;
const cache = new Map();

export function activate(nootion) {
  const allowPrivate = nootion.settings.allowPrivateNetworks === true;

  nootion.route("GET", "/preview", async ({ query }) => {
    const url = parseUrl(query.url);
    if (!url)
      throw new nootion.HttpError(
        400,
        "bad_url",
        nootion.locale() === "fr" ? "Adresse invalide (http ou https uniquement)." : "Invalid address (http or https only).",
      );
    const hit = cache.get(url.href);
    if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.data;
    const data = await preview(nootion, url, allowPrivate);
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

async function preview(nootion, start, allowPrivate) {
  const fallback = { url: start.href, title: start.hostname, description: "", image: null, site: start.hostname };
  try {
    // Each address on the way (redirections included) is checked as the connection is made: see nootion.net.
    const res = await nootion.net.request(start, {
      allowPrivate,
      maxRedirects: 3,
      maxBytes: MAX_BYTES,
      timeoutMs: TIMEOUT_MS,
      headers: { "user-agent": "Mozilla/5.0 (compatible; Nootion link preview)", accept: "text/html,application/xhtml+xml" },
    });
    if (!res.ok || !String(res.headers["content-type"] ?? "").includes("html")) return fallback;
    return { ...fallback, ...extractMeta(new TextDecoder().decode(res.body), res.url) };
  } catch {
    // Unreachable or refused: the block still shows the link itself.
  }
  return fallback;
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
