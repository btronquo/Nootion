import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Clock, Database, FileText, ListChecks, Settings2, Star } from "lucide-react";
import {
  applyView,
  calendarDateProp,
  calendarSources,
  intlLocale,
  localDay,
  rowDays,
  shiftDate,
  t,
  type CalendarSource,
  type DatabaseRow,
  type DateValue,
  type OptionColor,
  type RecentPage,
  type ViewContext,
} from "@nootion/shared";
import { api } from "../lib/api";
import { useFavorites } from "../lib/queries";
import { useSession } from "../lib/session";
import { pageTitle } from "../lib/tree";
import { CoverFill } from "../components/PageCover";
import { SourcesPanel, useSourceDatabases } from "../database/CalendarBlockView";
import { OPTION_CLASSES } from "../database/format";
import { useDatabase, useDatabaseActions, useDatabaseList } from "../database/hooks";
import { Popover } from "../database/Popover";
import { pageIcon } from "../lib/icons";

/** Frame of a widget: a small title with an icon, optional tools on the right. */
export function Widget({ icon, title, tools, children, name }: { icon: ReactNode; title: ReactNode; tools?: ReactNode; children: ReactNode; name: string }) {
  return (
    <NodeViewWrapper className="home-widget my-6" contentEditable={false} data-drag-handle="" data-widget={name}>
      <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-neutral-500">
        {icon}
        <span className="min-w-0 truncate">{title}</span>
        <span className="ml-auto flex items-center gap-1">{tools}</span>
      </div>
      {children}
    </NodeViewWrapper>
  );
}

export const tool =
  "flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-normal text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200";
export const empty = "rounded-lg border border-dashed border-neutral-300 px-3 py-4 text-sm text-neutral-500 dark:border-neutral-700";
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(intlLocale(), { day: "numeric", month: "short" });

/** Widgets only make sense for a signed-in reader; on public pages they show nothing. */
export const isPublic = (extension: NodeViewProps["extension"]) => !!extension.options.publicToken;

/** Cards of the pages the reader opened lately. */
export function RecentPagesView({ extension }: NodeViewProps) {
  const recent = useQuery({
    queryKey: ["recent"],
    queryFn: async () => (await api<{ pages: RecentPage[] }>("/recent?limit=12")).pages,
    enabled: !isPublic(extension),
    staleTime: 0,
  });
  if (isPublic(extension)) return <NodeViewWrapper />;
  return (
    <Widget name="recent" icon={<Clock size={14} />} title={t("widget.recent")}>
      {recent.data && !recent.data.length && <p className={empty}>{t("widget.recentEmpty")}</p>}
      <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
        {recent.data?.map((p) => (
          <Link
            key={p.id}
            to={`/page/${p.id}`}
            data-recent={p.id}
            className="flex w-36 shrink-0 snap-start flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm transition hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="h-12 bg-neutral-100 dark:bg-neutral-800">{p.cover && <CoverFill cover={p.cover} position={p.coverPosition} />}</div>
            <div className="-mt-4 flex flex-1 flex-col gap-1 px-3 pb-3">
              <span className="text-2xl leading-none">{pageIcon(p.icon) ?? (p.kind === "database" ? "🗃" : <FileText size={22} className="text-neutral-400" />)}</span>
              <span className="line-clamp-2 text-sm font-medium">{pageTitle(p.title)}</span>
              <span className="mt-auto text-xs text-neutral-400">{shortDate(p.visitedAt)}</span>
            </div>
          </Link>
        ))}
      </div>
    </Widget>
  );
}

