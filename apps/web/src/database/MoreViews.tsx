import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, FileText, Plus } from "lucide-react";
import {
  calendarDateProp,
  daysBetween,
  initialValues,
  intlLocale,
  localDay,
  rowDays,
  shiftDate,
  t,
  type DatabaseData,
  type DatabaseRow,
  type DatabaseViewInfo,
  type DateValue,
  type ViewContext,
} from "@nootion/shared";
import { Cell } from "./Cell";
import { orderedColumns } from "./DatabaseTable";
import { isEmpty } from "./BoardView";
import type { useDatabaseActions } from "./hooks";
import { CoverFill } from "../components/PageCover";
import { pageTitle } from "../lib/tree";

interface MoreViewProps {
  data: DatabaseData;
  actions?: ReturnType<typeof useDatabaseActions>;
  rowHref: (row: DatabaseRow) => string;
  fileUrl?: (id: string) => string;
  view: DatabaseViewInfo;
  ctx: ViewContext;
  rows: DatabaseRow[];
  editable: boolean;
}

/** Properties shown on a line or a card: the view's visible ones that have a value. */
function shownProps(data: DatabaseData, view: DatabaseViewInfo, row: DatabaseRow) {
  return orderedColumns(data.properties, view.config.columns).filter((c) => !c.col.hidden && c.prop.type !== "title" && !isEmpty(row.values[c.prop.id]));
}

function RowValues({
  data,
  view,
  row,
  rowHref,
  fileUrl,
  className,
}: Omit<MoreViewProps, "ctx" | "rows" | "editable"> & { row: DatabaseRow; className: string }) {
  return (
    <>
      {shownProps(data, view, row).map((c) => (
        <div
          key={c.prop.id}
          className={`text-xs [&_[role=gridcell]]:min-h-0 [&_[role=gridcell]]:py-0.5 [&_[role=gridcell]]:hover:bg-transparent ${className}`}
          title={c.prop.name}
        >
          <Cell
            prop={c.prop}
            value={row.values[c.prop.id] ?? null}
            rowId={row.id}
            people={data.people}
            editable={false}
            variant="panel"
            fileUrl={fileUrl}
            related={data.related}
            rollupTarget={data.rollupTargets[c.prop.id]}
            rowHref={(id) => rowHref({ id } as DatabaseRow)}
            onChange={() => {}}
            onCreateOption={() => Promise.reject(new Error("read-only"))}
          />
        </div>
      ))}
    </>
  );
}

const RowTitle = ({ row }: { row: DatabaseRow }) => (
  <>
    {row.icon && <span className="mr-1">{row.icon}</span>}
    {row.title ? row.title : <span className="text-neutral-400">{pageTitle("")}</span>}
  </>
);

/** Adds a row with the view's values (and any given ones), then opens it. */
function useAddRow({ actions, ctx, view, rowHref }: Pick<MoreViewProps, "actions" | "ctx" | "view" | "rowHref">) {
  const navigate = useNavigate();
  return async (values: Record<string, unknown> = {}) => {
    if (!actions) return;
    const { row } = await actions.addRow.mutateAsync({ ...initialValues(ctx, view.config), ...values } as Parameters<typeof actions.addRow.mutateAsync>[0]);
    navigate(rowHref(row));
  };
}

const newButton =
  "flex items-center gap-1 rounded px-1.5 py-1 text-sm text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200";

/** One compact line per row, with its properties on the right. */
export function ListView(props: MoreViewProps) {
  const { rows, editable, rowHref } = props;
  const navigate = useNavigate();
  const add = useAddRow(props);
  return (
    <div className="text-sm">
      <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {rows.map((row) => (
          <li
            key={row.id}
            onClick={(e) => !(e.target as HTMLElement).closest("a") && navigate(rowHref(row))}
            aria-label={row.title || t("common.untitled")}
            className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-0.5 rounded px-2 py-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
          >
            <span className="min-w-0 flex-1 truncate font-medium">
              <RowTitle row={row} />
            </span>
            <span className="flex max-w-full flex-wrap items-center justify-end gap-x-3 text-neutral-500">
              <RowValues {...props} row={row} className="max-w-56 truncate" />
            </span>
          </li>
        ))}
      </ul>
      {!rows.length && <p className="px-2 py-3 text-neutral-400">{t("view.noRows")}</p>}
      {editable && (
        <button onClick={() => add()} className={`${newButton} mt-1`}>
          <Plus size={14} /> {t("board.new")}
        </button>
      )}
    </div>
  );
}

