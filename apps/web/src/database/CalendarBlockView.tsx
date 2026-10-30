import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Rss, Settings2, Trash2 } from "lucide-react";
import {
  atLeast,
  calendarDateProp,
  calendarSources,
  daysBetween,
  OPTION_COLORS,
  rowDays,
  t,
  type CalendarFeed,
  type CalendarSource,
  type DatabaseData,
  type DatabaseRow,
  type DateValue,
  type OptionColor,
} from "@nootion/shared";
import { api } from "../lib/api";
import { sendOrQueue } from "../lib/offline";
import { pageTitle } from "../lib/tree";
import { CalendarGrid, moveDate, type CalendarEntry, type CalendarMode } from "./Calendar";
import { colorLabel, OPTION_CLASSES } from "./format";
import { dbKey, useDatabaseList } from "./hooks";
import { Popover } from "./Popover";
import { copyText } from "../lib/browser";

export interface Loaded {
  source: CalendarSource;
  data: DatabaseData;
}

/** Databases of calendar sources, as the reader sees them; `hidden` counts those they can't open. */
export function useSourceDatabases(sources: CalendarSource[], token: string | null) {
  const queries = useQueries({
    queries: sources.map((s) => ({
      queryKey: token ? ["public", token, "database", s.databaseId] : dbKey(s.databaseId),
      queryFn: async () =>
        (await api<{ database: DatabaseData }>(token ? `/public/${token}/databases/${s.databaseId}` : `/databases/${s.databaseId}`)).database,
      retry: false,
      refetchInterval: () => (document.visibilityState === "visible" && !token ? 5000 : false),
    })),
  });
  const loaded: Loaded[] = sources.flatMap((source, i) => (queries[i]?.data ? [{ source, data: queries[i].data }] : []));
  return { loaded, hidden: queries.every((q) => !q.isLoading) ? sources.length - loaded.length : 0 };
}

