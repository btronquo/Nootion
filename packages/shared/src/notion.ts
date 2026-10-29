import { z } from "zod";

/** Starts an import from Notion into a space. The token can be left out to import again with the saved one. */
export const notionImportInput = z.object({
  workspaceId: z.string().min(1),
  /** Notion integration secret ("ntn_…" or "secret_…"). */
  token: z.string().trim().min(10).max(200).optional(),
  /** Page of the space under which Notion's top-level pages go; the root of the space when left out. */
  parentId: z.string().min(1).nullable().optional(),
});
export type NotionImportInput = z.infer<typeof notionImportInput>;

export interface NotionImportReport {
  pages: number;
  databases: number;
  rows: number;
  files: number;
  /** Pages imported before and changed in Notion since: their content was replaced. */
  updated: number;
  /** Pages imported before and unchanged in Notion. */
  unchanged: number;
  /** What couldn't be imported as it was, by kind (messages "notion.note.<kind>"). */
  notes: Record<string, number>;
  /** Formulas Nootion can't compute: their values were kept in a plain column. */
  formulas: { database: string; name: string; reason: string }[];
}

export interface NotionImportJob {
  id: string;
  workspaceId: string;
  status: "running" | "done" | "failed";
  /** Step in progress: "discover", "databases", "pages", "rows", "content". */
  phase: string;
  done: number;
  total: number;
  report: NotionImportReport;
  error: string | null;
  startedAt: number;
}

/** What the import screen shows for a space. */
export interface NotionImportStatus {
  /** A token is saved: the space can be imported again without typing it. */
  connected: boolean;
  lastImportAt: string | null;
  job: NotionImportJob | null;
}