/** Cards in a grid, topped by the row's cover or first image. */
export function GalleryView(props: MoreViewProps) {
  const { rows, editable, rowHref, view, fileUrl } = props;
  const navigate = useNavigate();
  const add = useAddRow(props);
  const preview = view.config.showPreview !== false;
  // Files of a public page go through its link.
  const coverUrl = (cover: string) => {
    const m = /^\/api\/attachments\/(.+)$/.exec(cover);
    return m && fileUrl ? fileUrl(m[1]!) : cover;
  };
  return (
    <div className="grid grid-cols-1 gap-3 text-sm min-[420px]:grid-cols-2 md:grid-cols-3">
      {rows.map((row) => (
        <article
          key={row.id}
          onClick={(e) => !(e.target as HTMLElement).closest("a") && navigate(rowHref(row))}
          aria-label={row.title || t("common.untitled")}
          className="cursor-pointer overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:bg-neutral-700/70"
        >
          {preview && (
            <div className="h-32 w-full bg-neutral-100 dark:bg-neutral-900" data-preview>
              {row.cover ? (
                <CoverFill cover={coverUrl(row.cover)} position={row.coverPosition} />
              ) : (
                <div className="flex h-full items-center justify-center text-3xl text-neutral-300 dark:text-neutral-600">
                  {row.icon ?? <FileText size={28} />}
                </div>
              )}
            </div>
          )}
          <div className="p-2.5">
            <div className="truncate font-medium">
              <RowTitle row={row} />
            </div>
            <RowValues {...props} row={row} className="-mx-2" />
          </div>
        </article>
      ))}
      {editable && (
        <button
          onClick={() => add()}
          className="flex min-h-24 items-center justify-center gap-1 rounded-lg border border-dashed border-neutral-300 text-neutral-400 hover:bg-neutral-50 hover:text-neutral-700 dark:border-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          <Plus size={14} /> {t("board.new")}
        </button>
      )}
    </div>
  );
}

