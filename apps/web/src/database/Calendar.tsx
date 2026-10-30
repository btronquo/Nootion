import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import {
  calendarDateProp,
  daysBetween,
  intlLocale,
  localDay,
  rowDays,
  shiftDate,
  t,
  type DatabaseRow,
  type DateValue,
  type OptionColor,
} from "@nootion/shared";
import { RowTitle, useAddRow, type MoreViewProps } from "./MoreViews";
import { OPTION_CLASSES } from "./format";

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

export type CalendarMode = "month" | "week";

/** A row shown on a calendar day. */
export interface CalendarEntry {
  /** Unique on the calendar (a calendar block shows rows of several databases). */
  key: string;
  row: DatabaseRow;
  href: string;
  /** Whether it can be dragged to another day. */
  movable: boolean;
  color?: OptionColor;
  /** Shown on hover, after the title (the database it comes from). */
  hint?: string;
}

const DRAG = "application/x-nootion-row";

/** Days of the month or week around a day, from the first day of its first week. */
function useDays(anchor: string, mode: CalendarMode) {
  return useMemo(() => {
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
}

/**
 * Month or week grid of rows placed on their days. Rows are dragged to another day to change their date;
 * `onAdd` adds a "+" on each day.
 */
export function CalendarGrid({
  mode,
  onMode,
  entries,
  onMove,
  onAdd,
  tools,
}: {
  mode: CalendarMode;
  onMode: (mode: CalendarMode) => void;
  /** Entries of each day (YYYY-MM-DD). */
  entries: Map<string, CalendarEntry[]>;
  onMove?: (entry: CalendarEntry, from: string, to: string) => void;
  onAdd?: (day: string, button: HTMLElement) => void;
  /** Extra buttons, at the start of the toolbar. */
  tools?: ReactNode;
}) {
  const navigate = useNavigate();
  const today = localDay(new Date());
  const [anchor, setAnchor] = useState(today);
  const [over, setOver] = useState<string | null>(null);
  const days = useDays(anchor, mode);
  const keys = useMemo(() => new Map([...entries.values()].flat().map((e) => [e.key, e])), [entries]);

  const move = (step: number) => {
    const a = dateOf(anchor);
    setAnchor(localDay(mode === "month" ? new Date(a.getFullYear(), a.getMonth() + step, 1) : new Date(a.getFullYear(), a.getMonth(), a.getDate() + 7 * step)));
  };
  const drop = (e: React.DragEvent, to: string) => {
    e.preventDefault();
    setOver(null);
    const [key, from] = e.dataTransfer.getData(DRAG).split("|");
    const entry = keys.get(key ?? "");
    if (entry && from && from !== to) onMove?.(entry, from, to);
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
        {tools}
        <div className="flex overflow-hidden rounded border border-neutral-200 text-xs dark:border-neutral-700">
          <button className={seg(mode === "month")} onClick={() => onMode("month")}>
            {t("calendar.month")}
          </button>
          <button className={seg(mode === "week")} onClick={() => onMode("week")}>
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
                if (!onMove || !e.dataTransfer.types.includes(DRAG)) return;
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
                {onAdd && (
                  <button
                    onClick={(e) => onAdd(day, e.currentTarget)}
                    aria-label={t("calendar.addOn", { day: dateOf(day).toLocaleDateString(intlLocale(), { day: "numeric", month: "long" }) })}
                    className="rounded p-0.5 text-neutral-400 opacity-0 hover:bg-neutral-200 hover:text-neutral-700 group-hover:opacity-100 touch:opacity-100 dark:hover:bg-neutral-700"
                  >
                    <Plus size={12} />
                  </button>
                )}
              </div>
              {(entries.get(day) ?? []).map((entry) => (
                <div
                  key={entry.key}
                  draggable={entry.movable}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DRAG, `${entry.key}|${day}`);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onClick={() => navigate(entry.href)}
                  title={[entry.row.title || t("common.untitled"), entry.hint].filter(Boolean).join(" · ")}
                  data-row={entry.row.id}
                  className={`cursor-pointer truncate rounded px-1 py-0.5 text-[11px] leading-tight shadow-sm hover:brightness-95 sm:text-xs ${
                    entry.color
                      ? OPTION_CLASSES[entry.color]
                      : "border border-neutral-200 bg-white hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:bg-neutral-700"
                  }`}
                >
                  <RowTitle row={entry.row} />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Rows of a date column placed on the days of a month or a week. */
export function CalendarView(props: MoreViewProps) {
  const { data, actions, view, rows, editable, rowHref } = props;
  const add = useAddRow(props);
  const prop = calendarDateProp(data.properties, view.config.dateProperty);
  const [localMode, setLocalMode] = useState<CalendarMode>("month");
  const mode = actions ? (view.config.calendarMode ?? "month") : localMode;
  const setMode = (m: CalendarMode) =>
    actions && editable ? actions.updateView.mutate({ viewId: view.id, config: { ...view.config, calendarMode: m } }) : setLocalMode(m);
  const movable = editable && prop?.type === "date";

  const entries = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    if (prop)
      for (const row of rows) {
        const entry = { key: row.id, row, href: rowHref(row), movable };
        for (const day of rowDays(prop, row)) map.set(day, [...(map.get(day) ?? []), entry]);
      }
    return map;
  }, [prop, rows, rowHref, movable]);

  if (!prop) {
    return <p className="rounded border border-dashed border-neutral-300 px-3 py-4 text-sm text-neutral-500 dark:border-neutral-700">{t("calendar.noDate")}</p>;
  }

  return (
    <CalendarGrid
      mode={mode}
      onMode={setMode}
      entries={entries}
      onMove={
        movable && actions
          ? ({ row }, from, to) => {
              const value = row.values[prop.id] as DateValue | null | undefined;
              if (value) actions.updateCell.mutate({ rowId: row.id, propId: prop.id, value: moveDate(value, daysBetween(from, to)) });
            }
          : undefined
      }
      onAdd={movable ? (day) => add({ [prop.id]: { start: day, end: null } }) : undefined}
    />
  );
}

/** A date or date range moved by some days. */
export const moveDate = (value: DateValue, days: number): DateValue => ({
  start: shiftDate(value.start, days),
  end: value.end ? shiftDate(value.end, days) : (value.end ?? null),
});
