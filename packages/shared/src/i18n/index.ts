import { en } from "./en.js";
import { fr } from "./fr.js";
import type { Message, MessageKey, Messages } from "./types.js";

export type { Message, MessageKey, Messages } from "./types.js";

export const LOCALES = ["en", "fr"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** Each language's name, written in that language. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", fr: "Français" };

const CATALOGUES: Record<Locale, Messages> = { en, fr };

/** Locale used by Intl to format dates and numbers. */
const INTL: Record<Locale, string> = { en: "en-US", fr: "fr-FR" };

let resolveLocale: () => Locale = () => DEFAULT_LOCALE;

/**
 * Tells t() where to find the current language: the browser keeps it in memory,
 * the server reads it from the request being handled.
 */
export function setLocaleResolver(resolve: () => Locale): void {
  resolveLocale = resolve;
}

export function currentLocale(): Locale {
  return resolveLocale();
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** The supported language that best matches a list like navigator.languages or an Accept-Language header. */
export function matchLocale(wanted: readonly string[] | string | null | undefined): Locale {
  const list = typeof wanted === "string" ? wanted.split(",").map((part) => part.split(";")[0]!.trim()) : (wanted ?? []);
  for (const tag of list) {
    const base = tag.toLowerCase().split("-")[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

/** BCP 47 tag for Intl.DateTimeFormat, Intl.NumberFormat and toLocaleString. */
export function intlLocale(locale: Locale = currentLocale()): string {
  return INTL[locale];
}

const plurals = new Map<Locale, Intl.PluralRules>();

function format(message: Message, locale: Locale, params?: Record<string, string | number>): string {
  let text: string;
  if (typeof message === "string") text = message;
  else {
    let rules = plurals.get(locale);
    if (!rules) plurals.set(locale, (rules = new Intl.PluralRules(INTL[locale])));
    text = rules.select(Number(params?.count ?? 0)) === "one" ? message.one : message.other;
  }
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (all, name: string) => {
    const value = params[name];
    if (value === undefined) return all;
    return typeof value === "number" ? value.toLocaleString(INTL[locale]) : value;
  });
}

/** Translates a message into the current language. "{name}" placeholders are filled from params. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  return tIn(currentLocale(), key, params);
}

/** Translates a message into a given language. */
export function tIn(locale: Locale, key: MessageKey, params?: Record<string, string | number>): string {
  return format(CATALOGUES[locale][key] ?? en[key], locale, params);
}

/** Whether a string is a message key (for messages that travel as keys, like validation errors). */
export function isMessageKey(key: string): key is MessageKey {
  return Object.hasOwn(en, key);
}

/** A text that can be given in several languages, like a plugin's name: "Name" or { en: "Name", fr: "Nom" }. */
export type LocalizedText = string | Partial<Record<string, string>>;

export function localized(text: LocalizedText | undefined, locale: Locale = currentLocale()): string {
  if (text === undefined) return "";
  if (typeof text === "string") return text;
  return text[locale] ?? text[DEFAULT_LOCALE] ?? Object.values(text)[0] ?? "";
}
