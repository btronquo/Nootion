import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import yauzl from "yauzl";
import mammoth from "mammoth";
import { parse as parseHtmlDom } from "node-html-parser";
import { FILE_IMPORT_DETAILS_MAX, t, type CellValue, type FileImportJob, type NotionImportDetail } from "@nootion/shared";
import type { Db } from "./db/index.js";
import { attachments, databaseProperties, databaseViews, pages } from "./db/schema.js";
import { fileStore } from "./files.js";
import { appendContent, writeContent, type Collab, type ProseMirrorNode } from "./collab.js";
import { assignUniqueIds } from "./databases.js";
import { nextPosition } from "./pages.js";
import { IMPORT_MAX_ROWS, parseCsv, planImport } from "./import.js";
import { checkContent, parseMarkdown, splitFrontMatter, type ImportedFile, type MarkdownLinks } from "./markdown-in.js";
import { parseHtml } from "./html-in.js";

/** The job, with what only the server keeps: who started it and the pages it made at the top (for undoing it). */
export type FileImportServerJob = FileImportJob & { userId: string; parentId: string | null; created: string[] };

/** A file of the import, written to a temporary folder until the import is over. */
export interface SourceFile {
  /** Its path in the import ("Vault/Notes/Idea.md"), with "/" between folders. */
  path: string;
  size: number;
  /** Where its bytes are on disk. */
  disk: string;
}

export interface ImportLimits {
  /** Largest file taken from an archive (the limit of attached files). */
  maxFileBytes: number;
  /** All the files of the archives together, once uncompressed: stops archives that grow beyond reason. */
  maxTotalBytes: number;
  /** Files in the archives together. */
  maxEntries: number;
}

export interface FileImportOptions {
  db: Db;
  collab: Collab;
  dataDir: string;
  /** The files sent: each a page, a database (CSV), a file, or an archive (zip) of them. */
  uploads: { name: string; disk: string; size: number }[];
  /** Folder where archives are unpacked; removed by the caller. */
  workDir: string;
  limits: ImportLimits;
  workspaceId: string;
  parentId: string | null;
  userId: string;
  job: FileImportServerJob;
  log?: (message: string, data?: Record<string, unknown>) => void;
}

const PAGE_EXT = new Set([".md", ".markdown", ".txt", ".html", ".htm", ".docx"]);
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const MAX_NODES = 100_000;
/** Folders and files tools keep for themselves: their settings, the trash, the system's files. */
const SKIPPED = /(^|\/)(__MACOSX|\.obsidian|\.trash|\.git|\.vscode|\.idea|node_modules|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)|(^|\/)\._/i;

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".heic": "image/heic",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".json": "application/json",
  ".zip": "application/zip",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".excalidraw": "application/json",
  ".canvas": "application/json",
};
const mimeOf = (name: string) => MIME[path.extname(name).toLowerCase()] ?? "application/octet-stream";
const EXT_OF_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "image/bmp": ".bmp",
};

/** A file or folder's name as a title: without its extension, nor the id other tools add to it ("Page 0123…cdef"). */
export function cleanName(name: string, isFile: boolean): string {
  const base = isFile ? name.replace(/\.[^./]{1,10}$/, "") : name;
  return base
    .replace(/_all$/, "")
    .replace(/\s+[0-9a-f]{32}$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A path inside an archive, made safe: "/" between folders, none going above the archive or to the root of a disk. */
export function safeEntryPath(raw: string): string | null {
  const p = raw.replace(/\\/g, "/");
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p) || p.includes("\0")) return null;
  const parts: string[] = [];
  for (const seg of p.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") return null;
    parts.push(seg);
  }
  return parts.length ? parts.join("/") : null;
}

const decodeName = (raw: Buffer, utf8: boolean) => {
  if (utf8) return raw.toString("utf8");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    return raw.toString("latin1");
  }
};

/**
 * Unpacks an archive into `workDir`, entry by entry, counting the bytes really written: an archive cannot claim
 * small sizes and grow beyond the limits. Entries are stored under numbered names, never under their own path.
 */
