import { z } from "zod";
import { currentLocale, type Locale } from "./index.js";

// Zod's own validation messages follow the current language too.
const zodLocales: Record<Locale, { localeError: z.core.$ZodErrorMap }> = {
  en: z.locales.en(),
  fr: z.locales.fr(),
  de: z.locales.de(),
  es: z.locales.es(),
  it: z.locales.it(),
};
z.config({ localeError: (issue) => zodLocales[currentLocale()].localeError(issue) });