/** Calendar block: the dated rows of one or several databases, each in its colour, on one calendar. */
export function CalendarBlockView({ node, updateAttributes, editor, extension }: NodeViewProps) {
  const token = extension.options.publicToken as string | null;
  const pageId = extension.options.pageId as string | null;
  const blockId = node.attrs.id as string | null;
  const sources = calendarSources(node.attrs.sources);
  const editable = editor.isEditable && !token;
  const [localMode, setLocalMode] = useState<CalendarMode>(node.attrs.mode === "week" ? "week" : "month");
  const setMode = (mode: CalendarMode) => (editable ? updateAttributes({ mode }) : setLocalMode(mode));
  const mode: CalendarMode = editable ? (node.attrs.mode === "week" ? "week" : "month") : localMode;
  const setSources = (next: CalendarSource[]) => updateAttributes({ sources: next });

  const navigate = useNavigate();
  const qc = useQueryClient();
  const { loaded, hidden } = useSourceDatabases(sources, token);

  const entries = (() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const { source, data } of loaded) {
      const prop = calendarDateProp(data.properties, source.propertyId);
      if (!prop) continue;
      const movable = !token && atLeast(data.role, "editor") && prop.type === "date";
      for (const row of data.rows) {
        const entry: CalendarEntry = {
          key: `${data.id}:${row.id}`,
          row,
          href: token ? `/p/${token}/${row.id}` : `/page/${row.id}`,
          movable,
          color: source.color,
          hint: pageTitle(data.title),
        };
        for (const day of rowDays(prop, row)) map.set(day, [...(map.get(day) ?? []), entry]);
      }
    }
    return map;
  })();

  // Databases where the reader can add a dated row.
  const writable = loaded.filter(({ source, data }) => atLeast(data.role, "editor") && calendarDateProp(data.properties, source.propertyId)?.type === "date");
  const [adding, setAdding] = useState<{ day: string; anchor: HTMLElement } | null>(null);
  const addRow = async ({ source, data }: Loaded, day: string) => {
    setAdding(null);
    const prop = calendarDateProp(data.properties, source.propertyId)!;
    const { row } = await api<{ row: DatabaseRow }>(`/databases/${data.id}/rows`, {
      method: "POST",
      body: { values: { [prop.id]: { start: day, end: null } } },
    });
    await qc.invalidateQueries({ queryKey: dbKey(data.id) });
    navigate(`/page/${row.id}`);
  };

  const onMove = async (entry: CalendarEntry, from: string, to: string) => {
    const [databaseId] = entry.key.split(":");
    const item = loaded.find((l) => l.data.id === databaseId);
    const prop = item && calendarDateProp(item.data.properties, item.source.propertyId);
    const value = prop && (entry.row.values[prop.id] as DateValue | null);
    if (!item || !prop || !value) return;
    const next = moveDate(value, daysBetween(from, to));
    qc.setQueryData<DatabaseData>(
      dbKey(item.data.id),
      (d) => d && { ...d, rows: d.rows.map((r) => (r.id === entry.row.id ? { ...r, values: { ...r.values, [prop.id]: next } } : r)) },
    );
    try {
      await sendOrQueue(`/databases/${item.data.id}/rows/${entry.row.id}`, { values: { [prop.id]: next } });
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
    await qc.invalidateQueries({ queryKey: dbKey(item.data.id) });
  };

  const [panel, setPanel] = useState<{ kind: "sources" | "feed"; anchor: HTMLElement } | null>(null);
  const tool =
    "flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200";

  return (
    <NodeViewWrapper className="calendar-block my-4" contentEditable={false} data-drag-handle="" data-calendar-block="">
      {sources.length > 0 && (
        <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs">
          {loaded.map(({ source, data }) => {
            const chip = (
              <span className={`inline-flex max-w-48 items-center truncate rounded px-1.5 py-0.5 ${OPTION_CLASSES[source.color]}`}>
                {pageTitle(data.title)}
              </span>
            );
            return token ? (
              <span key={data.id}>{chip}</span>
            ) : (
              <Link key={data.id} to={`/page/${data.id}`} className="hover:underline">
                {chip}
              </Link>
            );
          })}
          {hidden > 0 && (
            <span className="text-neutral-400">🔒 {t("calendarBlock.hidden", { count: sources.length - loaded.length })}</span>
          )}
        </div>
      )}
      {sources.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded border border-dashed border-neutral-300 px-3 py-4 text-sm text-neutral-500 dark:border-neutral-700">
          <span>📅 {editable ? t("calendarBlock.empty") : t("calendarBlock.emptyReadOnly")}</span>
          {editable && (
            <button
              className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
              onClick={(e) => setPanel({ kind: "sources", anchor: e.currentTarget })}
            >
              {t("calendarBlock.chooseDatabases")}
            </button>
          )}
        </div>
      ) : (
        <CalendarGrid
          mode={mode}
          onMode={setMode}
          entries={entries}
          onMove={token ? undefined : onMove}
          onAdd={writable.length ? (day, anchor) => (writable.length === 1 ? addRow(writable[0]!, day) : setAdding({ day, anchor })) : undefined}
          tools={
            <>
              {editable && (
                <button className={tool} onClick={(e) => setPanel({ kind: "sources", anchor: e.currentTarget })}>
                  <Settings2 size={14} /> {t("calendarBlock.sources")}
                </button>
              )}
              {!token && pageId && blockId && (
                <button className={tool} onClick={(e) => setPanel({ kind: "feed", anchor: e.currentTarget })}>
                  <Rss size={14} /> {t("calendarBlock.subscribe")}
                </button>
              )}
            </>
          }
        />
      )}
      {adding && (
        <Popover anchor={adding.anchor} onClose={() => setAdding(null)} width={220}>
          <div className="px-2 pb-1 pt-1 text-xs font-medium text-neutral-500">{t("calendarBlock.addTo")}</div>
          {writable.map((w) => (
            <button
              key={w.data.id}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
              onClick={() => addRow(w, adding.day)}
            >
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${OPTION_CLASSES[w.source.color]}`} />
              <span className="truncate">{pageTitle(w.data.title)}</span>
            </button>
          ))}
        </Popover>
      )}
      {panel?.kind === "sources" && (
        <SourcesPanel anchor={panel.anchor} sources={sources} loaded={loaded} onChange={setSources} onClose={() => setPanel(null)} />
      )}
      {panel?.kind === "feed" && pageId && blockId && <FeedPanel anchor={panel.anchor} pageId={pageId} blockId={blockId} onClose={() => setPanel(null)} />}
    </NodeViewWrapper>
  );
}

export function SourcesPanel({
  anchor,
  sources,
  loaded,
  onChange,
  onClose,
}: {
  anchor: HTMLElement;
  sources: CalendarSource[];
  loaded: Loaded[];
  onChange: (sources: CalendarSource[]) => void;
  onClose: () => void;
}) {
  const list = useDatabaseList();
  const [query, setQuery] = useState("");
  const used = new Set(sources.map((s) => s.databaseId));
  const candidates = (list.data ?? []).filter((d) => !used.has(d.id) && pageTitle(d.title).toLowerCase().includes(query.toLowerCase())).slice(0, 8);
  const set = (i: number, patch: Partial<CalendarSource>) => onChange(sources.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const select = "min-w-0 rounded border border-neutral-300 bg-transparent px-1 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-900";

  return (
    <Popover anchor={anchor} onClose={onClose} width={340}>
      <div className="px-2 pb-1 pt-1 text-xs font-medium text-neutral-500">{t("calendarBlock.sources")}</div>
      {sources.map((s, i) => {
        const data = loaded.find((l) => l.source.databaseId === s.databaseId)?.data;
        const dates = data?.properties.filter((p) => p.type === "date" || p.type === "created_time" || p.type === "last_edited_time") ?? [];
        const current = data ? calendarDateProp(data.properties, s.propertyId) : undefined;
        return (
          <div key={s.databaseId} className="flex items-center gap-1.5 px-2 py-1 text-sm" data-source={s.databaseId}>
            <select
              aria-label={t("calendarBlock.color")}
              value={s.color}
              onChange={(e) => set(i, { color: e.target.value as OptionColor })}
              className={`w-6 shrink-0 cursor-pointer appearance-none rounded-full text-transparent ${OPTION_CLASSES[s.color]}`}
            >
              {OPTION_COLORS.map((c) => (
                <option key={c} value={c} className="text-neutral-900">
                  {colorLabel(c)}
                </option>
              ))}
            </select>
            <span className="min-w-0 flex-1 truncate">{data ? pageTitle(data.title) : "🔒"}</span>
            {dates.length > 0 && (
              <select
                aria-label={t("calendarBlock.dateProperty")}
                value={current?.id ?? ""}
                onChange={(e) => set(i, { propertyId: e.target.value })}
                className={`max-w-28 ${select}`}
              >
                {dates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            {data && !dates.length && <span className="text-xs text-amber-600">{t("calendarBlock.noDate")}</span>}
            <button
              aria-label={t("calendarBlock.remove")}
              onClick={() => onChange(sources.filter((_, j) => j !== i))}
              className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-red-600 dark:hover:bg-neutral-800"
            >
              <Trash2 size={14} />
            </button>
          </div>
        );
      })}
      <div className="mt-1 border-t border-neutral-200 px-2 pt-2 dark:border-neutral-700">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("calendarBlock.searchDatabase")}
          aria-label={t("calendarBlock.searchDatabase")}
          className="mb-1 w-full rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700"
        />
        {candidates.map((d) => (
          <button
            key={d.id}
            onClick={() => onChange([...sources, { databaseId: d.id, propertyId: null, color: OPTION_COLORS[(sources.length + 5) % OPTION_COLORS.length]! }])}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <CalendarPlus size={14} className="shrink-0 text-neutral-400" />
            <span className="truncate">
              {d.icon ?? "🗃"} {pageTitle(d.title)}
            </span>
          </button>
        ))}
        {list.data && !candidates.length && <p className="px-2 py-1.5 text-xs text-neutral-400">{t("calendarBlock.noDatabase")}</p>}
      </div>
    </Popover>
  );
}

/** The reader's private iCal link for this block. */
function FeedPanel({ anchor, pageId, blockId, onClose }: { anchor: HTMLElement; pageId: string; blockId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const key = ["calendar-feed", pageId, blockId];
  const feed = useQuery({ queryKey: key, queryFn: async () => (await api<{ feed: CalendarFeed | null }>(`/calendar-feeds/${pageId}/${blockId}`)).feed });
  const [copied, setCopied] = useState(false);
  const path = `/calendar-feeds/${pageId}/${blockId}`;
  const create = async () => qc.setQueryData(key, (await api<{ feed: CalendarFeed }>(path, { method: "POST" })).feed);
  const remove = async () => {
    await api(path, { method: "DELETE" });
    qc.setQueryData(key, null);
  };
  const btn = "rounded px-2 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800";

  return (
    <Popover anchor={anchor} onClose={onClose} width={340}>
      <div className="space-y-2 p-2 text-sm">
        <p className="text-xs text-neutral-500">{t("calendarBlock.feedHelp")}</p>
        {feed.data === null && (
          <button className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700" onClick={create}>
            {t("calendarBlock.createFeed")}
          </button>
        )}
        {feed.data && (
          <>
            <input
              readOnly
              value={feed.data.url}
              onFocus={(e) => e.currentTarget.select()}
              aria-label={t("calendarBlock.feedLink")}
              className="w-full rounded border border-neutral-300 bg-transparent px-2 py-1 text-xs dark:border-neutral-700"
            />
            <div className="flex flex-wrap gap-1">
              <button
                className={`${btn} bg-neutral-100 dark:bg-neutral-800`}
                onClick={async () => {
                  setCopied(await copyText(feed.data!.url));
                }}
              >
                {copied ? t("calendarBlock.copied") : t("calendarBlock.copy")}
              </button>
              <a className={`${btn} bg-neutral-100 dark:bg-neutral-800`} href={feed.data.url.replace(/^https?:/, "webcal:")}>
                {t("calendarBlock.openInApp")}
              </a>
              <button
                className={btn}
                onClick={async () => {
                  await remove();
                  await create();
                  setCopied(false);
                }}
              >
                {t("calendarBlock.resetFeed")}
              </button>
              <button className={`${btn} text-red-600`} onClick={remove}>
                {t("calendarBlock.deleteFeed")}
              </button>
            </div>
            <p className="text-xs text-neutral-400">{t("calendarBlock.feedPrivate")}</p>
          </>
        )}
      </div>
    </Popover>
  );
}