/** The reader's starred pages. */
export function FavoritesListView({ extension }: NodeViewProps) {
  const favorites = useFavorites();
  if (isPublic(extension)) return <NodeViewWrapper />;
  return (
    <Widget name="favorites" icon={<Star size={14} />} title={t("favorites.title")}>
      {favorites.data && !favorites.data.length && <p className={empty}>{t("widget.favoritesEmpty")}</p>}
      <div className="grid gap-1 sm:grid-cols-2">
        {favorites.data?.map((p) => (
          <Link
            key={p.id}
            to={`/page/${p.id}`}
            className="flex min-w-0 items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <span className="w-5 shrink-0 text-center">{pageIcon(p.icon) ?? (p.kind === "database" ? "🗃" : "📄")}</span>
            <span className="truncate">{pageTitle(p.title)}</span>
          </Link>
        ))}
      </div>
    </Widget>
  );
}

interface Upcoming {
  key: string;
  day: string;
  time: string | null;
  row: DatabaseRow;
  color: OptionColor;
  database: string;
}

const dayLabel = (day: string, today: string) => {
  if (day === today) return t("calendar.today");
  if (day === shiftDate(today, 1)) return t("widget.tomorrow");
  return new Date(`${day}T00:00:00`).toLocaleDateString(intlLocale(), { weekday: "long", day: "numeric", month: "long" });
};

