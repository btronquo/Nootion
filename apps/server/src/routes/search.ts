import type { FastifyPluginAsync } from "fastify";
import { atLeast, type SearchResult } from "@nootion/shared";
import { requireUser } from "../http.js";
import { getChain, isTrashed, roleFromChain } from "../permissions.js";
import { t } from "@nootion/shared";

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
    type Row = { id: string; title: string; icon: string | null; kind: "page" | "database" | "row"; snippet: string; score: number; fileId?: string; fileName?: string };
    const rows = db.$client
      .prepare(
        `SELECT f.page_id AS id, p.title, p.icon, p.kind,
                snippet(pages_fts, 2, char(1), char(2), '…', 14) AS snippet, bm25(pages_fts, 0, 8, 1) AS score
           FROM pages_fts f JOIN pages p ON p.id = f.page_id
          WHERE pages_fts MATCH ? AND p.deleted_at IS NULL
          ORDER BY score
          LIMIT ${CANDIDATES}`,
      )
      .all(query) as Row[];
    // Matches in attached files (their name, or the text read from them) lead to the page holding the file.
    const files = db.$client
      .prepare(
        `SELECT p.id, p.title, p.icon, p.kind, f.attachment_id AS fileId, a.filename AS fileName,
                snippet(attachments_fts, 3, char(1), char(2), '…', 14) AS snippet, bm25(attachments_fts, 0, 0, 4, 1) AS score
           FROM attachments_fts f JOIN attachments a ON a.id = f.attachment_id JOIN pages p ON p.id = a.page_id
          WHERE attachments_fts MATCH ? AND p.deleted_at IS NULL
          ORDER BY score
          LIMIT ${CANDIDATES}`,
      )
      .all(query) as Row[];
    const merged = [...rows, ...files].sort((a, b) => a.score - b.score);

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
        snippet: r.snippet,
        ...(r.fileId ? { file: { id: r.fileId, name: r.fileName! } } : {}),
      });
      if (results.length >= limit) break;
    }
    return { results };
  });
};
