import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import * as Y from "yjs";
import {
  OPTION_COLORS,
  t,
  type NotionImportJob,
  type CalcFunction,
  type CellValue,
  type DatabaseProperty,
  type PropertyConfig,
  type PropertyType,
  type SelectOption,
} from "@nootion/shared";
import type { Db } from "../db/index.js";
import { attachments, databaseProperties, databaseViews, notionLinks, notionPropertyLinks, pages, users } from "../db/schema.js";
import { attachmentPath, uploadsDir } from "../attachments.js";
import { encodeContent, setProsemirrorJSON, type Collab, type ProseMirrorNode } from "../collab.js";
import { checkFormula, listProperties } from "../databases.js";
import { nextPosition } from "../pages.js";
import {
  NotionClient,
  type NotionDatabase,
  type NotionIcon,
  type NotionPage,
  type NotionPropertySchema,
  type NotionPropertyValue,
  type Parent,
} from "./api.js";
import { blocksToDoc, fileName, plainText, type BlockTree } from "./blocks.js";
import { FormulaTranslationError, translateFormula } from "./formula.js";

export type ImportJob = NotionImportJob & { userId: string };

export interface ImportOptions {
  db: Db;
  collab: Collab;
  client: NotionClient;
  dataDir: string;
  maxFileBytes: number;
  /** Hosts files may be downloaded from (Notion's storage); other files stay links. */
  fileHosts: (url: URL) => boolean;
  workspaceId: string;
  /** Where top-level Notion pages go: a page of the space, or its root. */
  parentId: string | null;
  userId: string;
  job: ImportJob;
}

type Item = { kind: "page"; page: NotionPage } | { kind: "database"; database: NotionDatabase } | { kind: "row"; page: NotionPage; databaseId: string };

const NUMBER_FORMATS: Record<string, string> = {
  dollar: "USD",
  canadian_dollar: "CAD",
  euro: "EUR",
  pound: "GBP",
  yen: "JPY",
  ruble: "RUB",
  rupee: "INR",
  won: "KRW",
  yuan: "CNY",
  real: "BRL",
  lira: "TRY",
  rupiah: "IDR",
  franc: "CHF",
  hong_kong_dollar: "HKD",
  new_zealand_dollar: "NZD",
  krona: "SEK",
  norwegian_krone: "NOK",
  mexican_peso: "MXN",
  rand: "ZAR",
  new_taiwan_dollar: "TWD",
  danish_krone: "DKK",
  zloty: "PLN",
  baht: "THB",
  forint: "HUF",
  koruna: "CZK",
  shekel: "ILS",
  chilean_peso: "CLP",
  philippine_peso: "PHP",
  dirham: "AED",
  colombian_peso: "COP",
  riyal: "SAR",
  ringgit: "MYR",
  leu: "RON",
  argentine_peso: "ARS",
  uruguayan_peso: "UYU",
  singapore_dollar: "SGD",
};

const ROLLUP_FUNCTIONS: Record<string, CalcFunction | "show_original"> = {
  show_original: "show_original",
  count: "count_all",
  count_values: "count_values",
  unique: "count_unique",
  empty: "count_empty",
  not_empty: "count_not_empty",
  percent_empty: "percent_empty",
  percent_not_empty: "percent_not_empty",
  sum: "sum",
  average: "average",
  median: "median",
  min: "min",
  max: "max",
  range: "range",
  earliest_date: "earliest",
  latest_date: "latest",
  date_range: "date_range",
  checked: "checked",
  unchecked: "unchecked",
  percent_checked: "percent_checked",
  percent_unchecked: "percent_unchecked",
};

/** Notion's ids, with or without dashes, in one form. */
export const normId = (id: string) => id.replace(/-/g, "").toLowerCase();

const colorOf = (c: string): SelectOption["color"] => ((OPTION_COLORS as readonly string[]).includes(c) ? (c as SelectOption["color"]) : "gray");
const toOptions = (options: { id: string; name: string; color: string }[] = []): SelectOption[] =>
  options.filter((o) => o.name.trim()).map((o) => ({ id: (o.id || randomUUID()).slice(0, 64), name: o.name.trim().slice(0, 100), color: colorOf(o.color) }));

