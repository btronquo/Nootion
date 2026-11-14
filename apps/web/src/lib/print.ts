import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

/**
 * Printing a page (and "Save as PDF", which is the browser's printer of that name).
 *
 * The print stylesheet (index.css, `@media print`) hides what is not the page: sidebar, buttons, handles, panels.
 * It opens toggles and lets the page run over several sheets. What CSS alone can't do is done here, while the
 * browser prints: databases show all their rows (not only the first batch), and a dark theme is put aside.
 *
 * Ctrl+P works too: the browser's own `beforeprint` puts the page in the same state.
 */

/** Where a new sheet starts: never on its own, before each heading 1, or before headings 1 and 2. */
export type PrintBreaks = "none" | "h1" | "h2";

export interface PrintOptions {
  breaks: PrintBreaks;
  /** The address of each link is written after it, since a sheet of paper can't be clicked. */
  linkUrls: boolean;
}

const OPTIONS_KEY = "nootion-print";
export const DEFAULT_PRINT_OPTIONS: PrintOptions = { breaks: "none", linkUrls: true };

export function readPrintOptions(): PrintOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "null") as Partial<PrintOptions> | null;
    if (!saved || typeof saved !== "object") return DEFAULT_PRINT_OPTIONS;
    return {
      breaks: saved.breaks === "h1" || saved.breaks === "h2" ? saved.breaks : "none",
      linkUrls: saved.linkUrls !== false,
    };
  } catch {
    return DEFAULT_PRINT_OPTIONS;
  }
}

function saveOptions(options: PrintOptions) {
  try {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
  } catch {
    // Private window: the choice is only for this time.
  }
}

/** The options as attributes of <html>, which the print stylesheet reads. */
function applyOptions(options: PrintOptions) {
  const root = document.documentElement;
  if (options.breaks === "none") delete root.dataset.printBreaks;
  else root.dataset.printBreaks = options.breaks;
  if (options.linkUrls) root.dataset.printLinks = "";
  else delete root.dataset.printLinks;
}

let printing = false;
let wasDark = false;
const listeners = new Set<() => void>();

function setPrinting(on: boolean) {
  if (printing === on) return;
  printing = on;
  const root = document.documentElement;
  if (on) {
    // Paper is white: the dark theme is put aside while printing.
    wasDark = root.classList.contains("dark");
    root.classList.remove("dark");
    root.dataset.printing = "";
  } else {
    if (wasDark) root.classList.add("dark");
    delete root.dataset.printing;
  }
  // At once, before the browser lays the page out for printing.
  flushSync(() => listeners.forEach((l) => l()));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True while the page is being printed: views show everything instead of a batch at a time. */
export function usePrinting(): boolean {
  return useSyncExternalStore(subscribe, () => printing);
}

export const isPrinting = () => printing;

if (typeof window !== "undefined") {
  // Ctrl+P, or the browser's menu: same state as the button, with the options last chosen.
  window.addEventListener("beforeprint", () => {
    if (!printing) applyOptions(readPrintOptions());
    setPrinting(true);
  });
  window.addEventListener("afterprint", () => setPrinting(false));
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Prints the open page with these options (remembered for the next time). Every row is put on the page first, and
 * the images still loading are awaited a moment, so the sheets aren't printed half filled.
 */
export async function printPage(options: PrintOptions) {
  saveOptions(options);
  applyOptions(options);
  setPrinting(true);
  await nextFrame();
  await nextFrame();
  await imagesLoaded(document.querySelector("main") ?? document.body, 3000);
  try {
    window.print();
  } finally {
    // window.print() returns once the dialog is closed (most browsers); afterprint may not come on all of them.
    setPrinting(false);
  }
}

/** Waits for the images of an element to load (lazy ones are asked to load now), for at most `ms`. */
function imagesLoaded(root: Element, ms: number) {
  const pending = [...root.querySelectorAll("img")].filter((img) => {
    if (img.loading === "lazy") img.loading = "eager";
    return !img.complete;
  });
  if (!pending.length) return Promise.resolve();
  const all = Promise.all(
    pending.map(
      (img) =>
        new Promise<void>((resolve) => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        }),
    ),
  );
  return Promise.race([all, new Promise<void>((resolve) => setTimeout(resolve, ms))]);
}
