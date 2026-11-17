import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, BookmarkPlus, ChevronDown, ChevronRight, Paperclip, Search, X } from "lucide-react";
import {
  EDITED_SINCE_PRESETS,
  SEARCH_KINDS,
  hasSearchFilters,
  t,
  type SavedSearch,
  type SearchDatabase,
  type SearchFilters,
  type SearchResult,
} from "@nootion/shared";
import { api } from "../lib/api";
import { useClosing } from "./ui";
import { PageGlyph } from "../lib/icons";
import { useUserDirectory, useWorkspaces } from "../lib/queries";
import { useSession } from "../lib/session";
import { currentActions, matchActions, recentActions, runAction, type Action } from "../lib/actions";

/** Opens the command palette (search and actions) with Ctrl+K (Cmd+K on a Mac). */
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

/** What the palette opens with: words and filters, for example those of a saved search. */
export interface SearchStart {
  query?: string;
  filters?: SearchFilters;
}

const savedKey = ["search", "saved"] as const;

/** The user's saved searches, by name. */
export function useSavedSearches() {
  return useQuery({ queryKey: savedKey, queryFn: async () => (await api<{ searches: SavedSearch[] }>("/search/saved")).searches });
}

/** Query string of GET /api/search for words and filters. */
export function searchParams(query: string, filters: SearchFilters, limit?: number): string {
  const params = new URLSearchParams({ q: query });
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, String(value));
  if (limit) params.set("limit", String(limit));
  return params.toString();
}

/** A filter as a small menu: highlighted while it is set. */
function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  children: React.ReactNode;
}) {
  return (
    <span className="relative inline-flex shrink-0">
      <select
        aria-label={label}
        title={label}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        className={`max-w-[10rem] cursor-pointer appearance-none truncate rounded-full border py-1 pr-6 pl-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
          value
            ? "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-950/60 dark:text-blue-200"
            : "border-neutral-200 bg-white text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
        }`}
      >
        {children}
      </select>
      <ChevronDown size={12} className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-neutral-400" />
    </span>
  );
}

function ResultIcon({ r }: { r: SearchResult }) {
  return <PageGlyph icon={r.icon} kind={r.kind} size={16} />;
}

/** Actions listed with nothing typed, or above the pages found. */
const IDLE_ACTIONS = 6;
const ACTIONS_ABOVE_PAGES = 5;

type Item = { kind: "action"; action: Action } | { kind: "saved"; search: SavedSearch } | { kind: "page"; result: SearchResult };

/**
 * The command palette: typing finds pages (with filters, and searches that can be saved), and the actions of the
 * screen that match (new page, go to…, the open page's own…), the most recently used first. Typing ">" first lists
 * actions only. With nothing typed, it lists the actions used last and the saved searches.
 */