async function unzip(
  file: string,
  prefix: string,
  workDir: string,
  limits: ImportLimits,
  state: { total: number; entries: number; nested: number },
  note: (what: string, detail?: NotionImportDetail) => void,
): Promise<SourceFile[]> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true, decodeStrings: false, autoClose: true, strictFileNames: false, validateEntrySizes: true }, (err, z) =>
      err || !z ? reject(err ?? new Error("zip")) : resolve(z),
    ),
  );
  const out: SourceFile[] = [];
  const nested: { disk: string; path: string }[] = [];
  await new Promise<void>((resolve, reject) => {
    zip.on("error", reject);
    zip.on("end", resolve);
    zip.on("entry", (entry: yauzl.Entry) => {
      const raw = decodeName(entry.fileName as unknown as Buffer, (entry.generalPurposeBitFlag & 0x800) !== 0);
      const name = raw.endsWith("/") ? null : safeEntryPath(raw);
      if (!name) {
        if (!raw.endsWith("/")) note("unsafePath", { where: raw.slice(0, 300) });
        zip.readEntry();
        return;
      }
      const full = prefix ? `${prefix}/${name}` : name;
      if (SKIPPED.test(full)) {
        zip.readEntry();
        return;
      }
      if (++state.entries > limits.maxEntries) {
        reject(new ImportLimitError(t("fileImport.error.tooManyFiles", { max: limits.maxEntries })));
        return;
      }
      if (entry.uncompressedSize > limits.maxFileBytes) {
        note("fileTooLarge", { where: full });
        zip.readEntry();
        return;
      }
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) {
          note("unreadable", { where: full });
          zip.readEntry();
          return;
        }
        const disk = path.join(workDir, `e${state.entries}`);
        const sink = fs.createWriteStream(disk);
        let size = 0;
        let failed: Error | null = null;
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          state.total += chunk.length;
          if (state.total > limits.maxTotalBytes) {
            failed = new ImportLimitError(t("fileImport.error.tooLarge", { max: Math.round(limits.maxTotalBytes / 1024 / 1024) }));
            stream.destroy();
          }
        });
        stream.on("error", (e) => {
          failed ??= e;
          sink.destroy();
        });
        stream.pipe(sink);
        const done = () => {
          if (failed instanceof ImportLimitError) return reject(failed);
          if (failed) {
            note("unreadable", { where: full });
            fs.rmSync(disk, { force: true });
          } else if (/\.zip$/i.test(full) && state.nested < 20) {
            // Exports split in parts are archives inside the archive: their files go in the same folder.
            state.nested++;
            nested.push({ disk, path: full.split("/").slice(0, -1).join("/") });
          } else out.push({ path: full, size, disk });
          zip.readEntry();
        };
        sink.on("close", done);
      });
    });
    zip.readEntry();
  });
  for (const n of nested) {
    try {
      out.push(...(await unzip(n.disk, n.path, workDir, limits, state, note)));
    } catch (e) {
      if (e instanceof ImportLimitError) throw e;
      note("unreadable", { where: n.path || path.basename(n.disk) });
    }
  }
  return out;
}

export class ImportLimitError extends Error {}

