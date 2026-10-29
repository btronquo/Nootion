import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Database, FileText, Search } from "lucide-react";
import { t, type SearchResult } from "@nootion/shared";
import { api } from "../lib/api";

/** Opens the search dialog with Ctrl+K (Cmd+K on a Mac). */
export function useSearchShortcut(open: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
}

/** The snippet with the matched words (between \u0001 and \u0002) highlighted. */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\u0001[^\u0002]*\u0002)/);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("\u0001") ? (
          <mark key={i} className="rounded-sm bg-amber-200/70 px-0.5 text-inherit dark:bg-amber-500/30">
            {part.slice(1, -1)}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function SearchDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), 150);
    return () => clearTimeout(t);
  }, [input]);

  const search = useQuery({
    queryKey: ["search", query],
    queryFn: () => api<{ results: SearchResult[] }>(`/search?q=${encodeURIComponent(query)}`),
    enabled: query.length > 0,
    placeholderData: keepPreviousData,
  });
  const results = query ? (search.data?.results ?? []) : [];

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function open(result: SearchResult | undefined) {
    if (!result) return;
    onClose();
    navigate(`/page/${result.id}`);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      open(results[active]);
    } else if (e.key === "Escape") onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-[12vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={t("search.title")}
        className="w-full max-w-xl overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-neutral-200 px-4 dark:border-neutral-800">
          <Search size={18} className="shrink-0 text-neutral-400" />
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("search.placeholder")}
            aria-label={t("search.label")}
            className="w-full bg-transparent py-3.5 text-base outline-none placeholder:text-neutral-400"
          />
        </div>
        {query && (
          <ul ref={listRef} role="listbox" className="max-h-[55vh] overflow-y-auto p-1.5">
            {results.map((r, i) => (
              <li
                key={r.id}
                data-index={i}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => setActive(i)}
                onClick={() => open(r)}
                className={`flex cursor-pointer gap-3 rounded-lg px-3 py-2 ${i === active ? "bg-neutral-100 dark:bg-neutral-800" : ""}`}
              >
                <span className="mt-0.5 w-5 shrink-0 text-center">
                  {r.icon ??
                    (r.kind === "database" ? (
                      <Database size={16} className="inline text-neutral-400" />
                    ) : (
                      <FileText size={16} className="inline text-neutral-400" />
                    ))}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.title || t("common.untitled")}</span>
                  {r.path.length > 0 && <span className="block truncate text-xs text-neutral-500">{r.path.join(" / ")}</span>}
                  {r.snippet && (
                    <span className="mt-0.5 line-clamp-2 text-xs text-neutral-600 dark:text-neutral-400">
                      <Snippet text={r.snippet} />
                    </span>
                  )}
                </span>
              </li>
            ))}
            {!search.isFetching && results.length === 0 && <li className="px-3 py-6 text-center text-sm text-neutral-500">{t("search.noResults")}</li>}
          </ul>
        )}
        <div className="flex gap-4 border-t border-neutral-200 px-4 py-2 text-xs text-neutral-500 dark:border-neutral-800">
          <span>{t("search.hintChoose")}</span>
          <span>{t("search.hintOpen")}</span>
          <span>{t("search.hintClose")}</span>
        </div>
      </div>
    </div>
  );
}
