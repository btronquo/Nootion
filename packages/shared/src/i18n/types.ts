import type { en } from "./en.js";

/**
 * Plural forms of a message, chosen with the "count" parameter by Intl.PluralRules. English and French only need
 * "one" and "other"; languages like Polish, Russian or Arabic add "zero", "two", "few" or "many". "other" is required.
 */
export type PluralForms = { other: string } & Partial<Record<Exclude<Intl.LDMLPluralRule, "other">, string>>;
/** A message, or its plural forms. */
export type Message = string | PluralForms;
export type MessageKey = keyof typeof en;
/** A complete catalogue: every message of en.ts. */
export type Messages = Record<MessageKey, Message>;
/** A language's catalogue, which may lack messages (they're shown in English). */
export type Catalogue = Partial<Messages>;
