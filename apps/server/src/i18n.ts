import { AsyncLocalStorage } from "node:async_hooks";
import type { FastifyRequest } from "fastify";
import { DEFAULT_LOCALE, isLocale, matchLocale, setLocaleResolver, type Locale } from "@nootion/shared";

// Messages built while handling a request (errors, exports, default names) use the language of the
// signed-in user, or the browser's language for visitors.
const storage = new AsyncLocalStorage<Locale>();
setLocaleResolver(() => storage.getStore() ?? DEFAULT_LOCALE);

export function requestLocale(req: FastifyRequest): Locale {
  if (req.user && isLocale(req.user.locale)) return req.user.locale;
  return matchLocale(req.headers["accept-language"]);
}

/** Runs `fn` with t() translating into `locale`. */
export function withLocale<T>(locale: Locale, fn: () => T): T {
  return storage.run(locale, fn);
}
