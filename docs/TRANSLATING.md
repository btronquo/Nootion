# Translating Nootion

Nootion's interface is available in English, French, German, Spanish and Italian. Each person picks their language in
**My account › Language** (or with the command palette: `Ctrl+K`, then "Language"); until they do, the browser's
language is used, and visitors of public pages get theirs. A language that isn't finished yet shows its progress in the
menu ("Polski (62 %)"): the texts it lacks are shown in English, one by one, so a partial translation is already useful.

What follows the language:

- every text of the interface, the e-mails and the server's messages;
- dates, times and numbers (`1.500` in German, `1 500` in French), and plurals;
- the names and keywords of emojis in the icon picker, and the validation messages of forms.

Dates written in plain words in a page (`@tomorrow 9am`, `@morgen um 9 Uhr`, `@el próximo viernes`, `@domani alle 15`)
are understood in every language, whatever the one chosen.

## Adding or finishing a language

You need Node.js 22 and pnpm (see [CONTRIBUTING.md](../CONTRIBUTING.md)).

1. Copy `packages/shared/src/i18n/en.ts` to `packages/shared/src/i18n/<code>.ts` (`pl.ts`, `pt.ts`…), name the
   export after the code and type it `Catalogue`:

   ```ts
   import type { Catalogue } from "./types.js";

   export const pl: Catalogue = {
     "account.addPhoto": "Dodaj zdjęcie",
     // …
   };
   ```

   You can translate a part and leave the rest out: missing texts are shown in English.

2. Register it in `packages/shared/src/i18n/index.ts`: add the code to `LOCALES`, its name written in the language to
   `LOCALE_NAMES`, the catalogue to `CATALOGUES` and the Intl locale (`pl-PL`) to `INTL`. If
   [Zod](https://zod.dev) has the language, add it to `i18n/zod.ts`; if
   [emojibase-data](https://github.com/milesj/emojibase) has it, add it to `EMOJI_DATA` in
   `apps/web/src/components/IconPicker.tsx`.

3. Check it:

   ```bash
   pnpm i18n:check pl          # this language only
   pnpm i18n:check pl --list   # and list the texts still missing
   ```

   It says how much is translated and lists what must be fixed: texts that no longer exist in `en.ts`, placeholders
   (`{count}`, `{name}`) or bold marks (`<b>…</b>`) that differ from English, and plural forms the language doesn't
   have. Those fail the check (and the CI); missing texts are only a warning.

4. Run `pnpm test`, then open a pull request.

## Rules of the catalogues

- `en.ts` is the reference: a new text is added there first, then in `fr.ts`, which must stay complete (TypeScript
  and a test check it). The other languages follow when their translators update them; `pnpm i18n:check` lists what
  changed.
- Keep the placeholders as they are: `{name}` is replaced by a value, and its position in the sentence is yours to
  choose. `<b>…</b>` marks words in bold. `{{row.<column>}}` and the formula examples (`prop("Price")`, `dateAdd()`)
  are what people type: translate the column names in the examples, not the function names.
- A text with a count is written with its plural forms, chosen by the `count` parameter with
  [Intl.PluralRules](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl/PluralRules):
  `{ one: "{count} page", other: "{count} pages" }`. Languages with more forms add them (`zero`, `two`, `few`,
  `many`), for example in Polish `{ one: "{count} strona", few: "{count} strony", many: "{count} stron", other: "{count}
  strony" }`. `other` is always required; a form a language needs but the catalogue lacks falls back to `other`.
- The tone is the one of the English texts: short, plain words, addressing the person directly. French uses "vous";
  German, Spanish and Italian use the informal "du", "tú" and "tu", as most apps do in those languages.
- Keep product names as they are (Nootion, Nextcloud, Google Calendar, Entra ID…).

Right-to-left languages (Arabic, Hebrew) need layout changes beyond the texts; they will come separately.

## Plain-word dates

The words understood in dates written in a page (`@demain 9h`, `@next friday`) are in
`packages/shared/src/dates.ts`: days of the week, months, numbers, units ("days", "Tage", "giorni") and phrases such
as "tomorrow" or "in 3 days". A new language adds its words there, with tests in `apps/server/test/dates.test.ts`.
Abbreviations that mean something else in another language ("mar" is March and Tuesday) are left out.
