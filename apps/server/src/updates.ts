import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** "3.1.0" from "v3.1.0", "3.1.0-beta.1"…; null when it isn't a version. */
export function parseVersion(
  v: string | undefined | null,
): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v?.trim() ?? "");
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function isNewer(candidate: string, than: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(than);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return false;
}

/**
 * The running version: the image's (NOOTION_VERSION, set from the release tag), or else the one in package.json
 * followed by "-dev" (development, or an image built from a branch).
 */
export function currentVersion(): string {
  const env = process.env.NOOTION_VERSION;
  if (parseVersion(env)) return env!.replace(/^v/, "");
  try {
    const pkg = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "package.json",
    );
    const version = (
      JSON.parse(fs.readFileSync(pkg, "utf8")) as { version?: string }
    ).version;
    if (parseVersion(version)) return `${version}-dev`;
  } catch {
    // No package.json next to the code.
  }
  return "dev";
}

export interface LatestRelease {
  version: string;
  url: string;
  publishedAt: string | null;
}

const EVERY_MS = 12 * 3600_000;

/** Asks GitHub for the latest release, at start and twice a day, for administrators. */
export function createUpdates(opts: {
  enabled: boolean;
  url: string;
  log: { warn: (o: unknown, msg: string) => void };
}) {
  let latest: LatestRelease | null = null;
  let checkedAt: Date | null = null;
  let timer: NodeJS.Timeout | null = null;
  let running: Promise<void> | null = null;

  async function check(): Promise<void> {
    if (!opts.enabled) return;
    running ??= (async () => {
      try {
        const res = await fetch(opts.url, {
          headers: {
            accept: "application/vnd.github+json",
            "user-agent": "Nootion update check",
          },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as {
          tag_name?: string;
          html_url?: string;
          published_at?: string;
          draft?: boolean;
          prerelease?: boolean;
        };
        if (
          body.tag_name &&
          parseVersion(body.tag_name) &&
          !body.draft &&
          !body.prerelease
        ) {
          latest = {
            version: body.tag_name.replace(/^v/, ""),
            url: body.html_url ?? "",
            publishedAt: body.published_at ?? null,
          };
        }
        checkedAt = new Date();
      } catch (err) {
        opts.log.warn({ err }, "Couldn't check for a new Nootion release");
      } finally {
        running = null;
      }
    })();
    return running;
  }

  return {
    start() {
      if (!opts.enabled || timer) return;
      // A little after start, so that it never slows it down.
      setTimeout(() => void check(), 10_000).unref();
      timer = setInterval(() => void check(), EVERY_MS);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    check,
    enabled: () => opts.enabled,
    latest: () => latest,
    checkedAt: () => checkedAt,
  };
}

export type Updates = ReturnType<typeof createUpdates>;
