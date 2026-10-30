import fs from "node:fs";
import path from "node:path";
import { inArray } from "drizzle-orm";
import yazl from "yazl";
import {
  applyView,
  t,
  cellText,
  type CellValue,
  type DatabaseData,
  type DatabaseProperty,
  type DatabaseRow,
  type DateValue,
  type FileValue,
  type FormulaResult,
  type RollupValue,
} from "@nootion/shared";
import { attachmentPath } from "./attachments.js";
import type { ProseMirrorNode } from "./collab.js";
import { canReadAs, loadDatabase } from "./databases.js";
import type { Db } from "./db/index.js";
import { attachments, pages } from "./db/schema.js";
import { frontMatter, toMarkdown } from "./markdown.js";
import { listDescendants, type PageMeta } from "./pages.js";
import { getPageRole } from "./permissions.js";

// --- Cell values ------------------------------------------------------------------------------

/** A cell as text, the way a spreadsheet shows it (CSV, front matter). */
export function exportText(prop: DatabaseProperty, value: CellValue, data: DatabaseData): string {
  if (value === null || value === undefined) return prop.type === "checkbox" ? t("common.no") : "";
  switch (prop.type) {
    case "checkbox":
      return value === true ? t("common.yes") : t("common.no");
    case "date": {
      const d = value as DateValue;
      return d.end ? `${d.start} → ${d.end}` : d.start;
    }
    case "formula": {
      const f = value as FormulaResult;
      if (f.kind === "boolean") return f.value ? t("common.yes") : t("common.no");
      if (f.kind === "error") return `#${t("export.error")} ${f.value}`;
      return cellText(prop, value, data);
    }
    default:
      return cellText(prop, value, data);
  }
}

/** A cell as plain JSON: numbers stay numbers, options and people become names, relations become titles. */
export function exportJson(prop: DatabaseProperty, value: CellValue, data: DatabaseData): unknown {
  if (value === null || value === undefined) {
    if (prop.type === "checkbox") return false;
    return ["multi_select", "person", "created_by", "relation", "file"].includes(prop.type) ? [] : null;
  }
  const names = (ids: string[], lookup: (id: string) => string | undefined) => ids.map((id) => lookup(id) ?? null).filter((x) => x !== null);
  switch (prop.type) {
    case "select":
      return prop.config.options?.find((o) => o.id === value)?.name ?? null;
    case "multi_select":
      return names(value as string[], (id) => prop.config.options?.find((o) => o.id === id)?.name);
    case "person":
    case "created_by":
      return names(value as string[], (id) => data.people[id]);
    case "relation":
      return names(value as string[], (id) => data.related[id]?.title);
    case "file":
      return (value as FileValue[]).map((f) => f.name);
    case "date": {
      const d = value as DateValue;
      return { start: d.start, end: d.end ?? null };
    }
    case "rollup": {
      const r = value as RollupValue;
      if (r.kind !== "list") return r.value;
      const target = data.rollupTargets[prop.id];
      return target ? r.values.map((v) => exportJson(target, v, data)) : [];
    }
    case "formula": {
      const f = value as FormulaResult;
      return f.kind === "error" ? { error: f.value } : f.value;
    }
    default:
      return value;
  }
}

const cellOf = (prop: DatabaseProperty, row: DatabaseRow): CellValue => (prop.type === "title" ? row.title : (row.values[prop.id] ?? null));

/** Rows of a database, filtered and sorted like a view when one is given. */
export function exportRows(data: DatabaseData, viewId?: string): DatabaseRow[] {
  const view = viewId ? data.views.find((v) => v.id === viewId) : undefined;
  return view ? applyView({ ...data }, view.config) : data.rows;
}

/** Columns in the order of the view (or of the first view), hidden ones included unless a view is asked for. */
function exportColumns(data: DatabaseData, viewId?: string): DatabaseProperty[] {
  const view = data.views.find((v) => v.id === viewId) ?? data.views[0];
  const order = new Map((view?.config.columns ?? []).map((c, i) => [c.propertyId, { i, hidden: !!c.hidden }]));
  return [...data.properties]
    .filter((p) => p.type !== "button" && (!viewId || !order.get(p.id)?.hidden))
    .sort((a, b) => Number(b.type === "title") - Number(a.type === "title") || (order.get(a.id)?.i ?? 1e9) - (order.get(b.id)?.i ?? 1e9));
}

function csvField(s: string, separator = ","): string {
  return s.includes(separator) || /["\n\r]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV with a byte order mark, so spreadsheet software reads accents correctly. */
export function databaseCsv(data: DatabaseData, viewId?: string, separator = ","): string {
  const columns = exportColumns(data, viewId);
  // Spreadsheets set to French read "12,5" as a number, not "12.5".
  const excel = (t: string) => (separator === ";" && /^-?\d+\.\d+$/.test(t) ? t.replace(".", ",") : t);
  const lines = [columns.map((p) => csvField(p.name, separator)).join(separator)];
  for (const row of exportRows(data, viewId)) lines.push(columns.map((p) => csvField(excel(exportText(p, cellOf(p, row), data)), separator)).join(separator));
  return `﻿${lines.join("\r\n")}\r\n`;
}

export function databaseJson(data: DatabaseData, viewId?: string) {
  const columns = exportColumns(data, viewId);
  return {
    database: { id: data.id, title: data.title },
    properties: columns.map((p) => ({ id: p.id, name: p.name, type: p.type })),
    rows: exportRows(data, viewId).map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      values: Object.fromEntries(columns.map((p) => [p.name, exportJson(p, cellOf(p, row), data)])),
    })),
  };
}

