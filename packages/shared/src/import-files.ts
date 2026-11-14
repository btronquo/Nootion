import type { NotionImportDetail } from "./notion.js";

/** Extensions the import from files reads as pages, databases or archives; any other file is copied as an attached file. */
export const FILE_IMPORT_PAGE_EXTENSIONS = [".md", ".markdown", ".txt", ".html", ".htm", ".docx"] as const;
export const FILE_IMPORT_ACCEPT = [...FILE_IMPORT_PAGE_EXTENSIONS, ".csv", ".zip"].join(",");

/** What an import from files brought in, and what it imported differently. */
export interface FileImportReport {
  pages: number;
  databases: number;
  rows: number;
  /** Images and other files copied. */
  files: number;
  /** Links between the imported files that now link the pages to each other. */
  links: number;
  /** What couldn't be imported as it was, by kind (messages "fileImport.note.<kind>"). */
  notes: Record<string, number>;
  /** The same, one entry per file or link concerned (at most FILE_IMPORT_DETAILS_MAX per kind). "where" is the file's path in the import. */
  details: Record<string, NotionImportDetail[]>;
}

export const FILE_IMPORT_DETAILS_MAX = 500;

export interface FileImportJob {
  id: string;
  workspaceId: string;
  status: "running" | "done" | "failed";
  /** Step in progress: "read", "pages", "content". */
  phase: string;
  done: number;
  total: number;
  report: FileImportReport;
  error: string | null;
  startedAt: number;
  /** What the import made went to the trash ("Undo the import"). */
  undone: boolean;
  /** Names of the files sent, to recognise the import. */
  sources: string[];
}

/** The latest import from files of a space, for whoever started it. */
export interface FileImportStatus {
  job: FileImportJob | null;
}
