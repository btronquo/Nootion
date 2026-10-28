import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Database, FileText } from "lucide-react";
import type { CellValue, DatabaseProperty, PageSummary } from "@nootion/shared";
import { api } from "../lib/api";
import { buildTree, pageTitle, type TreeNode } from "../lib/tree";
import type { JSONContent } from "@tiptap/core";
import { PublicContent } from "../editor/PublicContent";
import { Cell } from "../database/Cell";
import { PropertyIcon } from "../database/icons";
import { PublicDatabase } from "../database/DatabaseBlockView";

/** Read-only view of a page published with a public link. Works without an account. */
export function PublicPage() {
  const { token = "", pageId } = useParams();
  const site = useQuery({ queryKey: ["public", token], queryFn: () => api<{ root: PageSummary; pages: PageSummary[] }>(`/public/${token}`) });
  const currentId = pageId ?? site.data?.root.id;
  const page = useQuery({
    queryKey: ["public", token, currentId],
    queryFn: async () => (await api<{ page: PageSummary & { updatedAt: string; content: JSONContent | null; row: PublicRow | null } }>(`/public/${token}/pages/${currentId}`)).page,
    enabled: !!currentId,
  });

  if (site.isLoading) return null;
  if (site.isError) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-neutral-500">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Lien indisponible</h1>
          <p className="mt-2">Ce lien public n'existe pas ou a été désactivé.</p>
        </div>
      </div>
    );
  }
  const { root, pages } = site.data!;
  const tree = buildTree([root, ...pages]);

  return (
    <div className="flex h-full">
      {pages.length > 0 && (
        <aside className="w-64 shrink-0 overflow-y-auto border-r border-neutral-200 bg-neutral-50 p-2 dark:border-neutral-800 dark:bg-neutral-950">
          <PublicTree nodes={tree} token={token} currentId={currentId} rootId={root.id} />
        </aside>
      )}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className={`mx-auto px-12 pb-24 pt-16 ${page.data?.kind === "database" ? "max-w-6xl" : "max-w-3xl"}`}>
          {page.data && (
            <>
              {page.data.icon && <div className="mb-2 text-5xl">{page.data.icon}</div>}
              <h1 className="text-4xl font-bold">{pageTitle(page.data.title)}</h1>
              {page.data.row && <PublicRowProperties row={page.data.row} token={token} rowId={page.data.id} />}
              {page.data.kind === "database" && (
                <div className="mt-6">
                  <PublicDatabase id={page.data.id} token={token} />
                </div>
              )}
              {page.data.content && (
                <div className="mt-6">
                  <PublicContent content={page.data.content} token={token} />
                </div>
              )}
            </>
          )}
          {page.isError && <p className="text-neutral-500">Page introuvable.</p>}
        </div>
        <footer className="pb-8 text-center text-xs text-neutral-400">Publié avec Nootion</footer>
      </main>
    </div>
  );
}

interface PublicRow {
  properties: DatabaseProperty[];
  values: Record<string, CellValue>;
}

function PublicRowProperties({ row, token, rowId }: { row: PublicRow; token: string; rowId: string }) {
  return (
    <div className="mt-4 space-y-0.5 border-b border-neutral-200 pb-4 text-sm dark:border-neutral-800">
      {row.properties
        .filter((p) => p.type !== "title")
        .map((p) => (
          <div key={p.id} className="flex items-start gap-2">
            <div className="flex w-40 shrink-0 items-center gap-1.5 truncate py-1.5 text-neutral-500">
              <PropertyIcon type={p.type} size={14} /> <span className="truncate">{p.name}</span>
            </div>
            <div className="min-w-0 flex-1">
              <Cell
                prop={p}
                value={row.values[p.id] ?? null}
                rowId={rowId}
                people={{}}
                editable={false}
                variant="panel"
                onChange={() => {}}
                onCreateOption={() => Promise.reject(new Error("read-only"))}
                fileUrl={(id) => `/api/public/${token}/attachments/${id}`}
              />
            </div>
          </div>
        ))}
    </div>
  );
}

function PublicTree({ nodes, token, currentId, rootId, depth = 0 }: { nodes: TreeNode[]; token: string; currentId?: string; rootId: string; depth?: number }) {
  return (
    <ul>
      {nodes.map(({ page, children }) => (
        <li key={page.id}>
          <Link
            to={page.id === rootId ? `/p/${token}` : `/p/${token}/${page.id}`}
            className={`flex items-center gap-1.5 rounded px-2 py-1 text-sm ${page.id === currentId ? "bg-neutral-200/80 font-medium dark:bg-neutral-800" : "hover:bg-neutral-200/50 dark:hover:bg-neutral-800/60"}`}
            style={{ paddingLeft: 8 + depth * 12 }}
          >
            <span className="w-4 shrink-0 text-center">{page.icon ?? (page.kind === "database" ? <Database size={14} className="inline text-neutral-400" /> : <FileText size={14} className="inline text-neutral-400" />)}</span>
            <span className="truncate">{pageTitle(page.title)}</span>
          </Link>
          {children.length > 0 && <PublicTree nodes={children} token={token} currentId={currentId} rootId={rootId} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}