const emojiOf = (icon: NotionIcon) => (icon?.type === "emoji" ? icon.emoji : null);

/**
 * Imports every page and database shared with a Notion integration into a space.
 * Run again, it updates what was imported before (pages changed in Notion get their new content) and adds the rest.
 */
export async function runNotionImport(o: ImportOptions): Promise<void> {
  const { db, client, job } = o;
  const report = job.report;
  const note = (what: string) => (report.notes[what] = (report.notes[what] ?? 0) + 1);
  const step = (phase: string, total: number) => Object.assign(job, { phase, done: 0, total });

  // --- 1. What the integration can see ---------------------------------------------------------
  step("discover", 0);
  const found = (await client.search()).filter((x) => !x.archived && !x.in_trash);
  const items = new Map<string, Item>();
  for (const x of found) {
    if (x.object === "database") items.set(normId(x.id), { kind: "database", database: x });
    else if (x.parent.type !== "database_id") items.set(normId(x.id), { kind: "page", page: x });
  }
  // Rows come from their database, in its order (search doesn't return rows of databases it can't see anyway).
  const rowsByDb = new Map<string, NotionPage[]>();
  const databases = [...items.values()].filter((i): i is Extract<Item, { kind: "database" }> => i.kind === "database");
  step("databases", databases.length);
  for (const { database } of databases) {
    const rows = (await client.queryDatabase(database.id)).filter((r) => !r.archived && !r.in_trash);
    rowsByDb.set(normId(database.id), rows);
    for (const row of rows) items.set(normId(row.id), { kind: "row", page: row, databaseId: normId(database.id) });
    job.done++;
  }

  // Notion people, by id, for person columns: matched to Nootion accounts by email.
  const emails = new Map<string, string>();
  try {
    for (const u of await client.users()) if (u.person?.email) emails.set(u.id, u.person.email.toLowerCase());
  } catch {
    // The integration may not be allowed to read users: emails in the values are used instead.
  }
  const accounts = new Map(
    db
      .select({ id: users.id, email: users.email })
      .from(users)
      .all()
      .map((u) => [u.email.toLowerCase(), u.id]),
  );
  const personId = (u: { id: string; person?: { email?: string } } | undefined) => {
    const email = u?.person?.email?.toLowerCase() ?? (u ? emails.get(u.id) : undefined);
    return email ? (accounts.get(email) ?? null) : null;
  };

  // Parent of each item among the imported ones. Pages inside a block (a column, a toggle) belong to that block's page.
  const blockParents = new Map<string, Parent>();
  const parentOf = async (parent: Parent): Promise<string | null> => {
    for (let p = parent, hops = 0; hops < 50; hops++) {
      if (p.type === "page_id") return items.has(normId(p.page_id)) ? normId(p.page_id) : null;
      if (p.type === "database_id") return items.has(normId(p.database_id)) ? normId(p.database_id) : null;
      if (p.type !== "block_id") return null;
      const id = normId(p.block_id);
      if (items.has(id)) return id;
      let next = blockParents.get(id);
      if (!next) {
        try {
          next = (await client.block(p.block_id)).parent;
        } catch {
          return null;
        }
        blockParents.set(id, next);
      }
      p = next;
    }
    return null;
  };

  // --- 2. Pages, databases and rows: created, or found from a previous import ----------------
  const links = new Map(
    db
      .select({ notionId: notionLinks.notionId, pageId: notionLinks.pageId, editedAt: notionLinks.notionEditedAt, deletedAt: pages.deletedAt })
      .from(notionLinks)
      .innerJoin(pages, eq(pages.id, notionLinks.pageId))
      .where(eq(notionLinks.workspaceId, o.workspaceId))
      .all()
      .filter((l) => !l.deletedAt)
      .map((l) => [l.notionId, l]),
  );
  const target = new Map<string, { id: string; title: string; isNew: boolean; changed: boolean }>();
  const titleOf = (item: Item) => (item.kind === "database" ? plainText(item.database.title) : pageTitle(item.page));
  const editedAt = (item: Item) => (item.kind === "database" ? item.database.last_edited_time : item.page.last_edited_time);

  // Parents first, so children can be placed under them.
  const parents = new Map<string, string | null>();
  for (const [id, item] of items)
    parents.set(id, item.kind === "row" ? item.databaseId : await parentOf(item.kind === "database" ? item.database.parent : item.page.parent));
  const depth = (id: string): number => {
    let d = 0;
    for (let p = parents.get(id); p && d < 100; p = parents.get(p)) d++;
    return d;
  };
  const ordered = [...items.keys()].sort((a, b) => depth(a) - depth(b));
  step("pages", ordered.length);
  const rowIndex = new Map<string, number>();
  for (const rows of rowsByDb.values()) rows.forEach((r, i) => rowIndex.set(normId(r.id), i));

  for (const id of ordered) {
    const item = items.get(id)!;
    const title = titleOf(item).slice(0, 500);
    const icon = emojiOf(item.kind === "database" ? item.database.icon : item.page.icon);
    if ((item.kind === "database" ? item.database.icon : item.page.icon) && !icon) note("icon");
    if (item.kind !== "database" && item.page.cover) note("cover");
    const link = links.get(id);
    if (link) {
      const changed = link.editedAt !== editedAt(item);
      if (changed) db.update(pages).set({ title, icon, updatedAt: new Date() }).where(eq(pages.id, link.pageId)).run();
      target.set(id, { id: link.pageId, title, isNew: false, changed });
      report[changed ? "updated" : "unchanged"]++;
    } else {
      const parentNotion = parents.get(id);
      const parentId = parentNotion ? target.get(parentNotion)!.id : o.parentId;
      const pageId = randomUUID();
      const created = item.kind === "database" ? item.database.created_time : item.page.created_time;
      db.insert(pages)
        .values({
          id: pageId,
          workspaceId: o.workspaceId,
          parentId,
          kind: item.kind,
          title,
          icon,
          position: item.kind === "row" ? rowIndex.get(id)! : nextPosition(db, o.workspaceId, parentId),
          createdBy: (item.kind !== "database" && personId(item.page.created_by)) || o.userId,
          createdAt: new Date(created),
          updatedAt: new Date(editedAt(item)),
          props: item.kind === "row" ? {} : null,
        })
        .run();
      if (item.kind === "database") {
        db.insert(databaseViews)
          .values({ id: randomUUID(), databaseId: pageId, name: t("view.defaultTable"), type: "table", position: 0 })
          .run();
      }
      target.set(id, { id: pageId, title, isNew: true, changed: true });
      report[item.kind === "database" ? "databases" : item.kind === "row" ? "rows" : "pages"]++;
    }
    job.done++;
  }
  const pageFor = (notionId: string) => {
    const x = target.get(normId(notionId));
    return x ? { id: x.id, title: x.title } : null;
  };

  // --- 3. Columns -----------------------------------------------------------------------------
  // Notion column id → Nootion column, per database.
  const columns = new Map<string, Map<string, DatabaseProperty>>();
  // Formulas kept as values: Notion column id → type of the values.
  const snapshots = new Map<string, Map<string, PropertyType>>();
  const existingColumns = (dbId: string) =>
    new Map(
      db
        .select({ notionId: notionPropertyLinks.notionPropertyId, propertyId: notionPropertyLinks.propertyId })
        .from(notionPropertyLinks)
        .where(eq(notionPropertyLinks.databaseId, dbId))
        .all()
        .map((l) => [l.notionId, l.propertyId]),
    );

  const saveColumn = (dbId: string, notionPropId: string, name: string, type: PropertyType, config: PropertyConfig, position: number): DatabaseProperty => {
    const known = existingColumns(dbId).get(notionPropId);
    const current = known ? listProperties(db, dbId).find((p) => p.id === known) : undefined;
    if (current) {
      // Imported before: renamed, and new options added; the type stays the one chosen in Nootion.
      const merged: PropertyConfig = { ...current.config };
      if (config.options) {
        const ids = new Set((current.config.options ?? []).map((x) => x.id));
        merged.options = [...(current.config.options ?? []), ...config.options.filter((x) => !ids.has(x.id))];
      }
      db.update(databaseProperties).set({ name, config: merged }).where(eq(databaseProperties.id, current.id)).run();
      return { ...current, name, config: merged };
    }
    const id = randomUUID();
    db.insert(databaseProperties).values({ id, databaseId: dbId, name, type, config, position }).run();
    db.insert(notionPropertyLinks).values({ propertyId: id, databaseId: dbId, notionPropertyId: notionPropId }).onConflictDoNothing().run();
    return { id, name, type, config, position };
  };

  const schemaOf = (d: NotionDatabase) => Object.values(d.properties).sort((a, b) => Number(b.type === "title") - Number(a.type === "title"));
  const position = new Map<string, number>();
  const nextColumn = (dbId: string) => {
    const n = position.get(dbId) ?? listProperties(db, dbId).length;
    position.set(dbId, n + 1);
    return n;
  };

  // Plain columns first, then relations (they need the other databases), rollups (they need relations) and formulas.
  for (const { database } of databases) {
    const dbId = target.get(normId(database.id))!.id;
    const cols = new Map<string, DatabaseProperty>();
    columns.set(normId(database.id), cols);
    snapshots.set(normId(database.id), new Map());
    for (const p of schemaOf(database)) {
      const plain = plainColumn(p, note);
      if (!plain) continue;
      cols.set(p.id, saveColumn(dbId, p.id, p.name.slice(0, 100), plain.type, plain.config, nextColumn(dbId)));
    }
  }
  for (const { database } of databases) {
    const dbId = target.get(normId(database.id))!.id;
    for (const p of schemaOf(database)) {
      if (p.type !== "relation" || !p.relation) continue;
      const other = target.get(normId(p.relation.database_id));
      if (!other || items.get(normId(p.relation.database_id))?.kind !== "database") {
        note("relationNotShared");
        continue;
      }
      columns.get(normId(database.id))!.set(p.id, saveColumn(dbId, p.id, p.name.slice(0, 100), "relation", { databaseId: other.id }, nextColumn(dbId)));
    }
  }
  // Two-way relations: each side points to the other.
  for (const { database } of databases) {
    for (const p of schemaOf(database)) {
      const twin = p.relation?.dual_property?.synced_property_id;
      const mine = columns.get(normId(database.id))!.get(p.id);
      if (!twin || !mine) continue;
      const theirs = columns.get(normId(p.relation!.database_id))?.get(twin) ?? columns.get(normId(p.relation!.database_id))?.get(decodeURIComponent(twin));
      if (!theirs) continue;
      const config = { ...mine.config, twinPropertyId: theirs.id };
      db.update(databaseProperties).set({ config }).where(eq(databaseProperties.id, mine.id)).run();
      mine.config = config;
    }
  }
  const nameOf = (dbNotionId: string) => (notionPropId: string) => {
    const d = items.get(dbNotionId);
    if (d?.kind !== "database") return undefined;
    return Object.values(d.database.properties).find((p) => p.id === notionPropId)?.name;
  };
  for (const { database } of databases) {
    const key = normId(database.id);
    const dbId = target.get(key)!.id;
    const cols = columns.get(key)!;
    for (const p of schemaOf(database)) {
      if (p.type === "rollup" && p.rollup) {
        const relation = cols.get(p.rollup.relation_property_id);
        const relSchema = Object.values(database.properties).find((x) => x.id === p.rollup!.relation_property_id);
        const targetCols = relSchema?.relation ? columns.get(normId(relSchema.relation.database_id)) : undefined;
        const targetProp = targetCols?.get(p.rollup.rollup_property_id);
        const fn = ROLLUP_FUNCTIONS[p.rollup.function];
        if (!relation || !targetProp || targetProp.type === "rollup" || targetProp.type === "relation") {
          note("rollup");
          continue;
        }
        if (!fn) note("rollupFunction");
        cols.set(
          p.id,
          saveColumn(
            dbId,
            p.id,
            p.name.slice(0, 100),
            "rollup",
            { relationPropertyId: relation.id, targetPropertyId: targetProp.id, rollupFunction: fn ?? "show_original" },
            nextColumn(dbId),
          ),
        );
      }
    }
    // Formulas may use each other: added in rounds, each one once the columns it uses exist.
    let pending = schemaOf(database).filter((p) => p.type === "formula");
    const reasons = new Map<string, string>();
    for (let progress = true; pending.length && progress; ) {
      progress = false;
      for (const p of [...pending]) {
        try {
          const expression = translateFormula(p.formula?.expression ?? "", nameOf(key));
          checkFormula(listProperties(db, dbId), null, expression);
          cols.set(p.id, saveColumn(dbId, p.id, p.name.slice(0, 100), "formula", { expression }, nextColumn(dbId)));
          pending = pending.filter((x) => x !== p);
          progress = true;
        } catch (e) {
          reasons.set(p.id, e instanceof Error ? e.message : String(e));
          // Nootion has no equivalent: no point trying again.
          if (e instanceof FormulaTranslationError) {
            pending = pending.filter((x) => x !== p);
            snapshot(p);
          }
        }
      }
    }
    pending.forEach(snapshot);

    // Kept as values, typed after the first one.
    function snapshot(p: NotionPropertySchema) {
      const sample = rowsByDb
        .get(key)
        ?.map((r) => r.properties[p.name]?.formula)
        .find((f) => f && f[f.type] !== null && f[f.type] !== undefined);
      const type: PropertyType = sample?.type === "number" ? "number" : sample?.type === "boolean" ? "checkbox" : sample?.type === "date" ? "date" : "text";
      report.formulas.push({ database: titleOf({ kind: "database", database }), name: p.name, reason: reasons.get(p.id) ?? "" });
      snapshots.get(key)!.set(p.id, type);
      cols.set(p.id, saveColumn(dbId, p.id, p.name.slice(0, 100), type, {}, nextColumn(dbId)));
    }
  }

  // --- 4. Row values -----------------------------------------------------------------------------
  const allRows = [...items.entries()].filter((e): e is [string, Extract<Item, { kind: "row" }>] => e[1].kind === "row");
  step("rows", allRows.length);
  for (const [id, item] of allRows) {
    const row = target.get(id)!;
    if (row.changed) {
      const d = items.get(item.databaseId) as Extract<Item, { kind: "database" }>;
      const cols = columns.get(item.databaseId)!;
      const values: Record<string, CellValue> = {};
      for (const [name, value] of Object.entries(item.page.properties)) {
        const schema = d.database.properties[name];
        const prop = schema && cols.get(schema.id);
        if (!schema || !prop || prop.type === "title") continue;
        const v = await cellValue(schema, value, prop, {
          snapshot: snapshots.get(item.databaseId)!.get(schema.id),
          relationIds: async () =>
            value.has_more
              ? (await client.propertyItems(item.page.id, value.id)).flatMap((x) => (x.relation ? [x.relation.id] : []))
              : (value.relation ?? []).map((r) => r.id),
          rowFor: (notionId) => {
            const x = items.get(normId(notionId));
            return x?.kind === "row" ? target.get(normId(notionId))!.id : null;
          },
          personId,
          saveFile: (url, name) => saveFile(row.id, url, name),
          addOption: (o) => {
            prop.config = { ...prop.config, options: [...(prop.config.options ?? []), o] };
            db.update(databaseProperties).set({ config: prop.config }).where(eq(databaseProperties.id, prop.id)).run();
          },
          note,
        });
        if (v !== null && v !== undefined && !(Array.isArray(v) && !v.length)) values[prop.id] = v;
      }
      db.update(pages).set({ props: values }).where(eq(pages.id, row.id)).run();
    }
    job.done++;
  }

  // --- 5. Page contents --------------------------------------------------------------------------
  async function saveFile(pageId: string, url: string, name: string) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (!o.fileHosts(parsed)) return null;
    const file = await client.download(url, o.maxFileBytes);
    if (!file) return null;
    const id = randomUUID();
    fs.mkdirSync(uploadsDir(o.dataDir), { recursive: true });
    fs.writeFileSync(attachmentPath(o.dataDir, id), file.data);
    const filename = name.replace(/[\\/\r\n]/g, "_").slice(0, 255) || "file";
    db.insert(attachments).values({ id, pageId, filename, mimeType: file.type, size: file.data.length, createdBy: o.userId }).run();
    report.files++;
    return { url: `/api/attachments/${id}`, name: filename, size: file.data.length, mimeType: file.type };
  }

  const loadBlocks = async (blockId: string): Promise<BlockTree[]> => {
    const blocks: BlockTree[] = await client.blockChildren(blockId);
    for (const b of blocks) {
      // Subpages and databases are imported on their own.
      if (b.has_children && b.type !== "child_page" && b.type !== "child_database") b.children = await loadBlocks(b.id);
    }
    return blocks;
  };

  const withContent = [...items.entries()].filter(([id, item]) => item.kind !== "database" && target.get(id)!.changed);
  step("content", withContent.length);
  for (const [id, item] of withContent) {
    const pageId = target.get(id)!.id;
    const blocks = await loadBlocks((item as Exclude<Item, { kind: "database" }>).page.id);
    const doc = await blocksToDoc(blocks, {
      pageFor: (notionId) => {
        const x = pageFor(notionId);
        // Full-page databases are linked; inline ones are shown in the page.
        const it = items.get(normId(notionId));
        return x && it ? { ...x, inline: it.kind === "database" && it.database.is_inline !== false } : x;
      },
      saveFile: (url, name) => saveFile(pageId, url, name),
      note,
    });
    await writeContent(o.collab, db, pageId, doc);
    job.done++;
  }

  // --- 6. Remembered for the next import ---------------------------------------------------------
  for (const [id, item] of items) {
    db.insert(notionLinks)
      .values({ workspaceId: o.workspaceId, notionId: id, pageId: target.get(id)!.id, notionEditedAt: editedAt(item) })
      .onConflictDoUpdate({ target: [notionLinks.workspaceId, notionLinks.notionId], set: { pageId: target.get(id)!.id, notionEditedAt: editedAt(item) } })
      .run();
  }
}

