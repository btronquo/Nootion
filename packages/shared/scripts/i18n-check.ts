// Checks the interface's translations against en.ts, the reference: `pnpm i18n:check [language…] [--list] [--strict]`.
//
// For each language it lists the texts still missing (shown in English meanwhile), the texts that no longer exist in
// en.ts, the placeholders ("{count}") and bold marks ("<b>") that differ from English, and plural forms the language
// doesn't have. Missing texts are only a warning, unless --strict; the other problems fail, since they show wrong text.
import { en } from "../src/i18n/en.js";
import { CATALOGUES, completion, LOCALE_NAMES, LOCALES, type Locale, type Message } from "../src/i18n/index.js";

const args = process.argv.slice(2);
const list = args.includes("--list");
const strict = args.includes("--strict");
const wanted = args.filter((a) => !a.startsWith("--"));
const unknown = wanted.filter((a) => !(LOCALES as readonly string[]).includes(a));
if (unknown.length) {
  console.error(`Unknown language: ${unknown.join(", ")}. Languages: ${LOCALES.join(", ")}.`);
  process.exit(2);
}
const locales = (wanted.length ? wanted : LOCALES.filter((l) => l !== "en")) as Locale[];
const github = process.env.GITHUB_ACTIONS === "true";

/** Placeholders and bold marks of a text, sorted, to compare them across languages. */
const marks = (text: string) => (text.match(/\{\w+\}|<\/?b>/g) ?? []).sort().join(" ");
const forms = (m: Message) => (typeof m === "string" ? { other: m } : m);

let failed = false;
const keys = Object.keys(en) as (keyof typeof en)[];

for (const locale of locales) {
  const catalogue = CATALOGUES[locale];
  const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories as string[];
  const missing = keys.filter((key) => !Object.hasOwn(catalogue, key));
  const obsolete = Object.keys(catalogue).filter((key) => !Object.hasOwn(en, key));
  const problems: string[] = [];

  for (const key of keys) {
    const message = catalogue[key];
    if (message === undefined) continue;
    const reference = en[key] as Message;
    if (typeof reference === "string" && typeof message !== "string") problems.push(`${key}: has plural forms, English doesn't`);
    if (typeof reference !== "string" && typeof message === "string") problems.push(`${key}: needs plural forms ({ one, other }…), as in English`);
    const expected = marks(forms(reference).other);
    for (const [form, text] of Object.entries(forms(message))) {
      if (text === undefined) continue;
      if (form !== "other" && !categories.includes(form)) problems.push(`${key}: plural form "${form}" doesn't exist in ${locale} (${categories.join(", ")})`);
      // "{count}" may be left out of the singular ("Une page"), not of the other forms.
      const got = marks(text);
      if (got !== expected && !(form !== "other" && got === marks(forms(reference).other.replace("{count}", "")))) {
        problems.push(`${key}${typeof message === "string" ? "" : ` (${form})`}: "${got}" instead of "${expected}"`);
      }
    }
    if (typeof message !== "string") {
      const lacking = categories.filter((c) => c !== "other" && !(c in message) && (c === "one" || c === "few" || c === "two"));
      if (lacking.length) problems.push(`${key}: plural forms missing for ${locale}: ${lacking.join(", ")}`);
    }
  }

  const name = `${LOCALE_NAMES[locale]} (${locale})`;
  console.log(`\n${name}: ${completion(locale)} % translated, ${missing.length} missing, ${obsolete.length} no longer in en.ts, ${problems.length} to fix`);
  if (missing.length) {
    if (github) console.log(`::warning title=Translation::${name}: ${missing.length} texts are not translated yet (shown in English).`);
    if (list) for (const key of missing) console.log(`  missing   ${key}`);
    else console.log("  (--list to see the missing texts)");
    if (strict) failed = true;
  }
  for (const key of obsolete) console.log(`  obsolete  ${key}`);
  for (const p of problems) console.log(`  fix       ${p}`);
  if (obsolete.length || problems.length) {
    failed = true;
    if (github) console.log(`::error title=Translation::${name}: ${obsolete.length + problems.length} texts to fix (see the log).`);
  }
}

process.exit(failed ? 1 : 0);
