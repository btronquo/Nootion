import { isLocale, matchLocale, setLocaleResolver, type Locale } from "@nootion/shared";

// The interface language: the signed-in user's choice, otherwise the browser's.
// The last one used is remembered so the loading screen already speaks it.
const STORAGE_KEY = "nootion-locale";

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    // Storage blocked: fall back to the browser's language.
  }
  return matchLocale(navigator.languages);
}

let locale: Locale = initialLocale();
setLocaleResolver(() => locale);
document.documentElement.lang = locale;

/** Switches the language of everything rendered from now on (components must re-render to show it). */
export function setLocale(next: Locale) {
  locale = next;
  document.documentElement.lang = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Not remembered: the next visit uses the browser's language until the user is known.
  }
}