/** First day of the week in the user's language (1 = Monday, as getDay() counts, 0 = Sunday). */
function weekStart(): number {
  try {
    const locale = new Intl.Locale(intlLocale()) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
    const first = (locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay;
    return first ? first % 7 : 1;
  } catch {
    return 1;
  }
}

const dateOf = (day: string) => new Date(`${day}T00:00:00`);

/** Rows placed on the days of a month or a week, by a date column. Rows are dragged to another day to change their date. */
export function CalendarView(props: MoreViewProps) {
  const { data, actions, view, rows, editable, rowHref } = props;
  const navigate = useNavigate();
  const add = useAddRow(props);
  const prop = calendarDateProp(data.properties, view.config.dateProperty);
  const [localMode, setLocalMode] = useState<"month" | "week">("month");
  const mode = actions ? (view.config.calendarMode ?? "month") : localMode;
  const setMode = (m: "month" | "week") =>
    actions && editable ? actions.updateView.mutate({ viewId: view.id, config: { ...view.config, calendarMode: m } }) : setLocalMode(m);
  const today = localDay(new Date());
  const [anchor, setAnchor] = useState(today);
  const [over, setOver] = useState<string | null>(null);
  const movable = editable && prop?.type === "date";

  const byDay = useMemo(() => {
    const map = new Map<string, DatabaseRow[]>();
    if (prop) for (const row of rows) for (const day of rowDays(prop, row)) map.set(day, [...(map.get(day) ?? []), row]);
    return map;
  }, [prop, rows]);

  const days = useMemo(() => {
    const first = weekStart();
    const a = dateOf(anchor);
    const from = mode === "month" ? new Date(a.getFullYear(), a.getMonth(), 1) : a;
    from.setDate(from.getDate() - ((from.getDay() - first + 7) % 7));
    const count =
      mode === "week"
        ? 7
        : (() => {
            const last = new Date(a.getFullYear(), a.getMonth() + 1, 0);
            return Math.ceil((daysBetween(localDay(from), localDay(last)) + 1) / 7) * 7;
          })();
    return Array.from({ length: count }, (_, i) => localDay(new Date(from.getFullYear(), from.getMonth(), from.getDate() + i)));
  }, [anchor, mode]);

  if (!prop) {
    return <p className="rounded border border-dashed border-neutral-300 px-3 py-4 text-sm text-neutral-500 dark:border-neutral-700">{t("calendar.noDate")}</p>;
  }

  const move = (step: number) => {
    const a = dateOf(anchor);
    setAnchor(localDay(mode === "month" ? new Date(a.getFullYear(), a.getMonth() + step, 1) : new Date(a.getFullYear(), a.getMonth(), a.getDate() + 7 * step)));
  };
  const drop = (e: React.DragEvent, to: string) => {
    e.preventDefault();
    setOver(null);
    const [rowId, from] = e.dataTransfer.getData("application/x-nootion-row").split("|");
    const row = rows.find((r) => r.id === rowId);
    const value = row?.values[prop.id] as DateValue | null | undefined;
    if (!row || !value || !from || from === to || !actions) return;
    const delta = daysBetween(from, to);
    actions.updateCell.mutate({
      rowId: row.id,
      propId: prop.id,
      value: { start: shiftDate(value.start, delta), end: value.end ? shiftDate(value.end, delta) : (value.end ?? null) },
    });
  };

  const a = dateOf(anchor);
  const title =
    mode === "month"
      ? a.toLocaleDateString(intlLocale(), { month: "long", year: "numeric" })
      : `${dateOf(days[0]!).toLocaleDateString(intlLocale(), { day: "numeric", month: "short" })} – ${dateOf(days[6]!).toLocaleDateString(intlLocale(), { day: "numeric", month: "short", year: "numeric" })}`;
  const weekdays = days.slice(0, 7).map((d) => dateOf(d).toLocaleDateString(intlLocale(), { weekday: "short" }));
  const btn = "rounded p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800";
  const seg = (on: boolean) =>
    `px-2 py-0.5 ${on ? "bg-neutral-100 font-medium dark:bg-neutral-800" : "text-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-800/60"}`;

  return (
    <div className="text-sm">
      <div className="mb-2 flex flex-wrap items-center gap-1">
        <h3 className="mr-auto font-medium first-letter:uppercase" aria-live="polite">
          {title}
        </h3>
        <div className="flex overflow-hidden rounded border border-neutral-200 text-xs dark:border-neutral-700">
          <button className={seg(mode === "month")} onClick={() => setMode("month")}>
            {t("calendar.month")}
          </button>
          <button className={seg(mode === "week")} onClick={() => setMode("week")}>
            {t("calendar.week")}
          </button>
        </div>
        <button className={btn} onClick={() => move(-1)} aria-label={t("calendar.previous")}>
          <ChevronLeft size={16} />
        </button>
        <button
          className="rounded px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          onClick={() => setAnchor(today)}
        >
          {t("calendar.today")}
        </button>
        <button className={btn} onClick={() => move(1)} aria-label={t("calendar.next")}>
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="grid grid-cols-7 border-l border-t border-neutral-200 dark:border-neutral-800" role="grid" aria-label={title}>
        {weekdays.map((w) => (
          <div key={w} className="truncate border-b border-r border-neutral-200 px-1 py-1 text-center text-xs text-neutral-500 dark:border-neutral-800">
            {w}
          </div>
        ))}
        {days.map((day) => {
          const outside = mode === "month" && dateOf(day).getMonth() !== a.getMonth();
          return (
            <div
              key={day}
              role="gridcell"
              data-day={day}
              aria-label={dateOf(day).toLocaleDateString(intlLocale(), { dateStyle: "full" })}
              onDragOver={(e) => {
                if (!movable || !e.dataTransfer.types.includes("application/x-nootion-row")) return;
                e.preventDefault();
                setOver(day);
              }}
              onDragLeave={() => setOver((o) => (o === day ? null : o))}
              onDrop={(e) => drop(e, day)}
              className={`group relative flex min-w-0 flex-col gap-0.5 border-b border-r border-neutral-200 p-0.5 sm:p-1 dark:border-neutral-800 ${mode === "week" ? "min-h-48" : "min-h-20 sm:min-h-24"} ${over === day ? "bg-blue-50 dark:bg-blue-950/40" : outside ? "bg-neutral-50/70 dark:bg-neutral-900/50" : ""}`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs ${day === today ? "bg-red-500 font-semibold text-white" : outside ? "text-neutral-400" : "text-neutral-600 dark:text-neutral-300"}`}
                >
                  {dateOf(day).getDate()}
                </span>
                {editable && prop.type === "date" && (
                  <button
                    onClick={() => add({ [prop.id]: { start: day, end: null } })}
                    aria-label={t("calendar.addOn", { day: dateOf(day).toLocaleDateString(intlLocale(), { day: "numeric", month: "long" }) })}
                    className="rounded p-0.5 text-neutral-400 opacity-0 hover:bg-neutral-200 hover:text-neutral-700 group-hover:opacity-100 touch:opacity-100 dark:hover:bg-neutral-700"
                  >
                    <Plus size={12} />
                  </button>
                )}
              </div>
              {(byDay.get(day) ?? []).map((row) => (
                <div
                  key={row.id}
                  draggable={movable}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/x-nootion-row", `${row.id}|${day}`);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onClick={() => navigate(rowHref(row))}
                  title={row.title || t("common.untitled")}
                  data-row={row.id}
                  className="cursor-pointer truncate rounded border border-neutral-200 bg-white px-1 py-0.5 text-[11px] leading-tight shadow-sm hover:bg-neutral-50 sm:text-xs dark:border-neutral-700 dark:bg-neutral-800 dark:hover:bg-neutral-700"
                >
                  <RowTitle row={row} />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
