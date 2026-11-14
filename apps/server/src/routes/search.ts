import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  atLeast,
  editedSinceTime,
  hasSearchFilters,
  savedSearchInput,
  searchFiltersSchema,
  t,
  type SavedSearch,
  type SearchDatabase,
  type SearchFilters,
  type SearchResult,
  updateSavedSearchInput,
} from "@nootion/shared";
import { HttpError, notFound, parseBody, requireUser } from "../http.js";
import { getChain, isTrashed, roleFromChain } from "../permissions.js";
import { savedSearches } from "../db/schema.js";
import type { Db } from "../db/index.js";
import { refreshCellsText } from "../search-index.js";

/** FTS5 query from what the user typed: every word must appear, the last one may be unfinished. */
export function ftsQuery(input: string): string | null {
  const words = input
    .normalize("NFC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 12);
  if (!words.length) return null;
  return words.map((w, i) => `"${w}"${i === words.length - 1 ? "*" : ""}`).join(" ");
}

const CANDIDATES = 300;
const MAX_SAVED = 100;
const MARK = /\u0001/;

/** Reads the filters from the query string; unknown values are refused (400). */
function readFilters(query: Record<string, unknown>): SearchFilters {
  const raw: Record<string, string> = {};
  for (const key of ["workspaceId", "kind", "databaseId", "authorId", "editedSince"] as const) {
    const v = query[key];
    if (typeof v === "string" && v !== "") raw[key] = v;
  }
  return parseBody(searchFiltersSchema, raw);
}

/** SQL conditions for the filters, on pages `p` (and, for files, attachments `a`). */
function conditions(filters: SearchFilters, forFiles: boolean): { where: string; params: unknown[] } {
  const where: string[] = ["p.deleted_at IS NULL"];
  const params: unknown[] = [];
  if (filters.workspaceId) {
    where.push("p.workspace_id = ?");
    params.push(filters.workspaceId);
  }
  if (filters.kind && filters.kind !== "file" && !forFiles) {
    where.push("p.kind = ?");
    params.push(filters.kind);
  }
  if (filters.databaseId) {
    where.push("p.parent_id = ? AND p.kind = 'row'");
    params.push(filters.databaseId);
  }
  if (filters.authorId) {
    where.push(forFiles ? "a.created_by = ?" : "p.created_by = ?");
    params.push(filters.authorId);
  }
  if (filters.editedSince) {
    const since = editedSinceTime(filters.editedSince);
    if (since !== null) {
      where.push(forFiles ? "a.created_at >= ?" : "p.updated_at >= ?");
      params.push(since);
    }
  }
  return { where: where.join(" AND "), params };
}

type Row = {
  id: string;
  title: string;
  icon: string | null;
  kind: "page" | "database" | "row";
  body?: string;
  cells?: string;
  titleSnippet?: string;
  snippet?: string;
  score: number;
  updatedAt: number;
  fileId?: string;
  fileName?: string;
};

/** Pages and files matching the words and the filters, best first, before the permission check. */
function findCandidates(db: Db, query: string | null, filters: SearchFilters): Row[] {
  const client = db.$client;
  const wantPages = filters.kind !== "file";
  const wantFiles = !filters.kind || filters.kind === "file";
  let rows: Row[] = [];
  let files: Row[] = [];
  if (query) {
    if (wantPages) {
      const c = conditions(filters, false);
      rows = client
        .prepare(
          `SELECT f.page_id AS id, p.title, p.icon, p.kind, p.updated_at AS updatedAt,
                  snippet(pages_fts, 1, char(1), char(2), '…', 14) AS titleSnippet,
                  snippet(pages_fts, 2, char(1), char(2), '…', 14) AS body,
                  snippet(pages_fts, 3, char(1), char(2), '…', 14) AS cells,
                  bm25(pages_fts, 0, 8, 1, 2) AS score
             FROM pages_fts f JOIN pages p ON p.id = f.page_id
            WHERE pages_fts MATCH ? AND ${c.where}
            ORDER BY score
            LIMIT ${CANDIDATES}`,
        )
        .all(query, ...c.params) as Row[];
    }
    // Matches in attached files (their name, or the text read from them) lead to the page holding the file.
    if (wantFiles) {
      const c = conditions(filters, true);
      files = client
        .prepare(
          `SELECT p.id, p.title, p.icon, p.kind, p.updated_at AS updatedAt, f.attachment_id AS fileId, a.filename AS fileName,
                  snippet(attachments_fts, 3, char(1), char(2), '…', 14) AS snippet, bm25(attachments_fts, 0, 0, 4, 1) AS score
             FROM attachments_fts f JOIN attachments a ON a.id = f.attachment_id JOIN pages p ON p.id = a.page_id
            WHERE attachments_fts MATCH ? AND ${c.where}
            ORDER BY score
            LIMIT ${CANDIDATES}`,
        )
        .all(query, ...c.params) as Row[];
    }
    return [...rows, ...files].sort((a, b) => a.score - b.score);
  }

  // No words, only filters: the most recently changed first.
  if (wantPages) {
    const c = conditions(filters, false);
    rows = client
      .prepare(
        `SELECT p.id, p.title, p.icon, p.kind, p.updated_at AS updatedAt, -p.updated_at AS score,
                substr(coalesce(p.content_text, ''), 1, 160) AS body, substr(coalesce(p.cells_text, ''), 1, 160) AS cells
           FROM pages p
          WHERE ${c.where} AND p.template = 0
          ORDER BY p.updated_at DESC
          LIMIT ${CANDIDATES}`,
      )
      .all(...c.params) as Row[];
  }
  if (wantFiles) {
    const c = conditions(filters, true);
    files = client
      .prepare(
        `SELECT p.id, p.title, p.icon, p.kind, p.updated_at AS updatedAt, a.id AS fileId, a.filename AS fileName,
                -a.created_at AS score, '' AS snippet
           FROM attachments a JOIN pages p ON p.id = a.page_id
          WHERE ${c.where}
          ORDER BY a.created_at DESC
          LIMIT ${CANDIDATES}`,
      )
      .all(...c.params) as Row[];
  }
  return [...rows, ...files].sort((a, b) => a.score - b.score);
}

/** The extract shown under a result, and where the words were found. */
function describe(r: Row): Pick<SearchResult, "snippet" | "match"> {
  if (r.fileId) return { snippet: r.snippet ?? "" };
  const body = r.body ?? "";
  const cells = r.cells ?? "";
  if (MARK.test(body)) return { snippet: body, match: "content" };
  if (MARK.test(cells)) return { snippet: cells, match: "cells" };
  // Found in the title (or no words): a row shows its values, a page the start of its content.
  return { snippet: r.kind === "row" ? cells || body : body || cells, ...(r.titleSnippet && MARK.test(r.titleSnippet) ? { match: "title" as const } : {}) };
}

export const searchRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  // Full-text search over titles, content, values of database rows and attached files, limited to pages the user
  // can read. Filters: workspaceId, kind (page, database, row, file), databaseId, authorId, editedSince.
  // Without words, the filters alone list the most recently changed pages.
  app.get<{ Querystring: Record<string, string | undefined> }>("/", async (req) => {
    const user = requireUser(req);
    const query = ftsQuery(String(req.query.q ?? "").slice(0, 200));
    const filters = readFilters(req.query);
    if (!query && !hasSearchFilters(filters)) return { results: [] };
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    // Rows changed a moment ago are found at once, without waiting for the background indexer.
    refreshCellsText(db, 2000);
    const merged = findCandidates(db, query, filters);

    const results: SearchResult[] = [];
    const seen = new Set<string>();
    for (const r of merged) {
      const key = r.fileId ?? r.id;
      if (seen.has(key)) continue;
      seen.add(key);
      const chain = getChain(db, r.id);
      if (isTrashed(chain) || !atLeast(roleFromChain(db, user.id, chain), "viewer")) continue;
      // Where the page sits, as far as the user can see.
      const parents = chain.slice(1).filter((c) => atLeast(roleFromChain(db, user.id, chain.slice(chain.indexOf(c))), "viewer"));
      results.push({
        id: r.id,
        title: r.title,
        icon: r.icon,
        kind: r.kind,
        path: parents.map((c) => c.title || t("common.untitled")).reverse(),
        ...describe(r),
        updatedAt: new Date(r.updatedAt).toISOString(),
        ...(r.fileId ? { file: { id: r.fileId, name: r.fileName! } } : {}),
      });
      if (results.length >= limit) break;
    }
    return { results };
  });

  // The databases the user can read, for the database filter.
  app.get("/databases", async (req) => {
    const user = requireUser(req);
    const rows = db.$client
      .prepare(`SELECT id, title, icon, workspace_id AS workspaceId FROM pages WHERE kind = 'database' AND deleted_at IS NULL AND template = 0 ORDER BY title COLLATE NOCASE LIMIT 2000`)
      .all() as SearchDatabase[];
    const databases = rows.filter((d) => {
      const chain = getChain(db, d.id);
      return !isTrashed(chain) && atLeast(roleFromChain(db, user.id, chain), "viewer");
    });
    return { databases: databases.slice(0, 500) };
  });

  // Saved searches: the user's own, by name.
  const toSaved = (r: typeof savedSearches.$inferSelect): SavedSearch => ({
    id: r.id,
    name: r.name,
    query: r.query,
    filters: searchFiltersSchema.catch({}).parse(r.filters),
    createdAt: r.createdAt.toISOString(),
  });

  app.get("/saved", async (req) => {
    const user = requireUser(req);
    const rows = db.select().from(savedSearches).where(eq(savedSearches.userId, user.id)).orderBy(asc(sql`${savedSearches.name} COLLATE NOCASE`)).all();
    return { searches: rows.map(toSaved) };
  });

  app.post("/saved", async (req, reply) => {
    const user = requireUser(req);
    const input = parseBody(savedSearchInput, req.body);
    const count = db.$client.prepare(`SELECT count(*) AS n FROM saved_searches WHERE user_id = ?`).get(user.id) as { n: number };
    // Saving under an existing name replaces that search.
    const existing = db
      .select()
      .from(savedSearches)
      .where(and(eq(savedSearches.userId, user.id), sql`${savedSearches.name} = ${input.name} COLLATE NOCASE`))
      .get();
    if (existing) {
      db.update(savedSearches).set({ name: input.name, query: input.query, filters: input.filters }).where(eq(savedSearches.id, existing.id)).run();
      return toSaved(db.select().from(savedSearches).where(eq(savedSearches.id, existing.id)).get()!);
    }
    if (count.n >= MAX_SAVED) throw new HttpError(400, "too_many_saved_searches", t("search.tooManySaved", { count: MAX_SAVED }));
    const id = randomUUID();
    db.insert(savedSearches).values({ id, userId: user.id, name: input.name, query: input.query, filters: input.filters }).run();
    reply.code(201);
    return toSaved(db.select().from(savedSearches).where(eq(savedSearches.id, id)).get()!);
  });

  app.patch<{ Params: { id: string } }>("/saved/:id", async (req) => {
    const user = requireUser(req);
    const row = db
      .select()
      .from(savedSearches)
      .where(and(eq(savedSearches.id, req.params.id), eq(savedSearches.userId, user.id)))
      .get();
    if (!row) throw notFound();
    const input = parseBody(updateSavedSearchInput, req.body);
    db.update(savedSearches)
      .set({ ...(input.name !== undefined ? { name: input.name } : {}), ...(input.query !== undefined ? { query: input.query } : {}), ...(input.filters !== undefined ? { filters: input.filters } : {}) })
      .where(eq(savedSearches.id, row.id))
      .run();
    return toSaved(db.select().from(savedSearches).where(eq(savedSearches.id, row.id)).get()!);
  });

  app.delete<{ Params: { id: string } }>("/saved/:id", async (req, reply) => {
    const user = requireUser(req);
    const res = db
      .delete(savedSearches)
      .where(and(eq(savedSearches.id, req.params.id), eq(savedSearches.userId, user.id)))
      .run();
    if (!res.changes) throw notFound();
    return reply.code(204).send();
  });
};
