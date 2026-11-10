import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ReleaseNotes } from "@nootion/shared";
import { isNewer, parseVersion } from "./updates.js";

/** At most this many releases in the "What's new" window, newest first. */
const MAX_RELEASES = 10;

/**
 * The releases of a Keep a Changelog file: each "## [x.y.z] - date" section, newest first, with its Markdown.
 * "Unreleased" and anything that isn't a version are left out.
 */
export function parseChangelog(text: string): ReleaseNotes[] {
  const releases: ReleaseNotes[] = [];
  let current: ReleaseNotes | null = null;
  let lines: string[] = [];
  const flush = () => {
    if (current) releases.push({ ...current, markdown: lines.join("\n").trim() });
    current = null;
    lines = [];
  };
  for (const line of text.replace(/\r/g, "").split("\n")) {
    const heading = /^## \[?([^\]\s]+)\]?(?:\s*-\s*(\d{4}-\d{2}-\d{2}))?/.exec(line);
    if (heading) {
      flush();
      if (parseVersion(heading[1])) current = { version: heading[1]!.replace(/^v/, ""), date: heading[2] ?? null, markdown: "" };
    } else if (current) lines.push(line);
  }
  flush();
  return releases;
}

let cache: ReleaseNotes[] | null = null;

/** CHANGELOG.md: next to the code in the image (/app), at the root of the repository in development. */
export function changelog(): ReleaseNotes[] {
  if (cache) return cache;
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const file of [path.join(here, "..", "CHANGELOG.md"), path.join(here, "..", "..", "..", "CHANGELOG.md")]) {
    try {
      return (cache = parseChangelog(fs.readFileSync(file, "utf8")));
    } catch {
      // Not there: the next one.
    }
  }
  return (cache = []);
}

/**
 * The releases to show someone who last saw `seen` and now runs `current`: those newer than `seen`, up to `current`.
 * Never seen anything (an account from before this feature): only the current release.
 */
export function releasesSince(all: ReleaseNotes[], seen: string | null, current: string): ReleaseNotes[] {
  return all
    .filter((r) => !isNewer(r.version, current) && (seen ? isNewer(r.version, seen) : r.version === current))
    .slice(0, MAX_RELEASES);
}
