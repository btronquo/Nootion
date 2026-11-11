/**
 * Video blocks: a link to a video site, shown in its player, or a video file, shown in the browser's player.
 *
 * Only sites whose player address is known are embedded (YouTube, Vimeo, Dailymotion, Loom, PeerTube, Twitch,
 * Google Drive): the block never loads an address it was given as is, so a page can't frame any site through it.
 */
export type VideoSource = { kind: "player"; provider: VideoProvider; embedUrl: string } | { kind: "file"; url: string };

export type VideoProvider = "youtube" | "vimeo" | "dailymotion" | "loom" | "peertube" | "twitch" | "drive";

export const VIDEO_PROVIDER_NAMES: Record<VideoProvider, string> = {
  youtube: "YouTube",
  vimeo: "Vimeo",
  dailymotion: "Dailymotion",
  loom: "Loom",
  peertube: "PeerTube",
  twitch: "Twitch",
  drive: "Google Drive",
};

/** Video files the browsers can play. */
const VIDEO_FILE = /\.(mp4|m4v|webm|ogv|mov)$/i;
const ID = /^[\w-]+$/;

/** "1h2m3s", "90s", "90" → seconds. */
function seconds(value: string | null): number {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
}

function youtube(url: URL): string | null {
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "watch") id = url.searchParams.get("v");
    else if (["embed", "shorts", "live", "v"].includes(parts[0] ?? "")) id = parts[1] ?? null;
  }
  if (!id || !ID.test(id)) return null;
  const start = seconds(url.searchParams.get("t") ?? url.searchParams.get("start"));
  const list = url.searchParams.get("list");
  const params = new URLSearchParams();
  if (start) params.set("start", String(start));
  if (list && ID.test(list)) params.set("list", list);
  const query = params.toString();
  // The "no cookie" player: YouTube sets no cookie until the video is played.
  return `https://www.youtube-nocookie.com/embed/${id}${query ? `?${query}` : ""}`;
}

function vimeo(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, "");
  if (host !== "vimeo.com" && host !== "player.vimeo.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const at = parts.findIndex((p) => /^\d+$/.test(p));
  if (at < 0) return null;
  // An unlisted video has its key after the id (vimeo.com/123/abc) or as ?h=abc.
  const hash = url.searchParams.get("h") ?? (parts[at + 1] && /^[0-9a-f]+$/i.test(parts[at + 1]!) ? parts[at + 1] : null);
  return `https://player.vimeo.com/video/${parts[at]}${hash ? `?h=${hash}` : ""}`;
}

function dailymotion(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, "");
  let id: string | null = null;
  if (host === "dai.ly") id = url.pathname.slice(1);
  else if (host === "dailymotion.com") {
    const m = /^\/(?:embed\/)?video\/([a-zA-Z0-9]+)/.exec(url.pathname);
    id = m?.[1] ?? null;
  }
  return id && /^[a-zA-Z0-9]+$/.test(id) ? `https://www.dailymotion.com/embed/video/${id}` : null;
}

function loom(url: URL): string | null {
  if (url.hostname.replace(/^www\./, "") !== "loom.com") return null;
  const m = /^\/(?:share|embed)\/([0-9a-f]+)/i.exec(url.pathname);
  return m ? `https://www.loom.com/embed/${m[1]}` : null;
}

function twitch(url: URL, parent: string | undefined): string | null {
  const host = url.hostname.replace(/^(www|m)\./, "");
  if (host !== "twitch.tv" || !parent) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const p = new URLSearchParams({ parent });
  if (parts[0] === "videos" && /^\d+$/.test(parts[1] ?? "")) p.set("video", `v${parts[1]}`);
  else if (parts.length === 1 && ID.test(parts[0]!)) p.set("channel", parts[0]!);
  else return null;
  return `https://player.twitch.tv/?${p.toString()}`;
}

function drive(url: URL): string | null {
  if (url.hostname !== "drive.google.com") return null;
  const m = /^\/file\/d\/([\w-]+)/.exec(url.pathname);
  return m ? `https://drive.google.com/file/d/${m[1]}/preview` : null;
}

/** A PeerTube video, on any instance: /w/<id> or /videos/watch/<uuid>. */
function peertube(url: URL): string | null {
  const m = /^\/(?:w|videos\/watch|videos\/embed)\/([\w-]{8,})\/?$/.exec(url.pathname);
  return m ? `${url.origin}/videos/embed/${m[1]}` : null;
}

/**
 * How to show a video from the address someone gave, or null when it isn't one. `parent` is this site's host name,
 * which Twitch's player asks for.
 */
export function videoSource(input: string | null | undefined, parent?: string): VideoSource | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  // Files attached to a page (on a public page, through its link).
  if (/^\/api\/(public\/[\w-]+\/)?attachments\/[\w-]+$/.test(raw)) return { kind: "file", url: raw };
  let url: URL;
  try {
    url = new URL(/^[\w-]+(\.[\w-]+)+\//.test(raw) ? `https://${raw}` : raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const players: [VideoProvider, string | null][] = [
    ["youtube", youtube(url)],
    ["vimeo", vimeo(url)],
    ["dailymotion", dailymotion(url)],
    ["loom", loom(url)],
    ["twitch", twitch(url, parent)],
    ["drive", drive(url)],
    ["peertube", peertube(url)],
  ];
  for (const [provider, embedUrl] of players) if (embedUrl) return { kind: "player", provider, embedUrl };
  if (VIDEO_FILE.test(url.pathname)) return { kind: "file", url: url.toString() };
  return null;
}
