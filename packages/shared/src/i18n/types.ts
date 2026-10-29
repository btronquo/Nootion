import type { en } from "./en.js";

/** A message, or its plural forms (chosen with the "count" parameter). */
export type Message = string | { one: string; other: string };
export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, Message>;