/** A page, database or folder of the import, as the tree of pages it becomes. */
interface ImportNode {
  name: string;
  kind: "page" | "database" | "folder";
  /** The page's own file (Markdown, HTML, Word, text). */
  file?: SourceFile;
  /** The database's rows. */
  csv?: SourceFile;
  /** Other paths that stand for this node (the short CSV beside the full "_all" one). */
  aliases?: string[];
  children: ImportNode[];
  /** Files of the folder this node stands for that are neither pages nor databases. */
  assets: SourceFile[];
  /** The folder it stands for, if any ("Vault/Notes"). */
  dir?: string;
  isRow?: boolean;
  // Filled when the page is made.
  pageId?: string;
  title?: string;
  rowValues?: { title: string; values: Record<string, CellValue> };
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** The files as a tree: folders become pages; "Page.md" beside a "Page/" folder is that folder's page, "Table.csv" beside "Table/" a database with its rows. */
export function buildTree(files: SourceFile[]): ImportNode[] {
  const dirs = new Map<string, { files: SourceFile[]; subdirs: Set<string> }>();
  const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  const ensure = (d: string) => {
    let x = dirs.get(d);
    if (!x) {
      dirs.set(d, (x = { files: [], subdirs: new Set() }));
      if (d) ensure(dirOf(d)).subdirs.add(d);
    }
    return x;
  };
  ensure("");
  for (const f of files) ensure(dirOf(f.path)).files.push(f);

  const build = (dir: string): { nodes: ImportNode[]; assets: SourceFile[] } => {
    const entry = dirs.get(dir)!;
    const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);
    const stem = (p: string) => base(p).replace(/\.[^.]+$/, "");
    const pageFiles = new Map<string, SourceFile>();
    const csvs = new Map<string, SourceFile>();
    const others: SourceFile[] = [];
    for (const f of entry.files) {
      const ext = path.extname(f.path).toLowerCase();
      if (PAGE_EXT.has(ext)) {
        const key = stem(f.path).toLowerCase();
        // Two files for one page (Page.md and Page.html): the first one read.
        if (!pageFiles.has(key)) pageFiles.set(key, f);
        else others.push(f);
      } else if (ext === ".csv") csvs.set(stem(f.path).toLowerCase(), f);
      else others.push(f);
    }
    // Exports with "Table.csv" and "Table_all.csv": the full one, links to either leading to it.
    const csvAliases = new Map<string, string[]>();
    for (const [key, f] of [...csvs]) {
      if (key.endsWith("_all")) {
        const short = key.slice(0, -4);
        const other = csvs.get(short);
        if (other) csvAliases.set(short, [other.path]);
        csvs.delete(key);
        csvs.set(short, f);
      }
    }
    // The JSON a CSV comes with (Nootion's exports): the CSV is enough.
    const assets = others.filter((f) => !(path.extname(f.path).toLowerCase() === ".json" && csvs.has(stem(f.path).toLowerCase())));
    const nodes: ImportNode[] = [];
    const usedPages = new Set<string>();
    const usedCsvs = new Set<string>();
    for (const sub of entry.subdirs) {
      const key = base(sub).toLowerCase();
      const inner = build(sub);
      const csv = csvs.get(key);
      const own = pageFiles.get(key);
      if (csv && !usedCsvs.has(key)) {
        usedCsvs.add(key);
        nodes.push({
          name: cleanName(base(sub), false),
          kind: "database",
          csv,
          aliases: csvAliases.get(key),
          children: inner.nodes,
          assets: inner.assets,
          dir: sub,
        });
      } else if (own && !usedPages.has(key)) {
        usedPages.add(key);
        nodes.push({ name: cleanName(base(sub), false), kind: "page", file: own, children: inner.nodes, assets: inner.assets, dir: sub });
      } else {
        // A folder note: "Folder/Folder.md" is the folder's page.
        const noteAt = inner.nodes.findIndex((n) => n.kind === "page" && n.file && !n.dir && stem(n.file.path).toLowerCase() === key);
        const folderNote = noteAt >= 0 ? inner.nodes.splice(noteAt, 1)[0]! : null;
        nodes.push({
          name: cleanName(base(sub), false),
          kind: folderNote ? "page" : "folder",
          ...(folderNote ? { file: folderNote.file } : {}),
          children: inner.nodes,
          assets: inner.assets,
          dir: sub,
        });
      }
    }
    for (const [key, f] of pageFiles)
      if (!usedPages.has(key)) nodes.push({ name: cleanName(base(f.path), true), kind: "page", file: f, children: [], assets: [] });
    for (const [key, f] of csvs)
      if (!usedCsvs.has(key))
        nodes.push({
          name: cleanName(base(f.path), true).replace(/_all$/, ""),
          kind: "database",
          csv: f,
          aliases: csvAliases.get(key),
          children: [],
          assets: [],
        });
    nodes.sort((a, b) => collator.compare(a.name, b.name));
    // A folder holding nothing to import stays out.
    return { nodes: nodes.filter((n) => n.kind !== "folder" || n.children.length || n.assets.length), assets };
  };
  const top = build("");
  // Files at the top with no page of their own: in a page named after nothing would be odd, they are kept apart.
  return top.assets.length ? [...top.nodes, { name: "", kind: "folder", children: [], assets: top.assets, dir: "" }] : top.nodes;
}

