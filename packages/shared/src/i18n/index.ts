import { de } from "./de.js";
import { en } from "./en.js";
import { es } from "./es.js";
import { fr } from "./fr.js";
import { it } from "./it.js";
import type { Catalogue, Message, MessageKey } from "./types.js";

export type { Catalogue, Message, MessageKey, Messages, PluralForms } from "./types.js";

/**
 * The languages shipped. Adding one: copy en.ts to <code>.ts, translate it (a partial file works: missing texts are
 * shown in English), add it here and below, then run `pnpm i18n:check`. See docs/TRANSLATING.md.
 */
export const LOCALES = ["en", "fr", "de", "es", "it"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** Each language's name, written in that language. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", fr: "Français", de: "Deutsch", es: "Español", it: "Italiano" };

/** English is the reference: every other catalogue may lack texts, which are then shown in English. */
export const CATALOGUES: Record<Locale, Catalogue> = { en, fr, de, es, it };

/** Locale used by Intl to format dates and numbers. */
const INTL: Record<Locale, string> = { en: "en-US", fr: "fr-FR", de: "de-DE", es: "es-ES", it: "it-IT" };

const completions = new Map<Locale, number>();

/** How much of a language is translated, in percent (rounded down: 100 only when nothing is missing). */
export function completion(locale: Locale): number {
  let done = completions.get(locale);
  if (done === undefined) {
    const keys = Object.keys(en);
    const catalogue = CATALOGUES[locale];
    const translated = keys.filter((key) => Object.hasOwn(catalogue, key)).length;
    completions.set(locale, (done = Math.floor((translated * 100) / keys.length)));
  }
  return done;
}

/** A language's name for menus, with how much of it is translated when it isn't finished: "Deutsch (87 %)". */
export function localeLabel(locale: Locale): string {
  const done = completion(locale);
  return done < 100 ? `${LOCALE_NAMES[locale]} (${numberFormat({ style: "percent" }, INTL[locale]).format(done / 100)})` : LOCALE_NAMES[locale];
}

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

/**
 * Intl formatters are slow to build (much slower than to use): the ones asked for are kept, by locale and options,
 * so that formatting thousands of cells or formula results stays fast.
 */
const formatters = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat | Intl.Collator>();
function cached<T extends Intl.NumberFormat | Intl.DateTimeFormat | Intl.Collator>(kind: string, locale: string, options: object | undefined, make: () => T): T {
  const key = `${kind}|${locale}|${options ? JSON.stringify(options) : ""}`;
  let f = formatters.get(key) as T | undefined;
  if (!f) {
    if (formatters.size > 500) formatters.clear();
    formatters.set(key, (f = make()));
  }
  return f;
}
export const numberFormat = (options?: Intl.NumberFormatOptions, locale: string = intlLocale()) =>
  cached("n", locale, options, () => new Intl.NumberFormat(locale, options));
export const dateTimeFormat = (options?: Intl.DateTimeFormatOptions, locale: string = intlLocale()) =>
  cached("d", locale, options, () => new Intl.DateTimeFormat(locale, options));
export const collator = (options?: Intl.CollatorOptions, locale: string = intlLocale()) =>
  cached("c", locale, options, () => new Intl.Collator(locale, options));

const plurals = new Map<Locale, Intl.PluralRules>();

/** `textLocale` is the language the message is written in (English for a missing translation), for its plural forms. */
function format(message: Message, locale: Locale, textLocale: Locale, params?: Record<string, string | number>): string {
  let text: string;
  if (typeof message === "string") text = message;
  else {
    let rules = plurals.get(textLocale);
    if (!rules) plurals.set(textLocale, (rules = new Intl.PluralRules(INTL[textLocale])));
    // Each language has its own plural forms (Polish has "few" and "many", Arabic six of them): the one Intl picks for
    // the count, or "other" when the catalogue doesn't give it.
    text = message[rules.select(Number(params?.count ?? 0))] ?? message.other;
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
  const message = CATALOGUES[locale][key];
  return message === undefined ? format(en[key], locale, DEFAULT_LOCALE, params) : format(message, locale, locale, params);
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
