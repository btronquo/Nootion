import type { FastifyPluginAsync } from "fastify";
import { atLeast, type SearchResult } from "@nootion/shared";
import { requireUser } from "../http.js";
import { getChain, isTrashed, roleFromChain } from "../permissions.js";

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

export const searchRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  // Full-text search over titles and content, limited to pages the user can read.
  app.get<{ Querystring: { q?: string; limit?: string } }>("/", async (req) => {
    const user = requireUser(req);
    const query = ftsQuery(String(req.query.q ?? "").slice(0, 200));
    if (!query) return { results: [] };
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const rows = db.$client
      .prepare(
        `SELECT f.page_id AS id, p.title, p.icon, p.kind, p.parent_id AS parentId,
                snippet(pages_fts, 2, char(1), char(2), '…', 14) AS snippet
           FROM pages_fts f JOIN pages p ON p.id = f.page_id
          WHERE pages_fts MATCH ? AND p.deleted_at IS NULL
          ORDER BY bm25(pages_fts, 0, 8, 1)
          LIMIT ${CANDIDATES}`,
      )
      .all(query) as { id: string; title: string; icon: string | null; kind: "page" | "database" | "row"; parentId: string | null; snippet: string }[];

    const results: SearchResult[] = [];
    for (const r of rows) {
      const chain = getChain(db, r.id);
      if (isTrashed(chain) || !atLeast(roleFromChain(db, user.id, chain), "viewer")) continue;
      // Where the page sits, as far as the user can see.
      const parents = chain.slice(1).filter((c) => atLeast(roleFromChain(db, user.id, chain.slice(chain.indexOf(c))), "viewer"));
      results.push({
        id: r.id,
        title: r.title,
        icon: r.icon,
        kind: r.kind,
        path: parents.map((c) => c.title || "Sans titre").reverse(),
        snippet: r.snippet,
      });
      if (results.length >= limit) break;
    }
    return { results };
  });
};
