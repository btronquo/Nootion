import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { EditorContent, useEditor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import { Bot, History, RotateCcw, X } from "lucide-react";
import { atLeast, intlLocale, t, type ClientPluginInfo, type PageDetail, type PageVersion } from "@nootion/shared";
import { api } from "../lib/api";
import { keys, useRefreshPages } from "../lib/queries";
import { pageTitle } from "../lib/tree";
import { baseExtensions } from "../editor/extensions";
import { usePlugins } from "../plugins/registry";
import { formatMentionDate } from "../lib/reminders";

interface Node {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
}

const when = (iso: string) => new Date(iso).toLocaleString(intlLocale(), { dateStyle: "medium", timeStyle: "short" });

/** Lines of text of a document, one per block, with list and heading markers: what the history compares. */
function textLines(node: Node | null | undefined, prefix = ""): string[] {
  if (!node) return [];
  const children = node.content ?? [];
  if (children.some((c) => c.type === "text" || c.type === "hardBreak" || c.type === "pageMention" || c.type === "dateMention")) {
    const text = children
      .map((c) => c.text ?? (c.type === "pageMention" ? `@${String(c.attrs?.title ?? "")}` : c.type === "dateMention" ? `@${formatMentionDate(String(c.attrs?.date))}` : " "))
      .join("");
    const mark = node.type === "heading" ? `${"#".repeat(Number(node.attrs?.level) || 1)} ` : "";
    return [`${prefix}${mark}${text}`];
  }
  if (!children.length) {
    if (node.type === "paragraph" || node.type === "hardBreak" || node.type === "doc") return [];
    const label = node.type === "pageLink" ? `📄 ${String(node.attrs?.title ?? "")}` : node.type === "image" ? "🖼" : node.type;
    return [`${prefix}[${label}]`];
  }
  const marker = node.type === "listItem" ? "• " : node.type === "taskItem" ? (node.attrs?.checked ? "☑ " : "☐ ") : node.type === "blockquote" ? "> " : "";
  return children.flatMap((c, i) => textLines(c, marker ? (i === 0 ? prefix + marker : prefix + "  ") : prefix));
}

type DiffLine = { kind: "same" | "added" | "removed"; text: string };

/** Line diff (longest common subsequence). */
function diffLines(before: string[], after: string[]): DiffLine[] {
  const n = before.length;
  const m = after.length;
  if (n * m > 4_000_000) return [...before.map((text) => ({ kind: "removed" as const, text })), ...after.map((text) => ({ kind: "added" as const, text }))];
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) lcs[i]![j] = before[i] === after[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && before[i] === after[j]) {
      out.push({ kind: "same", text: before[i]! });
      i++;
      j++;
    } else if (j < m && (i >= n || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) out.push({ kind: "added", text: after[j++]! });
    else out.push({ kind: "removed", text: before[i++]! });
  }
  return out;
}

const fetchVersion = (pageId: string, id: string) => api<{ content: Node; title: string }>(`/pages/${pageId}/history/${id}`);

