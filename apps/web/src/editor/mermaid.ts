import { useSyncExternalStore } from "react";

/**
 * Drawing Mermaid diagrams. The library is large: it is loaded the first time a page shows a diagram, never with
 * the rest of the editor.
 *
 * It runs in strict mode: no HTML nor scripts in labels, no click handlers, and a diagram can't loosen this with an
 * `%%{init}%%` line (Mermaid keeps `securityLevel` out of what diagrams may change).
 */

type Mermaid = (typeof import("mermaid"))["default"];
export type Drawn = { svg: string } | { error: string; line?: number };

let library: Promise<Mermaid> | null = null;

function load(): Promise<Mermaid> {
  library ??= import("mermaid")
    .then((m) => m.default)
    .catch((e: unknown) => {
      // Offline and not cached: tried again next time.
      library = null;
      throw e;
    });
  return library;
}

// Mermaid keeps its settings in one global place: diagrams are drawn one at a time.
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(job: () => Promise<T>): Promise<T> => {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
};

// Same source, same theme: same picture, from one keystroke (or one remount) to the next.
const cache = new Map<string, Drawn>();
const CACHE_SIZE = 50;
let counter = 0;

/**
 * A short message from Mermaid's: its first line ("Parse error on line 5:") and what it found there. The rest repeats
 * the source with a caret under the mistake and lists every token it expected, which says little to a person.
 */
export function errorMessage(e: unknown): string {
  const text = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  const lines = text.split("\n").map((l) => l.trim());
  const got = /got '([^']*)'/.exec(text)?.[1];
  const first = (lines[0] ?? "").replace(/:$/, "");
  return (got && got !== "EOF" ? `${first} ('${got}')` : first).slice(0, 200);
}

/** The line of the mistake, when Mermaid says it ("Parse error on line 5"). */
export function errorLine(e: unknown): number | undefined {
  const m = /on line (\d+)/.exec(e instanceof Error ? e.message : String(e ?? ""));
  return m ? Number(m[1]) : undefined;
}

/** Draws a diagram as SVG, in the light or the dark theme. Never throws: a mistake in the source comes as `error`. */
export function drawMermaid(source: string, dark: boolean): Promise<Drawn> {
  const key = `${dark ? "d" : "l"}:${source}`;
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  return serial(async () => {
    const again = cache.get(key);
    if (again) return again;
    let result: Drawn;
    try {
      const mermaid = await load();
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: dark ? "dark" : "default",
        // Nothing is written into the page when a diagram is wrong: the block shows the message itself.
        suppressErrorRendering: true,
        fontFamily: "inherit",
      });
      const id = `mermaid-${++counter}`;
      try {
        const { svg } = await mermaid.render(id, source);
        result = { svg };
      } finally {
        // Mermaid draws in a hidden element of the page to measure text, and leaves it there when it fails.
        document.getElementById(id)?.remove();
        document.getElementById(`d${id}`)?.remove();
      }
    } catch (e) {
      const line = errorLine(e);
      result = line ? { error: errorMessage(e), line } : { error: errorMessage(e) };
    }
    cache.set(key, result);
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
    return result;
  });
}

const isDark = () => document.documentElement.classList.contains("dark");

function subscribeTheme(listener: () => void) {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

/** True while the page is in the dark theme (the class on <html>, set by the theme and taken off for printing). */
export function useDarkTheme(): boolean {
  return useSyncExternalStore(subscribeTheme, isDark, () => false);
}