export function SearchDialog({ onClose, initial }: { onClose: () => void; initial?: SearchStart }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useSession();
  const [input, setInput] = useState(initial?.query ?? "");
  const [query, setQuery] = useState((initial?.query ?? "").trim());
  const [filters, setFilters] = useState<SearchFilters>(initial?.filters ?? {});
  const [active, setActive] = useState(0);
  const [saveName, setSaveName] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Read once: what can be done when the palette opened.
  const [actions] = useState(currentActions);
  const [recent] = useState(recentActions);

  const actionsOnly = input.trimStart().startsWith(">");
  const typed = actionsOnly ? input.trimStart().slice(1).trim() : input.trim();

  useEffect(() => {
    const t = setTimeout(() => setQuery(actionsOnly ? "" : input.trim()), 150);
    return () => clearTimeout(t);
  }, [input, actionsOnly]);

  const filtered = hasSearchFilters(filters);
  const searching = !actionsOnly && (query.length > 0 || filtered);
  const search = useQuery({
    queryKey: ["search", query, filters],
    queryFn: () => api<{ results: SearchResult[] }>(`/search?${searchParams(query, filters)}`),
    enabled: searching,
    placeholderData: keepPreviousData,
  });
  const results = searching ? (search.data?.results ?? []) : [];

  const saved = useSavedSearches();
  const workspaces = useWorkspaces();
  const people = useUserDirectory();
  const databases = useQuery({
    queryKey: ["search", "databases"],
    queryFn: async () => (await api<{ databases: SearchDatabase[] }>("/search/databases")).databases,
    staleTime: 30_000,
  });
  const databaseChoices = useMemo(
    () => (databases.data ?? []).filter((d) => !filters.workspaceId || d.workspaceId === filters.workspaceId),
    [databases.data, filters.workspaceId],
  );

  const save = useMutation({
    mutationFn: (name: string) => api<SavedSearch>("/search/saved", { method: "POST", body: { name, query: input.trim(), filters } }),
    onSuccess: () => {
      setSaveName(null);
      void qc.invalidateQueries({ queryKey: savedKey });
      inputRef.current?.focus();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/search/saved/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: savedKey }),
  });

  const { closing, close } = useClosing(onClose);

  // Without words or filters, the saved searches are listed instead of results.
  const showSaved = !searching && !actionsOnly;
  const savedList = showSaved ? (saved.data ?? []) : [];

  // Filters narrow a search of the content: actions are listed without them.
  const matched = useMemo(() => {
    if (filtered && !actionsOnly) return [];
    const found = matchActions(actions, typed, recent);
    if (actionsOnly) return found;
    return found.slice(0, typed ? ACTIONS_ABOVE_PAGES : IDLE_ACTIONS);
  }, [actions, typed, recent, actionsOnly, filtered]);

  const items: Item[] = [
    ...matched.map((action) => ({ kind: "action" as const, action })),
    ...savedList.map((search) => ({ kind: "saved" as const, search })),
    ...results.map((result) => ({ kind: "page" as const, result })),
  ];

  useEffect(() => setActive(0), [typed, actionsOnly, query, filters, showSaved]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const setFilter = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K] | undefined) =>
    setFilters((f) => {
      const next = { ...f, [key]: value };
      // A database of another space no longer applies.
      if (key === "workspaceId" && value && next.databaseId && databases.data?.find((d) => d.id === next.databaseId)?.workspaceId !== value)
        delete next.databaseId;
      for (const k of Object.keys(next) as (keyof SearchFilters)[]) if (next[k] === undefined) delete next[k];
      return next;
    });

  function apply(s: SavedSearch | undefined) {
    if (!s) return;
    setInput(s.query);
    setQuery(s.query.trim());
    setFilters(s.filters);
    inputRef.current?.focus();
  }

  function choose(item: Item | undefined) {
    if (!item) return;
    if (item.kind === "saved") return apply(item.search);
    onClose();
    if (item.kind === "action") runAction(item.action);
    else navigate(`/page/${item.result.id}`);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(items[active]);
    } else if (e.key === "Escape") close();
  }

  const me = user?.id;
  const row = (i: number) => `flex cursor-pointer gap-3 rounded-lg px-3 py-2 ${i === active ? "bg-neutral-100 dark:bg-neutral-800" : ""}`;
  const heading = "px-3 pb-1 pt-2 text-xs font-medium text-neutral-500";
  const loading = search.isFetching || query !== input.trim();

  return (
    <div
      className="nt-backdrop fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-[12vh]"
      data-closing={closing || undefined}
      onMouseDown={close}
    >
      <div
        role="dialog"
        aria-label={t("palette.label")}
        className="nt-dialog w-full max-w-xl overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-900"
        onMouseDown={(e) => e.stopPropagation()}
        data-command-palette
      >
        <div className="flex items-center gap-2 border-b border-neutral-200 px-4 dark:border-neutral-800">
          {actionsOnly ? <ChevronRight size={18} className="shrink-0 text-neutral-400" /> : <Search size={18} className="shrink-0 text-neutral-400" />}
          <input
            ref={inputRef}
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("palette.placeholder")}
            aria-label={t("palette.label")}
            role="combobox"
            aria-expanded={items.length > 0}
            aria-controls="nt-palette-list"
            aria-activedescendant={items.length ? `nt-palette-${active}` : undefined}
            className="w-full bg-transparent py-3.5 text-base outline-none placeholder:text-neutral-400"
          />
          {searching && saveName === null && (
            <button
              type="button"
              onClick={() => setSaveName(input.trim())}
              title={t("search.save")}
              aria-label={t("search.save")}
              data-save-search
              className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <BookmarkPlus size={14} /> <span className="hidden sm:inline">{t("search.saveConfirm")}</span>
            </button>
          )}
        </div>
        {actionsOnly ? null : saveName === null ? (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800" data-search-filters>
            {(workspaces.data?.length ?? 0) > 1 && (
              <FilterSelect label={t("search.filterSpace")} value={filters.workspaceId} onChange={(v) => setFilter("workspaceId", v)}>
                <option value="">{t("search.allSpaces")}</option>
                {workspaces.data!.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </FilterSelect>
            )}
            <FilterSelect label={t("search.filterKind")} value={filters.kind} onChange={(v) => setFilter("kind", v as SearchFilters["kind"])}>
              <option value="">{t("search.kindAll")}</option>
              {SEARCH_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`search.kind.${k}`)}
                </option>
              ))}
            </FilterSelect>
            {databaseChoices.length > 0 && (
              <FilterSelect label={t("search.filterDatabase")} value={filters.databaseId} onChange={(v) => setFilter("databaseId", v)}>
                <option value="">{t("search.allDatabases")}</option>
                {databaseChoices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title || t("common.untitled")}
                  </option>
                ))}
              </FilterSelect>
            )}
            <FilterSelect label={t("search.filterAuthor")} value={filters.authorId} onChange={(v) => setFilter("authorId", v)}>
              <option value="">{t("search.anyAuthor")}</option>
              {me && <option value={me}>{t("search.authorMe")}</option>}
              {(people.data ?? [])
                .filter((p) => p.id !== me)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </FilterSelect>
            <FilterSelect label={t("search.filterEdited")} value={filters.editedSince} onChange={(v) => setFilter("editedSince", v)}>
              <option value="">{t("search.editedAny")}</option>
              {EDITED_SINCE_PRESETS.map((p) => (
                <option key={p} value={p}>
                  {t(`search.edited.${p}`)}
                </option>
              ))}
              {filters.editedSince && !(EDITED_SINCE_PRESETS as readonly string[]).includes(filters.editedSince) && (
                <option value={filters.editedSince}>{filters.editedSince}</option>
              )}
            </FilterSelect>
            {filtered && (
              <button
                type="button"
                onClick={() => setFilters({})}
                title={t("search.clearFilters")}
                aria-label={t("search.clearFilters")}
                className="rounded-full p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <X size={14} />
              </button>
            )}
          </div>
        ) : (
          <form
            className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800"
            onSubmit={(e) => {
              e.preventDefault();
              if (saveName.trim()) save.mutate(saveName.trim());
            }}
          >
            <Bookmark size={14} className="shrink-0 text-neutral-400" />
            <input
              autoFocus
              value={saveName}
              maxLength={100}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setSaveName(null);
                  inputRef.current?.focus();
                }
              }}
              placeholder={t("search.saveName")}
              aria-label={t("search.saveName")}
              className="min-w-0 flex-1 rounded-md border border-neutral-200 bg-transparent px-2 py-1 text-sm outline-none focus:border-blue-400 dark:border-neutral-700"
            />
            <button
              type="submit"
              disabled={!saveName.trim() || save.isPending}
              className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {t("search.saveConfirm")}
            </button>
            <button
              type="button"
              onClick={() => setSaveName(null)}
              aria-label={t("common.cancel")}
              className="rounded p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <X size={14} />
            </button>
            {save.error && <span className="text-xs text-red-600">{save.error.message}</span>}
          </form>
        )}
        <ul ref={listRef} id="nt-palette-list" role="listbox" className="max-h-[55vh] overflow-y-auto p-1.5 empty:hidden">
          {matched.length > 0 && (
            <li role="presentation" className={heading}>
              {t("palette.actions")}
            </li>
          )}
          {matched.map((action, i) => (
            <li
              key={action.id}
              id={`nt-palette-${i}`}
              data-index={i}
              data-action={action.id}
              role="option"
              aria-selected={i === active}
              onMouseMove={() => setActive(i)}
              onClick={() => choose(items[i])}
              className={`${row(i)} items-center`}
            >
              <span className="flex w-5 shrink-0 justify-center text-neutral-500">{action.icon}</span>
              <span className="min-w-0 flex-1 truncate text-sm">{action.title()}</span>
              {action.shortcut && (
                <kbd className="shrink-0 rounded border border-neutral-300 px-1 font-sans text-[10px] text-neutral-400 dark:border-neutral-700">
                  {action.shortcut}
                </kbd>
              )}
            </li>
          ))}
          {actionsOnly && matched.length === 0 && <li className="px-3 py-6 text-center text-sm text-neutral-500">{t("palette.noActions")}</li>}
          {showSaved && (
            <li role="presentation" className={heading}>
              {t("search.saved")}
            </li>
          )}
          {showSaved && savedList.length === 0 && <li className="px-3 pb-3 text-sm text-neutral-500">{t("search.noSaved")}</li>}
          {savedList.map((s, j) => {
            const i = matched.length + j;
            return (
              <li
                key={s.id}
                id={`nt-palette-${i}`}
                data-index={i}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => setActive(i)}
                onClick={() => choose(items[i])}
                className={`group ${row(i)} items-center`}
              >
                <Bookmark size={16} className="shrink-0 text-neutral-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{s.name}</span>
                  <span className="block truncate text-xs text-neutral-500">
                    {describeSearch(s, { workspaces: workspaces.data ?? [], databases: databases.data ?? [], people: people.data ?? [], me })}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove.mutate(s.id);
                  }}
                  title={t("search.deleteSaved")}
                  aria-label={t("search.deleteSaved")}
                  className="rounded p-1 text-neutral-400 opacity-0 group-hover:opacity-100 hover:bg-neutral-200 hover:text-neutral-700 focus:opacity-100 max-sm:opacity-100 dark:hover:bg-neutral-700"
                >
                  <X size={14} />
                </button>
              </li>
            );
          })}
          {results.length > 0 && matched.length > 0 && (
            <li role="presentation" className={heading}>
              {t("palette.pages")}
            </li>
          )}
          {results.map((r, j) => {
            const i = matched.length + j;
            return (
              <li
                key={`${r.id}:${r.file?.id ?? ""}`}
                id={`nt-palette-${i}`}
                data-index={i}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => setActive(i)}
                onClick={() => choose(items[i])}
                className={row(i)}
              >
                <span className="mt-0.5 w-5 shrink-0 text-center">
                  <ResultIcon r={r} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.title || t("common.untitled")}</span>
                  {r.path.length > 0 && <span className="block truncate text-xs text-neutral-500">{r.path.join(" / ")}</span>}
                  {r.file && (
                    <a
                      href={`/api/attachments/${r.file.id}`}
                      target="_blank"
                      rel="noopener"
                      onClick={(e) => e.stopPropagation()}
                      title={t("search.openFile")}
                      data-file-result={r.file.id}
                      className="mt-0.5 flex w-fit max-w-full items-center gap-1 truncate rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-700 hover:underline dark:bg-neutral-800 dark:text-neutral-300"
                    >
                      <Paperclip size={12} className="shrink-0" /> <span className="truncate">{r.file.name}</span>
                    </a>
                  )}
                  {r.snippet && (
                    <span className="mt-0.5 line-clamp-2 text-xs text-neutral-600 dark:text-neutral-400" data-match={r.match}>
                      <Snippet text={r.snippet} />
                    </span>
                  )}
                </span>
              </li>
            );
          })}
          {searching && !loading && results.length === 0 && matched.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-neutral-500">{t("search.noResults")}</li>
          )}
        </ul>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-neutral-200 px-4 py-2 text-xs text-neutral-500 dark:border-neutral-800">
          <span>{t("search.hintChoose")}</span>
          <span>{t("palette.hintRun")}</span>
          <span>{t("palette.hintActions")}</span>
          <span className="max-sm:hidden">{t("search.hintClose")}</span>
        </div>
      </div>
    </div>
  );
}