/** The page's versions: each one shown as it was or as what changed in it, and restored if wanted. */
export function HistoryDialog({ page, onClose }: { page: PageDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const refresh = useRefreshPages();
  const list = useQuery({
    queryKey: ["history", page.id],
    queryFn: async () => (await api<{ versions: PageVersion[] }>(`/pages/${page.id}/history`)).versions,
    staleTime: 0,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [changes, setChanges] = useState(true);
  const [restoring, setRestoring] = useState(false);
  const versions = list.data ?? [];
  const current = versions.find((v) => v.id === selected) ?? versions[0];
  const previous = current ? versions[versions.indexOf(current) + 1] : undefined;
  const canRestore = atLeast(page.role, "editor");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const version = useQuery({
    queryKey: ["history", page.id, current?.id],
    queryFn: () => fetchVersion(page.id, current!.id),
    enabled: !!current,
    staleTime: Infinity,
  });
  const before = useQuery({
    queryKey: ["history", page.id, previous?.id],
    queryFn: () => fetchVersion(page.id, previous!.id),
    enabled: !!previous,
    staleTime: Infinity,
  });

  async function restore() {
    if (!current || !confirm(t("history.confirmRestore", { date: when(current.createdAt) }))) return;
    setRestoring(true);
    try {
      await api(`/pages/${page.id}/history/${current.id}/restore`, { method: "POST" });
      await Promise.all([qc.invalidateQueries({ queryKey: keys.page(page.id) }), qc.invalidateQueries({ queryKey: ["history", page.id] }), refresh()]);
      onClose();
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-neutral-900" role="dialog" aria-modal="true" aria-label={t("history.title")} data-history>
      <header className="flex items-center gap-2 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
        <History size={16} className="text-neutral-500" />
        <h2 className="min-w-0 flex-1 truncate font-semibold">
          {t("history.title")} · {pageTitle(page.title)}
        </h2>
        <button onClick={onClose} aria-label={t("common.close")} className="rounded p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800">
          <X size={18} />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col-reverse md:flex-row">
        <section className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-10">
          {!versions.length && list.isSuccess && <p className="text-sm text-neutral-500">{t("history.empty")}</p>}
          {current && (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
                  <input type="checkbox" role="switch" className="h-4 w-4 accent-blue-600" checked={changes} onChange={(e) => setChanges(e.target.checked)} />
                  {t("history.changes")}
                </label>
                {canRestore && current !== versions[0] && (
                  <button
                    onClick={restore}
                    disabled={restoring}
                    className="ml-auto flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    <RotateCcw size={14} /> {t("history.restore")}
                  </button>
                )}
              </div>
              <h1 className="mb-4 text-3xl font-bold">{pageTitle(version.data?.title ?? current.title)}</h1>
              {version.data &&
                (changes && previous ? (
                  <Changes before={before.data?.content} after={version.data.content} loading={!before.data} />
                ) : (
                  <>
                    {changes && <p className="mb-3 text-sm text-neutral-500">{t("history.firstVersion")}</p>}
                    <ReadOnly content={version.data.content as JSONContent} />
                  </>
                ))}
            </>
          )}
        </section>
        <aside className="max-h-48 shrink-0 overflow-y-auto border-b border-neutral-200 p-2 md:max-h-none md:w-72 md:border-b-0 md:border-l dark:border-neutral-800">
          {versions.map((v, i) => (
            <button
              key={v.id}
              onClick={() => setSelected(v.id)}
              aria-current={v === current}
              data-version={v.id}
              className={`mb-0.5 block w-full rounded px-3 py-2 text-left text-sm ${v === current ? "bg-blue-50 dark:bg-blue-950/50" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
            >
              <span className="block font-medium">{when(v.createdAt)}</span>
              {i === 0 && <span className="mr-1 text-xs text-green-700 dark:text-green-400">{t("history.latest")}</span>}
              {v.authors.length > 0 && <span className="text-xs text-neutral-500">{v.authors.map((a) => a.name).join(", ")}</span>}
              {v.agent && (
                <span className="block text-xs text-violet-700 dark:text-violet-400" title={t("history.agentHint")} data-version-agent>
                  <Bot size={12} className="mr-1 inline" />
                  {t("history.agent", { name: v.agent })}
                </span>
              )}
              {v.restoredFrom && (
                <span className="block text-xs text-amber-700 dark:text-amber-400">{t("history.restored", { date: when(v.restoredFrom) })}</span>
              )}
            </button>
          ))}
        </aside>
      </div>
    </div>
  );
}

/** What changed in a version compared to the one before: added lines in green, removed ones struck in red. */
function Changes({ before, after, loading }: { before: Node | undefined; after: Node; loading: boolean }) {
  const lines = useMemo(() => diffLines(textLines(before), textLines(after)), [before, after]);
  if (loading) return null;
  if (!lines.some((l) => l.kind !== "same")) return <p className="text-sm text-neutral-500">{t("history.noChange")}</p>;
  // Long runs of unchanged lines are folded, keeping two lines of context around each change.
  const shown: (DiffLine | { kind: "fold"; count: number })[] = [];
  let run: DiffLine[] = [];
  const flush = (end: boolean) => {
    const keepStart = shown.length ? 2 : 0;
    const keepEnd = end ? 0 : 2;
    if (run.length > keepStart + keepEnd + 1)
      shown.push(...run.slice(0, keepStart), { kind: "fold", count: run.length - keepStart - keepEnd }, ...run.slice(run.length - keepEnd));
    else shown.push(...run);
    run = [];
  };
  for (const l of lines) {
    if (l.kind === "same") run.push(l);
    else {
      flush(false);
      shown.push(l);
    }
  }
  flush(true);
  return (
    <div className="space-y-0.5 font-[inherit] text-[15px] leading-relaxed" data-diff>
      {shown.map((l, i) =>
        l.kind === "fold" ? (
          <div key={i} className="py-1 text-xs text-neutral-400">
            ⋯ {t("history.unchanged", { count: l.count })}
          </div>
        ) : (
          <div
            key={i}
            data-change={l.kind}
            className={`whitespace-pre-wrap rounded px-2 ${l.kind === "added" ? "bg-green-100 text-green-900 dark:bg-green-950/60 dark:text-green-200" : l.kind === "removed" ? "bg-red-100 text-red-900 line-through dark:bg-red-950/60 dark:text-red-200" : "text-neutral-600 dark:text-neutral-400"}`}
          >
            {l.text || " "}
          </div>
        ),
      )}
    </div>
  );
}

function ReadOnly({ content }: { content: JSONContent }) {
  const plugins = usePlugins();
  if (!plugins.data && !plugins.isError) return null;
  return <ReadOnlyEditor content={content} plugins={plugins.data ?? []} />;
}

function ReadOnlyEditor({ content, plugins }: { content: JSONContent; plugins: ClientPluginInfo[] }) {
  const editor = useEditor(
    { editable: false, content, extensions: baseExtensions({ collaborative: false, plugins }), editorProps: { attributes: { class: "nootion-content" } } },
    [content, plugins],
  );
  return <EditorContent editor={editor} />;
}