// --- Markdown export of pages -----------------------------------------------------------------

/** A file or folder name that works on Windows, macOS and Linux. */
export function safeName(title: string, fallback = t("common.untitled")): string {
  const name = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, 80);
  return name || fallback;
}

/**
 * Zip of pages in Markdown: each page is "Titre.md" with its subpages in a "Titre/" folder,
 * databases are "Titre.csv" (+ .json) with their rows as pages, attached files go in "fichiers/".
 * Only pages the user can read are included.
 */
export function exportPagesZip(db: Db, dataDir: string, userId: string, roots: PageMeta[]): yazl.ZipFile {
  const all = new Map<string, PageMeta>();
  for (const root of roots) {
    all.set(root.id, root);
    for (const p of listDescendants(db, root.id)) all.set(p.id, p);
  }
  // A page shared alone can sit under a page the user can't open: its subtree is cut there.
  const readable = new Map([...all].filter(([id]) => getPageRole(db, userId, id)));
  const children = new Map<string | null, PageMeta[]>();
  const rootIds = new Set(roots.map((r) => r.id));
  for (const p of readable.values()) {
    const parent = rootIds.has(p.id) || !p.parentId || !readable.has(p.parentId) ? null : p.parentId;
    if (parent === null && !rootIds.has(p.id)) continue;
    children.set(parent, [...(children.get(parent) ?? []), p]);
  }

  // Paths, without clashes between siblings with the same title.
  const paths = new Map<string, string>();
  const place = (parentDir: string, list: PageMeta[]) => {
    const used = new Set<string>();
    for (const p of list) {
      const base = safeName(p.title);
      let name = base;
      for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} (${i})`;
      used.add(name.toLowerCase());
      const dir = parentDir ? `${parentDir}/${name}` : name;
      paths.set(p.id, dir);
      place(dir, children.get(p.id) ?? []);
    }
  };
  place("", children.get(null) ?? []);

  const ids = [...paths.keys()];
  const files = ids.length ? db.select().from(attachments).where(inArray(attachments.pageId, ids)).all() : [];
  const filePaths = new Map(files.map((f) => [f.id, `${t("export.filesFolder")}/${f.id.slice(0, 8)}-${safeName(f.filename, t("export.file"))}`]));
  const content = new Map(
    (ids.length ? db.select({ id: pages.id, json: pages.contentJson, props: pages.props }).from(pages).where(inArray(pages.id, ids)).all() : []).map(
      (r) => [r.id, r],
    ),
  );

  const zip = new yazl.ZipFile();
  const fileOf = (p: PageMeta) => `${paths.get(p.id)}.${p.kind === "database" ? "csv" : "md"}`;
  const relative = (from: string, to: string) => path.posix.relative(path.posix.dirname(from), to);
  const databases = new Map<string, DatabaseData>();
  const databaseOf = (id: string) => {
    let data = databases.get(id);
    if (!data) {
      const page = readable.get(id)!;
      databases.set(id, (data = loadDatabase(db, page, getPageRole(db, userId, id)!, canReadAs(db, userId))));
    }
    return data;
  };

  for (const p of readable.values()) {
    if (!paths.has(p.id)) continue;
    const file = fileOf(p);
    if (p.kind === "database") {
      const data = databaseOf(p.id);
      zip.addBuffer(Buffer.from(databaseCsv(data)), file);
      zip.addBuffer(Buffer.from(JSON.stringify(databaseJson(data), null, 2)), `${paths.get(p.id)}.json`);
      continue;
    }
    const links = {
      file: (id: string) => (filePaths.has(id) ? relative(file, filePaths.get(id)!) : null),
      page: (id: string) => (paths.has(id) ? relative(file, fileOf(readable.get(id)!)) : null),
    };
    const meta: Record<string, unknown> = {
      title: p.title || t("common.untitled"),
      icon: p.icon,
      created: p.createdAt.toISOString(),
      updated: p.updatedAt.toISOString(),
      nootion_id: p.id,
    };
    if (p.kind === "row" && p.parentId && readable.has(p.parentId)) {
      const data = databaseOf(p.parentId);
      const row = data.rows.find((r) => r.id === p.id);
      if (row) for (const prop of data.properties) if (prop.type !== "title") meta[prop.name] = exportText(prop, cellOf(prop, row), data);
    }
    const body = toMarkdown(content.get(p.id)?.json as ProseMirrorNode | null, links);
    zip.addBuffer(Buffer.from(`${frontMatter(meta)}\n# ${p.title || t("common.untitled")}\n\n${body}\n`), file);
  }
  for (const f of files) {
    const source = attachmentPath(dataDir, f.id);
    if (fs.existsSync(source)) zip.addFile(source, filePaths.get(f.id)!);
  }
  zip.end();
  return zip;
}