/** Title of a Notion page: its title property. */
export function pageTitle(page: NotionPage): string {
  const title = Object.values(page.properties ?? {}).find((p) => p.type === "title");
  return plainText(title?.title);
}

/** Column types that need nothing else than their own settings. */
function plainColumn(p: NotionPropertySchema, note: (what: string) => void): { type: PropertyType; config: PropertyConfig } | null {
  switch (p.type) {
    case "title":
      return { type: "title", config: {} };
    case "rich_text":
    case "phone_number":
    case "unique_id":
      return { type: "text", config: {} };
    case "number": {
      const format = p.number?.format ?? "number";
      if (format === "percent") return { type: "percent", config: { decimals: 0 } };
      if (NUMBER_FORMATS[format]) return { type: "currency", config: { currency: NUMBER_FORMATS[format], decimals: 2 } };
      return { type: "number", config: {} };
    }
    case "select":
      return { type: "select", config: { options: toOptions(p.select?.options) } };
    case "status":
      note("status");
      return { type: "select", config: { options: toOptions(p.status?.options) } };
    case "multi_select":
      return { type: "multi_select", config: { options: toOptions(p.multi_select?.options) } };
    case "date":
      return { type: "date", config: {} };
    case "checkbox":
      return { type: "checkbox", config: {} };
    case "url":
      return { type: "url", config: {} };
    case "email":
      return { type: "email", config: {} };
    case "people":
      return { type: "person", config: {} };
    case "files":
      return { type: "file", config: {} };
    case "created_time":
      return { type: "created_time", config: {} };
    case "last_edited_time":
      return { type: "last_edited_time", config: {} };
    case "created_by":
      return { type: "created_by", config: {} };
    case "relation":
    case "rollup":
    case "formula":
      return null;
    default:
      note("propertyType");
      return null;
  }
}