/** A saved search in a few words: "unpaid · Database rows · Invoices · Last 30 days". */
export function describeSearch(
  s: Pick<SavedSearch, "query" | "filters">,
  ctx: { workspaces: { id: string; name: string }[]; databases: SearchDatabase[]; people: { id: string; name: string }[]; me?: string },
): string {
  const f = s.filters;
  const parts: string[] = [];
  if (s.query.trim()) parts.push(`“${s.query.trim()}”`);
  if (f.workspaceId) parts.push(ctx.workspaces.find((w) => w.id === f.workspaceId)?.name ?? t("search.filterSpace"));
  if (f.kind) parts.push(t(`search.kind.${f.kind}`));
  if (f.databaseId) parts.push(ctx.databases.find((d) => d.id === f.databaseId)?.title || t("search.filterDatabase"));
  if (f.authorId) parts.push(f.authorId === ctx.me ? t("search.authorMe") : (ctx.people.find((p) => p.id === f.authorId)?.name ?? t("search.filterAuthor")));
  if (f.editedSince)
    parts.push(
      (EDITED_SINCE_PRESETS as readonly string[]).includes(f.editedSince)
        ? t(`search.edited.${f.editedSince as (typeof EDITED_SINCE_PRESETS)[number]}`)
        : f.editedSince,
    );
  return parts.join(" · ");
}
