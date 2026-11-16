/**
 * Drawing equations written in LaTeX, with KaTeX. The library and its fonts are loaded the first time a page shows
 * an equation, never with the rest of the editor.
 *
 * KaTeX runs without `trust`: \href, \url, \includegraphics, \htmlClass and the like are refused, so an equation
 * can't make a link or carry HTML of its own.
 */

type Katex = (typeof import("katex"))["default"];
export type Rendered = { html: string } | { error: string };

let library: Promise<Katex> | null = null;

export function loadKatex(): Promise<Katex> {
  library ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")])
    .then(([m]) => m.default)
    .catch((e: unknown) => {
      // Offline and not cached: tried again next time.
      library = null;
      throw e;
    });
  return library;
}

/** Longest equation drawn: past this, KaTeX would take long and the text is surely not an equation. */
export const MAX_LATEX = 10_000;

/** KaTeX's message without its "KaTeX parse error: " prefix. */
export function errorMessage(e: unknown): string {
  const text = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return text.replace(/^KaTeX parse error:\s*/, "").slice(0, 200);
}

/** An equation as HTML, with a given KaTeX (for tests); a mistake comes as `error`, never thrown. */
export function renderWith(katex: Katex, latex: string, display: boolean): Rendered {
  if (latex.length > MAX_LATEX) return { error: "too long" };
  try {
    const html = katex.renderToString(latex, {
      displayMode: display,
      throwOnError: true,
      trust: false,
      // Unicode letters and other things KaTeX only warns about are drawn as written.
      strict: "ignore",
      output: "htmlAndMathml",
      maxExpand: 500,
      maxSize: 50,
    });
    return { html };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

// Same equation: same HTML, from one keystroke (or one remount) to the next.
const cache = new Map<string, Rendered>();
const CACHE_SIZE = 200;

/** The HTML already made for this equation, if any: shown at once, without waiting for a promise. */
export function renderedNow(latex: string, display: boolean): Rendered | null {
  return cache.get(`${display ? "d" : "i"}:${latex}`) ?? null;
}

/** Draws an equation. Never throws: a mistake in the source, or the library failing to load, comes as `error`. */
export async function renderMath(latex: string, display: boolean): Promise<Rendered> {
  const key = `${display ? "d" : "i"}:${latex}`;
  const cached = cache.get(key);
  if (cached) return cached;
  let katex: Katex;
  try {
    katex = await loadKatex();
  } catch (e) {
    return { error: errorMessage(e) };
  }
  const result = renderWith(katex, latex, display);
  cache.set(key, result);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return result;
}