/** Reads the files sent (unpacking archives) as the files of the import. */
async function readUploads(
  o: FileImportOptions,
  note: (what: string, detail?: NotionImportDetail) => void,
): Promise<{ roots: { name: string; files: SourceFile[]; archive: boolean }[] }> {
  const state = { total: 0, entries: 0, nested: 0 };
  const roots: { name: string; files: SourceFile[]; archive: boolean }[] = [];
  for (const up of o.uploads) {
    const name = up.name.replace(/[\\/]/g, "_");
    if (/\.zip$/i.test(name)) {
      try {
        roots.push({ name: cleanName(name, true), files: await unzip(up.disk, "", o.workDir, o.limits, state, note), archive: true });
      } catch (e) {
        if (e instanceof ImportLimitError) throw e;
        note("unreadable", { where: name });
      }
    } else roots.push({ name, files: [{ path: name, size: up.size, disk: up.disk }], archive: false });
    o.job.done++;
  }
  return { roots };
}

const readText = (f: SourceFile) => {
  const buf = fs.readFileSync(f.disk);
  return (buf.length > MAX_TEXT_BYTES ? buf.subarray(0, MAX_TEXT_BYTES) : buf).toString("utf8").replace(/^﻿/, "");
};

const EMOJI = /^\p{Extended_Pictographic}/u;