interface CellContext {
  snapshot: PropertyType | undefined;
  relationIds: () => Promise<string[]>;
  rowFor: (notionId: string) => string | null;
  personId: (u: { id: string; person?: { email?: string } }) => string | null;
  saveFile: (url: string, name: string) => Promise<{ url: string; name: string } | null>;
  addOption: (o: SelectOption) => void;
  note: (what: string) => void;
}

/** A Notion cell as a Nootion value (null when empty or computed by Nootion). */
async function cellValue(schema: NotionPropertySchema, v: NotionPropertyValue, prop: DatabaseProperty, c: CellContext): Promise<CellValue> {
  if (c.snapshot) {
    const f = v.formula;
    if (!f) return null;
    if (c.snapshot === "number") return typeof f.number === "number" ? f.number : null;
    if (c.snapshot === "checkbox") return f.boolean ?? null;
    if (c.snapshot === "date") return f.date ? { start: f.date.start, end: f.date.end } : null;
    return (f.string ?? (f.number ?? f.boolean ?? null) !== null) ? String(f.string ?? f.number ?? f.boolean) : null;
  }
  const option = (o: { id: string; name: string; color: string } | null | undefined) => {
    if (!o) return null;
    const known = prop.config.options?.find((x) => x.id === o.id || x.name === o.name.trim());
    if (known) return known.id;
    const [created] = toOptions([o]);
    if (!created) return null;
    c.addOption(created);
    return created.id;
  };
  switch (schema.type) {
    case "rich_text":
      return plainText(v.rich_text) || null;
    case "phone_number":
      return v.phone_number ?? null;
    case "unique_id":
      return v.unique_id?.number === null || v.unique_id?.number === undefined
        ? null
        : `${v.unique_id.prefix ? `${v.unique_id.prefix}-` : ""}${v.unique_id.number}`;
    case "number":
      if (typeof v.number !== "number") return null;
      return prop.type === "percent" ? Math.round(v.number * 100 * 1e6) / 1e6 : v.number;
    case "select":
      return option(v.select);
    case "status":
      return option(v.status);
    case "multi_select":
      return (v.multi_select ?? []).map(option).filter((x): x is string => !!x);
    case "date":
      return v.date ? { start: v.date.start, end: v.date.end } : null;
    case "checkbox":
      return v.checkbox ?? null;
    case "url":
      return v.url ?? null;
    case "email":
      return v.email ?? null;
    case "people": {
      const people = v.people ?? [];
      const ids = people.map(c.personId).filter((x): x is string => !!x);
      if (ids.length < people.length) c.note("person");
      return ids;
    }
    case "files": {
      const out: { id: string; name: string }[] = [];
      for (const f of v.files ?? []) {
        const url = f.type === "file" ? f.file?.url : undefined;
        const saved = url ? await c.saveFile(url, f.name || fileName(url)) : null;
        if (saved) out.push({ id: saved.url.split("/").pop()!, name: saved.name });
        else c.note(f.type === "external" ? "externalFile" : "fileMissing");
      }
      return out;
    }
    case "relation": {
      const ids = await c.relationIds();
      const mapped = ids.map(c.rowFor).filter((x): x is string => !!x);
      if (mapped.length < ids.length) c.note("relationNotShared");
      return mapped;
    }
    default:
      return null;
  }
}

/** Replaces a page's content, through the live editing server when someone has it open. */
async function writeContent(collab: Collab, db: Db, pageId: string, doc: ProseMirrorNode) {
  if (collab.documents.has(pageId)) {
    const connection = await collab.openDirectConnection(pageId);
    await connection.transact((d) => setProsemirrorJSON(d, doc));
    await connection.disconnect();
    return;
  }
  const y = new Y.Doc();
  setProsemirrorJSON(y, doc);
  const { state, json, text } = encodeContent(y);
  db.update(pages)
    .set({ contentState: state, contentJson: json, contentText: text })
    .where(and(eq(pages.id, pageId)))
    .run();
}
