import { z } from "zod";
import { t } from "./i18n/index.js";

/** A quick note for the inbox: a text (its first line becomes the title unless one is given) and maybe a link. */
export const captureInput = z
  .object({
    text: z.string().max(100_000).default(""),
    title: z.string().max(500).optional(),
    url: z.string().max(4000).optional(),
  })
  .refine((v) => v.text.trim() || v.title?.trim() || v.url?.trim(), { error: () => t("inbox.empty") });
export type CaptureInput = z.infer<typeof captureInput>;

export interface InboxItem {
  id: string;
  title: string;
  icon: string | null;
  createdAt: string;
}

export interface Inbox {
  pageId: string;
  /** The notes still in the inbox, the newest first. */
  items: InboxItem[];
}