/** Imports files (pages in Markdown, HTML, Word or text, databases in CSV, archives of them) into a space, in the background. */
export async function runFileImport(o: FileImportOptions): Promise<void> {
  const { db, job } = o;
  const report = job.report;
  const log = o.log ?? (() => {});
  const noted = new Set<string>();
  const note = (what: string, detail?: NotionImportDetail) => {
    if (detail) {
      const key = JSON.stringify([what, detail.where, detail.item ?? "", detail.info ?? ""]);
      if (noted.has(key)) return;
      noted.add(key);
      const list = (report.details[what] ??= []);
      if (list.length < FILE_IMPORT_DETAILS_MAX) list.push(detail);
    }
    report.notes[what] = (report.notes[what] ?? 0) + 1;
  };
  const step = (phase: string, total: number) => {
    log(`File import: ${phase}`, { total });
    Object.assign(job, { phase, done: 0, total });
  };

  // --- 1. The files, archives unpacked ----------------------------------------------------------
  step("read", o.uploads.length);
  const { roots } = await readUploads(o, note);
  const top: ImportNode[] = [];
  for (const root of roots) {
    const nodes = buildTree(root.files);
    // An archive holding one page (with its subpages) is that page; otherwise a page named after the archive holds them.
    if (!root.archive || nodes.length === 1) top.push(...nodes);
    else if (nodes.length) top.push({ name: root.name, kind: "folder", children: nodes, assets: [] });
  }
  // Loose files at the top of an archive or sent alone: under a page of their own.
  for (const n of top) if (n.kind === "folder" && !n.name) n.name = t("fileImport.filesPage");

  const allFiles = roots.flatMap((r) => r.files);
  // Where each file is linked from: paths as written in the archive (or the file's name when sent alone).
  const byPath = new Map<string, { node?: ImportNode; file?: SourceFile }>();
  const byName = new Map<string, { node?: ImportNode; file?: SourceFile }[]>();
  const key = (p: string) => p.normalize("NFC").toLowerCase();
  const addName = (name: string, target: { node?: ImportNode; file?: SourceFile }) => {
    const k = key(name);
    const list = byName.get(k) ?? [];
    list.push(target);
    byName.set(k, list);
  };
  const visit = (n: ImportNode, rows = false) => {
    if (rows) n.isRow = true;
    if (n.file) byPath.set(key(n.file.path), { node: n });
    if (n.csv) byPath.set(key(n.csv.path), { node: n });
    for (const a of n.aliases ?? []) byPath.set(key(a), { node: n });
    if (n.dir) byPath.set(key(n.dir), { node: n });
    if (n.kind !== "folder" || n.dir) {
      addName(n.name, { node: n });
      if (n.file) addName(path.basename(n.file.path).replace(/\.[^.]+$/, ""), { node: n });
    }
    n.children.forEach((c) => visit(c, n.kind === "database"));
  };
  top.forEach((n) => visit(n));
  for (const f of allFiles) {
    if (byPath.has(key(f.path))) continue;
    byPath.set(key(f.path), { file: f });
    addName(path.basename(f.path), { file: f });
  }

  // --- 2. Pages, databases and rows, so links can point to them -------------------------------------------
  const count = (nodes: ImportNode[]): number => nodes.reduce((s, n) => s + 1 + count(n.children), 0);
  step("pages", count(top));

  const titleOf = (n: ImportNode): { title: string; icon: string | null } => {
    if (!n.file) return { title: n.name, icon: null };
    const ext = path.extname(n.file.path).toLowerCase();
    try {
      if (ext === ".md" || ext === ".markdown") {
        const { data, body } = splitFrontMatter(readText(n.file));
        const fmTitle = typeof data.title === "string" ? data.title.trim() : "";
        const h1 = /^\s*#\s+(.+?)\s*#*\s*$/m.exec(body.split("\n").find((l) => l.trim()) ?? "")?.[1];
        const icon = typeof data.icon === "string" && EMOJI.test(data.icon.trim()) ? data.icon.trim().slice(0, 16) : null;
        // The title written in the file, else its name.
        return { title: fmTitle || h1?.trim() || n.name, icon };
      }
      if (ext === ".html" || ext === ".htm") {
        const dom = parseHtmlDom(readText(n.file), { blockTextElements: { script: true, style: true } });
        const iconText = dom.querySelector(".page-header-icon .icon")?.text.trim() ?? "";
        // As parseHtml finds it: the exported title, the <title>, or the first heading.
        const title = dom.querySelector(".page-title")?.text.trim() || dom.querySelector("title")?.text.trim() || dom.querySelector("h1")?.text.trim();
        return { title: title || n.name, icon: EMOJI.test(iconText) ? iconText.slice(0, 16) : null };
      }
    } catch {
      // Read again with its content, where a failure is noted.
    }
    return { title: n.name, icon: null };
  };

  const insertPage = (n: ImportNode, parentId: string | null, kind: "page" | "row", position: number, props?: Record<string, CellValue>) => {
    const { title, icon } = titleOf(n);
    const id = randomUUID();
    db.insert(pages)
      .values({
        id,
        workspaceId: o.workspaceId,
        parentId,
        kind,
        title: (n.rowValues?.title ?? title).slice(0, 500),
        icon,
        position,
        createdBy: o.userId,
        props: kind === "row" ? (props ?? {}) : null,
      })
      .run();
    n.pageId = id;
    n.title = (n.rowValues?.title ?? title).slice(0, 500);
    if (!parentId || parentId === o.parentId) job.created.push(id);
    return id;
  };

  const createDatabase = (n: ImportNode, parentId: string | null) => {
    const id = randomUUID();
    db.insert(pages)
      .values({
        id,
        kind: "database",
        workspaceId: o.workspaceId,
        parentId,
        title: n.name.slice(0, 500),
        position: nextPosition(db, o.workspaceId, parentId),
        createdBy: o.userId,
      })
      .run();
    db.insert(databaseViews)
      .values({ id: randomUUID(), databaseId: id, name: t("view.defaultTable"), type: "table", position: 0 })
      .run();
    n.pageId = id;
    n.title = n.name;
    if (!parentId || parentId === o.parentId) job.created.push(id);
    report.databases++;
    const csv = parseCsv(readText(n.csv!));
    const header = csv[0] ?? [];
    const titleProp = {
      id: randomUUID(),
      name: (header[0]?.trim() || t("database.defaultTitle")).slice(0, 100),
      type: "title" as const,
      config: {},
      position: 0,
    };
    db.insert(databaseProperties).values({ id: titleProp.id, databaseId: id, name: titleProp.name, type: "title", config: {}, position: 0 }).run();
    if (csv.length - 1 > IMPORT_MAX_ROWS) note("tooManyRows", { where: n.csv!.path, info: String(csv.length - 1) });
    const plan = planImport(db, [titleProp], csv.length ? csv : [[titleProp.name]], { createColumns: true, canLink: () => false });
    const newIds = new Map<string, string>();
    plan.newColumns.forEach((c, i) => {
      const colId = randomUUID();
      newIds.set(`new:${c.index}`, colId);
      db.insert(databaseProperties)
        .values({ id: colId, databaseId: id, name: c.name, type: c.type, config: c.config, position: i + 1 })
        .run();
    });
    for (const name of plan.ignored) note("columnIgnored", { where: n.csv!.path, item: name });
    // Rows, with the page of each one when the export has it (in the folder beside the CSV).
    const rowPages = new Map<string, ImportNode>();
    for (const c of n.children) if (c.kind === "page") rowPages.set(c.name.trim().toLowerCase(), c);
    const extra = [...n.children];
    plan.rows.forEach((row, position) => {
      const values = Object.fromEntries(Object.entries(row.values).map(([k, v]) => [newIds.get(k) ?? k, v]));
      const page = rowPages.get(row.title.trim().toLowerCase());
      if (page) {
        rowPages.delete(row.title.trim().toLowerCase());
        extra.splice(extra.indexOf(page), 1);
        page.rowValues = { title: row.title, values };
        insertPage(page, id, "row", position, values);
      } else {
        const rowNode: ImportNode = { name: row.title, kind: "page", children: [], assets: [], isRow: true, rowValues: { title: row.title, values } };
        insertPage(rowNode, id, "row", position, values);
      }
      report.rows++;
      job.done++;
    });
    // Pages of the folder that no row names: rows too, after the others.
    let position = plan.rows.length;
    for (const c of extra) {
      if (c.kind === "database") {
        // A database can't hold another one: it goes beside it.
        createDatabase(c, parentId);
        continue;
      }
      insertPage(c, id, "row", position++, {});
      report.rows++;
      job.done++;
      createChildren(c);
    }
    for (const c of n.children) if (c.pageId && c.isRow && c.kind !== "database" && !extra.includes(c)) createChildren(c);
    assignUniqueIds(db, id);
  };

  const createChildren = (n: ImportNode) => {
    for (const c of n.children) create(c, n.pageId!);
  };

  const create = (n: ImportNode, parentId: string | null) => {
    if (n.kind === "database") {
      createDatabase(n, parentId);
      job.done++;
      return;
    }
    insertPage(n, parentId, "page", nextPosition(db, o.workspaceId, parentId));
    report.pages++;
    job.done++;
    createChildren(n);
  };
  for (const n of top) create(n, o.parentId);

  // --- 3. Contents, with the links between files resolved -------------------------------------------------
  const withContent: ImportNode[] = [];
  const collect = (n: ImportNode) => {
    if (n.pageId && (n.file || n.assets.length)) withContent.push(n);
    n.children.forEach(collect);
  };
  top.forEach(collect);
  step("content", withContent.length);

  // Each file is copied once per page that shows it (a file belongs to one page, for its permissions).
  const copies = new Map<string, ImportedFile>();
  // The conversions are synchronous: a file's row is added at once, the file itself is stored by `storeFiles` right
  // after (its row keeps it from the orphan cleaner meanwhile).
  const store = fileStore(o.dataDir);
  let toStore: { id: string; data: Buffer | null; disk?: string; mimeType: string }[] = [];
  const storeFiles = async () => {
    const batch = toStore;
    toStore = [];
    for (const [i, f] of batch.entries()) {
      try {
        if (f.disk) {
          const tmp = store.tempPath();
          await fs.promises.copyFile(f.disk, tmp);
          await store.putFile(f.id, tmp, f.mimeType);
        } else await store.putBuffer(f.id, f.data!, f.mimeType);
      } catch (e) {
        for (const g of batch.slice(i)) db.delete(attachments).where(eq(attachments.id, g.id)).run();
        throw e;
      }
    }
  };
  const saveFile = (pageId: string, name: string, mimeType: string, data: Buffer | null, disk?: string, cacheKey?: string): ImportedFile | null => {
    const ck = cacheKey ? `${pageId}\n${cacheKey}` : null;
    if (ck && copies.has(ck)) return copies.get(ck)!;
    const id = randomUUID();
    toStore.push({ id, data, disk, mimeType });
    const size = disk ? fs.statSync(disk).size : data!.length;
    const filename = name.replace(/[\\/\r\n]/g, "_").slice(0, 255) || "file";
    db.insert(attachments).values({ id, pageId, filename, mimeType, size, createdBy: o.userId }).run();
    report.files++;
    const file = { url: `/api/attachments/${id}`, name: filename, size, mimeType };
    if (ck) copies.set(ck, file);
    return file;
  };
  const used = new Set<string>();

  const linksFor = (n: ImportNode): MarkdownLinks => {
    const from = n.file!.path;
    const resolve = (target: string, wiki: boolean): { node?: ImportNode; file?: SourceFile } | null => {
      let t = target.trim();
      if (!wiki) {
        t = t.replace(/[?#].*$/, "");
        try {
          t = decodeURIComponent(t);
        } catch {
          // Kept as written.
        }
      }
      t = t.replace(/\\/g, "/").replace(/^\.\//, "");
      if (!t) return null;
      if (!wiki) {
        const joined = path.posix.normalize(path.posix.join(path.posix.dirname(from), t)).replace(/^\.\//, "");
        for (const candidate of [joined, `${joined}.md`, t, `${t}.md`]) {
          const hit = byPath.get(key(candidate));
          if (hit) return hit;
        }
      }
      // [[Name]], or a link by name only: the page or file with that name (the closest one when several have it).
      const name = t.split("/").pop()!;
      const hits = byName.get(key(name)) ?? byName.get(key(name.replace(/\.md$/i, ""))) ?? [];
      if (!hits.length) return null;
      if (hits.length === 1 || !t.includes("/")) return closest(hits);
      return hits.find((h) => key(h.node?.file?.path ?? h.file?.path ?? "").endsWith(key(t))) ?? closest(hits);
    };
    // Among pages or files with the same name: the one in the linking file's folder (or below it), then the shortest path.
    const closest = (hits: { node?: ImportNode; file?: SourceFile }[]) => {
      const dir = path.posix.dirname(from);
      const p = (h: { node?: ImportNode; file?: SourceFile }) => h.node?.file?.path ?? h.node?.dir ?? h.file?.path ?? "";
      const near = (h: { node?: ImportNode; file?: SourceFile }) => (dir === "." || p(h).startsWith(`${dir}/`) ? 0 : 1);
      return [...hits].sort((a, b) => near(a) - near(b) || p(a).length - p(b).length)[0]!;
    };
    return {
      page: (target, wiki) => {
        const hit = resolve(target, wiki);
        if (!hit?.node?.pageId) return null;
        report.links++;
        return { id: hit.node.pageId, title: hit.node.title || t("common.untitled") };
      },
      file: (target, wiki) => {
        const hit = resolve(target, wiki);
        if (hit?.file) {
          used.add(hit.file.path);
          if (hit.file.size > o.limits.maxFileBytes) {
            note("fileTooLarge", { where: from, item: hit.file.path });
            return null;
          }
          return saveFile(n.pageId!, path.basename(hit.file.path), mimeOf(hit.file.path), null, hit.file.disk, hit.file.path);
        }
        // A link to a page of the import is the caller's; anything else is a link to a file that isn't there.
        if (!hit?.node && (wiki || /\.\w{1,6}$/.test(target.replace(/[?#].*$/, "")))) note("linkMissing", { where: from, item: target.slice(0, 300) });
        return null;
      },
    };
  };

  for (const n of withContent) {
    try {
      let doc: ProseMirrorNode = { type: "doc", content: [] };
      if (n.file) {
        const ext = path.extname(n.file.path).toLowerCase();
        const links = linksFor(n);
        const htmlOptions = {
          links,
          dataFile: (mimeType: string, data: Buffer) =>
            data.length > o.limits.maxFileBytes ? null : saveFile(n.pageId!, `image${EXT_OF_MIME[mimeType] ?? ""}`, mimeType, data),
          note: (what: string, info?: string) => note(what, { where: n.file!.path, ...(info ? { info: info.slice(0, 300) } : {}) }),
        };
        if (n.file.size > MAX_TEXT_BYTES && ext !== ".docx") note("truncated", { where: n.file.path });
        if (ext === ".md" || ext === ".markdown") doc = markdownDoc(n, readText(n.file), links);
        else if (ext === ".txt") doc = textDoc(readText(n.file));
        else if (ext === ".html" || ext === ".htm") doc = parseHtml(readText(n.file), htmlOptions).doc;
        else if (ext === ".docx") {
          const result = await mammoth.convertToHtml(
            { path: n.file.disk },
            {
              convertImage: mammoth.images.imgElement(async (image) => {
                const data = await image.readAsBuffer();
                const file = htmlOptions.dataFile(image.contentType, data);
                return { src: file?.url ?? "" };
              }),
            },
          );
          for (const m of result.messages) if (m.type === "warning") note("wordFormatting", { where: n.file.path, info: m.message.slice(0, 200) });
          doc = parseHtml(result.value, { ...htmlOptions, title: n.title ?? n.name }).doc;
        }
      }
      await storeFiles();
      if (n.file)
        await writeContent(
          o.collab,
          db,
          n.pageId!,
          safeDoc(doc, o.userId, () => note("truncated", { where: n.file?.path ?? n.dir ?? n.name })),
        );
    } catch (e) {
      log("File import: a file couldn't be read", { file: n.file?.path, error: e instanceof Error ? e.message : String(e) });
      note("unreadable", { where: n.file?.path ?? n.name, info: e instanceof Error ? e.message.slice(0, 200) : undefined });
    }
    job.done++;
  }
  // Files of a folder that no page shows: at the end of the folder's page, once every page has taken its own.
  for (const n of withContent) {
    if (!n.assets.length) continue;
    const leftover = n.assets.filter((f) => !used.has(f.path));
    const blocks: ProseMirrorNode[] = [];
    for (const f of leftover) {
      if (f.size > o.limits.maxFileBytes) {
        note("fileTooLarge", { where: f.path });
        continue;
      }
      used.add(f.path);
      const file = saveFile(n.pageId!, path.basename(f.path), mimeOf(f.path), null, f.disk, f.path)!;
      blocks.push(
        /^image\/(png|jpeg|gif|webp|avif)$/.test(file.mimeType)
          ? { type: "image", attrs: { src: file.url, alt: file.name } }
          : /^video\/(mp4|webm)$/.test(file.mimeType)
            ? { type: "video", attrs: { src: file.url } }
            : { type: "fileAttachment", attrs: { url: file.url, name: file.name, size: file.size, mimeType: file.mimeType } },
      );
    }
    await storeFiles();
    if (blocks.length) await appendContent(o.collab, db, n.pageId!, blocks);
  }
  for (const f of allFiles) if (!used.has(f.path) && !byPath.get(key(f.path))?.node) note("fileUnused", { where: f.path });
}

/** A Markdown file as the editor's JSON: its front matter's tags as a line on top, its first heading left out when it is the title. */
function markdownDoc(n: ImportNode, src: string, links: MarkdownLinks): ProseMirrorNode {
  const { data, body } = splitFrontMatter(src);
  const lines = body.split("\n");
  const firstAt = lines.findIndex((l) => l.trim());
  const h1 = firstAt >= 0 ? /^\s*#\s+(.+?)\s*#*\s*$/.exec(lines[firstAt]!) : null;
  if (h1 && (!n.title || h1[1]!.trim() === n.title.trim() || h1[1]!.trim() === n.name.trim())) lines.splice(firstAt, 1);
  const doc = parseMarkdown(lines.join("\n"), { links });
  const tags = [data.tags, data.tag].flatMap((v) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,\s]+/) : [])).filter(Boolean);
  if (tags.length) {
    const line = tags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" ");
    doc.content = [{ type: "paragraph", content: [{ type: "text", text: line }] }, ...(doc.content ?? [])];
  }
  return doc;
}

/** Plain text: a paragraph per block of lines, lines kept. */
function textDoc(src: string): ProseMirrorNode {
  const content = src
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .filter((p) => p.trim())
    .map((p) => ({
      type: "paragraph",
      content: p.split("\n").flatMap((line, i): ProseMirrorNode[] => [...(i ? [{ type: "hardBreak" }] : []), ...(line ? [{ type: "text", text: line }] : [])]),
    }));
  return { type: "doc", content };
}

/** The content as the editor takes it: known blocks, safe addresses; when too large, its beginning. */
function safeDoc(doc: ProseMirrorNode, userId: string, truncated: () => void): ProseMirrorNode {
  try {
    return checkContent(doc, userId, MAX_NODES);
  } catch {
    truncated();
    const content = doc.content ?? [];
    for (let n = Math.min(content.length, 2000); n > 0; n = Math.floor(n / 2)) {
      try {
        return checkContent({ type: "doc", content: content.slice(0, n) }, userId, MAX_NODES);
      } catch {
        // Fewer blocks.
      }
    }
    return { type: "doc", content: [] };
  }
}

/** Moves what an import made to the trash. Pages moved elsewhere or already deleted since are left as they are. */
export function undoFileImport(db: Db, job: FileImportServerJob, userId: string): number {
  let count = 0;
  const now = new Date();
  for (const id of job.created) {
    const page = db.select({ id: pages.id, deletedAt: pages.deletedAt, workspaceId: pages.workspaceId }).from(pages).where(eq(pages.id, id)).get();
    if (!page || page.deletedAt) continue;
    db.update(pages).set({ deletedAt: now, deletedBy: userId }).where(eq(pages.id, id)).run();
    count++;
  }
  job.undone = true;
  return count;
}