/** Dated rows of some databases in the next days, soonest first. */
export function UpcomingEventsView({ node, updateAttributes, editor, extension }: NodeViewProps) {
  const sources = calendarSources(node.attrs.sources);
  const days = Number(node.attrs.days) || 14;
  const editable = editor.isEditable && !isPublic(extension);
  const { loaded, hidden } = useSourceDatabases(isPublic(extension) ? [] : sources, null);
  const [panel, setPanel] = useState<{ kind: "sources" | "days"; anchor: HTMLElement } | null>(null);
  const today = localDay(new Date());
  const last = shiftDate(today, days);

  const events = useMemo(() => {
    const list: Upcoming[] = [];
    for (const { source, data } of loaded) {
      const prop = calendarDateProp(data.properties, source.propertyId);
      if (!prop) continue;
      for (const row of data.rows) {
        const day = rowDays(prop, row).find((d) => d >= today && d <= last);
        if (!day) continue;
        const v = row.values[prop.id] as DateValue | string | null;
        const start = typeof v === "string" ? v : (v?.start ?? "");
        const time =
          start.length > 10 && start.slice(0, 10) === day ? new Date(start).toLocaleTimeString(intlLocale(), { hour: "2-digit", minute: "2-digit" }) : null;
        list.push({ key: `${data.id}:${row.id}`, day, time, row, color: source.color, database: pageTitle(data.title) });
      }
    }
    return list.sort((a, b) => a.day.localeCompare(b.day) || (a.time ?? "").localeCompare(b.time ?? "")).slice(0, 30);
  }, [loaded, today, last]);

  if (isPublic(extension)) return <NodeViewWrapper />;
  const byDay = [...new Set(events.map((e) => e.day))];
  return (
    <Widget
      name="upcoming"
      icon={<CalendarClock size={14} />}
      title={t("widget.upcoming")}
      tools={
        editable && (
          <>
            <button className={tool} onClick={(e) => setPanel({ kind: "days", anchor: e.currentTarget })}>
              {t("widget.nextDays", { count: days })}
            </button>
            <button className={tool} onClick={(e) => setPanel({ kind: "sources", anchor: e.currentTarget })} aria-label={t("calendarBlock.sources")}>
              <Settings2 size={14} />
            </button>
          </>
        )
      }
    >
      {!sources.length ? (
        <div className={`${empty} flex flex-col items-start gap-2`}>
          <span>{editable ? t("widget.upcomingChoose") : t("calendarBlock.emptyReadOnly")}</span>
          {editable && (
            <button
              className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
              onClick={(e) => setPanel({ kind: "sources", anchor: e.currentTarget })}
            >
              {t("calendarBlock.chooseDatabases")}
            </button>
          )}
        </div>
      ) : !events.length ? (
        <p className={empty}>{t("widget.upcomingEmpty", { count: days })}</p>
      ) : (
        <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {byDay.map((day) => (
            <div key={day} className="flex gap-3 px-3 py-2 sm:gap-4" data-upcoming-day={day}>
              <div
                className={`w-24 shrink-0 pt-0.5 text-xs first-letter:uppercase sm:w-32 ${day === today ? "font-semibold text-red-500" : "text-neutral-500"}`}
              >
                {dayLabel(day, today)}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                {events
                  .filter((e) => e.day === day)
                  .map((e) => (
                    <Link
                      key={e.key}
                      to={`/page/${e.row.id}`}
                      data-row={e.row.id}
                      className="flex min-w-0 items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    >
                      <span className={`h-3 w-1 shrink-0 rounded-full ${OPTION_CLASSES[e.color]}`} />
                      <span className="truncate">
                        {e.row.icon && <>{pageIcon(e.row.icon)} </>}
                        {pageTitle(e.row.title)}
                      </span>
                      <span className="ml-auto shrink-0 text-xs text-neutral-400">{[e.time, e.database].filter(Boolean).join(" · ")}</span>
                    </Link>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {hidden > 0 && <p className="mt-1 text-xs text-neutral-400">🔒 {t("calendarBlock.hidden", { count: hidden })}</p>}
      {panel?.kind === "sources" && (
        <SourcesPanel
          anchor={panel.anchor}
          sources={sources}
          loaded={loaded}
          onChange={(next: CalendarSource[]) => updateAttributes({ sources: next })}
          onClose={() => setPanel(null)}
        />
      )}
      {panel?.kind === "days" && (
        <Popover anchor={panel.anchor} onClose={() => setPanel(null)} width={180}>
          {[7, 14, 30, 90].map((n) => (
            <button
              key={n}
              onClick={() => {
                updateAttributes({ days: n });
                setPanel(null);
              }}
              className={`w-full rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 ${n === days ? "font-medium" : ""}`}
            >
              {t("widget.nextDays", { count: n })}
            </button>
          ))}
        </Popover>
      )}
    </Widget>
  );
}

/** The first rows of a database view, e.g. the open to-dos; a checkbox column can be ticked from here. */
export function DatabaseRowsView({ node, updateAttributes, editor, extension }: NodeViewProps) {
  const databaseId = (node.attrs.databaseId as string | null) ?? "";
  const editable = editor.isEditable && !isPublic(extension);
  const [picker, setPicker] = useState<HTMLElement | null>(null);
  if (isPublic(extension)) return <NodeViewWrapper />;
  return (
    <>
      {databaseId ? (
        <DatabaseRows
          id={databaseId}
          viewId={node.attrs.viewId as string | null}
          limit={Number(node.attrs.limit) || 5}
          editable={editable}
          onSettings={setPicker}
        />
      ) : (
        <Widget name="rows" icon={<ListChecks size={14} />} title={t("widget.rows")}>
          <div className={`${empty} flex flex-col items-start gap-2`}>
            <span>{editable ? t("widget.rowsChoose") : t("calendarBlock.emptyReadOnly")}</span>
            {editable && (
              <button className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700" onClick={(e) => setPicker(e.currentTarget)}>
                {t("widget.chooseDatabase")}
              </button>
            )}
          </div>
        </Widget>
      )}
      {picker && (
        <RowsSettings
          anchor={picker}
          databaseId={databaseId}
          viewId={node.attrs.viewId as string | null}
          limit={Number(node.attrs.limit) || 5}
          onChange={(attrs) => updateAttributes(attrs)}
          onClose={() => setPicker(null)}
        />
      )}
    </>
  );
}

function DatabaseRows({
  id,
  viewId,
  limit,
  editable,
  onSettings,
}: {
  id: string;
  viewId: string | null;
  limit: number;
  editable: boolean;
  onSettings: (el: HTMLElement) => void;
}) {
  const db = useDatabase(id);
  const actions = useDatabaseActions(id);
  const me = useSession().user?.id ?? null;
  const data = db.data;
  const view = data?.views.find((v) => v.id === viewId) ?? data?.views[0];
  const ctx: ViewContext | null = useMemo(() => (data ? { ...data, me } : null), [data, me]);
  const rows = useMemo(() => (ctx ? applyView(ctx, view?.config ?? {}) : []), [ctx, view?.config]);
  const check = data?.properties.find((p) => p.type === "checkbox");
  const canTick = !!check && editable && (data?.role === "editor" || data?.role === "full");

  const title = data ? (
    <Link to={`/page/${id}`} className="hover:underline">
      {pageIcon(data.icon) ?? "🗃"} {pageTitle(data.title)}
      {view && data.views.length > 1 && <span className="font-normal text-neutral-400"> · {view.name}</span>}
    </Link>
  ) : (
    t("widget.rows")
  );
  return (
    <Widget
      name="rows"
      icon={<Database size={14} />}
      title={title}
      tools={
        editable && (
          <button className={tool} onClick={(e) => onSettings(e.currentTarget)} aria-label={t("widget.settings")}>
            <Settings2 size={14} />
          </button>
        )
      }
    >
      {db.isError && <p className={empty}>🔒 {t("database.private")}</p>}
      {data && !rows.length && <p className={empty}>{t("widget.rowsEmpty")}</p>}
      {data && rows.length > 0 && (
        <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {rows.slice(0, limit).map((row) => (
            <div key={row.id} className="flex min-w-0 items-center gap-2 px-3 py-1.5 text-sm" data-row={row.id}>
              {check && (
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 accent-blue-600"
                  checked={row.values[check.id] === true}
                  disabled={!canTick}
                  aria-label={check.name}
                  onChange={(e) => actions.updateCell.mutate({ rowId: row.id, propId: check.id, value: e.target.checked })}
                />
              )}
              <Link
                to={`/page/${row.id}`}
                className={`min-w-0 truncate hover:underline ${check && row.values[check.id] === true ? "text-neutral-400 line-through" : ""}`}
              >
                {row.icon && <>{pageIcon(row.icon)} </>}
                {pageTitle(row.title)}
              </Link>
            </div>
          ))}
          {rows.length > limit && (
            <Link to={`/page/${id}`} className="block px-3 py-1.5 text-xs text-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-800/60">
              {t("widget.more", { count: rows.length - limit })}
            </Link>
          )}
        </div>
      )}
    </Widget>
  );
}

function RowsSettings({
  anchor,
  databaseId,
  viewId,
  limit,
  onChange,
  onClose,
}: {
  anchor: HTMLElement;
  databaseId: string;
  viewId: string | null;
  limit: number;
  onChange: (attrs: { databaseId?: string; viewId?: string | null; limit?: number }) => void;
  onClose: () => void;
}) {
  const list = useDatabaseList();
  const db = useDatabase(databaseId);
  const select = "w-full rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900";
  return (
    <Popover anchor={anchor} onClose={onClose} width={280}>
      <div className="space-y-2 p-2 text-sm">
        <label className="block">
          <span className="mb-0.5 block text-xs text-neutral-500">{t("common.database")}</span>
          <select className={select} value={databaseId} onChange={(e) => onChange({ databaseId: e.target.value, viewId: null })}>
            <option value="" disabled>
              {t("widget.chooseDatabase")}
            </option>
            {list.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {pageIcon(d.icon) ?? "🗃"} {pageTitle(d.title)}
              </option>
            ))}
          </select>
        </label>
        {db.data && db.data.views.length > 1 && (
          <label className="block">
            <span className="mb-0.5 block text-xs text-neutral-500">{t("widget.view")}</span>
            <select className={select} value={viewId ?? db.data.views[0]!.id} onChange={(e) => onChange({ viewId: e.target.value })}>
              {db.data.views.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className="mb-0.5 block text-xs text-neutral-500">{t("widget.limit")}</span>
          <select className={select} value={limit} onChange={(e) => onChange({ limit: Number(e.target.value) })}>
            {[3, 5, 10, 20].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-neutral-400">{t("widget.viewHelp")}</p>
      </div>
    </Popover>
  );
}
