import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { calendarDateProp, daysBetween, intlLocale, localDay, rowDays, shiftDate, t, type DatabaseRow, type DateValue } from "@nootion/shared";
import { RowTitle, type MoreViewProps } from "./MoreViews";

type Scale = "day" | "week" | "month";

/** Width of a day, and how many days the timeline shows at a time, by scale. */
const SCALES: Record<Scale, { px: number; span: number }> = {
  day: { px: 36, span: 42 },
  week: { px: 14, span: 140 },
  month: { px: 4, span: 400 },
};

const ROW_HEIGHT = 34;
const dateOf = (day: string) => new Date(`${day}T00:00:00`);
const addDays = (day: string, n: number) => shiftDate(day, n);

type Drag = { rowId: string; kind: "move" | "start" | "end"; x: number; delta: number; moved: boolean };

/**
 * Rows as bars from their start date to their end date. Bars are dragged to move them, and by their ends to
 * change the start or the end; a row without a date gets one by clicking on its line.
 */
export function TimelineView(props: MoreViewProps) {
  const { data, actions, view, rows, editable, rowHref } = props;
  const navigate = useNavigate();
  const prop = calendarDateProp(data.properties, view.config.dateProperty);
  const [localScale, setLocalScale] = useState<Scale>("week");
  const scale = actions ? (view.config.timelineScale ?? "week") : localScale;
  const setScale = (s: Scale) =>
    actions && editable ? actions.updateView.mutate({ viewId: view.id, config: { ...view.config, timelineScale: s } }) : setLocalScale(s);
  const { px, span } = SCALES[scale];
  const today = localDay(new Date());
  // First day shown: a little before today, then moved by the arrows.
  const [from, setFrom] = useState(() => addDays(today, -7));
  const [drag, setDrag] = useState<Drag | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const editableDates = editable && prop?.type === "date" && !!actions;

  const days = useMemo(() => Array.from({ length: span }, (_, i) => addDays(from, i)), [from, span]);
  const ticks = useMemo(() => {
    // Labels: every day (day scale), every Monday (weeks) or every first of the month.
    return days
      .map((day, i) => ({ day, i }))
      .filter(({ day }) => {
        const d = dateOf(day);
        return scale === "day" ? true : scale === "week" ? d.getDay() === 1 : d.getDate() === 1;
      });
  }, [days, scale]);

  // Today near the left of what is visible, on phones too.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const offset = daysBetween(from, today);
    if (offset >= 0 && offset < span) el.scrollLeft = Math.max(0, offset * px - el.clientWidth / 4);
  }, [from, px, span, today]);

  if (!prop) {
    return <p className="rounded border border-dashed border-neutral-300 px-3 py-4 text-sm text-neutral-500 dark:border-neutral-700">{t("calendar.noDate")}</p>;
  }

  const range = (row: DatabaseRow): [string, string] | null => {
    const covered = rowDays(prop, row);
    return covered.length ? [covered[0]!, covered[covered.length - 1]!] : null;
  };
  const width = span * px;
  const x = (day: string) => daysBetween(from, day) * px;

  const save = (row: DatabaseRow, d: Drag) => {
    const value = row.values[prop.id] as DateValue | null;
    if (!value || !d.delta) return;
    const end = value.end ?? value.start;
    let next: DateValue;
    if (d.kind === "move") next = { start: shiftDate(value.start, d.delta), end: value.end ? shiftDate(value.end, d.delta) : null };
    else if (d.kind === "end") {
      const newEnd = shiftDate(end, d.delta);
      next = { start: value.start, end: newEnd.slice(0, 10) <= value.start.slice(0, 10) ? null : newEnd };
    } else {
      const newStart = shiftDate(value.start, d.delta);
      if (newStart.slice(0, 10) > end.slice(0, 10)) return;
      next = { start: newStart, end: value.end && value.end.slice(0, 10) > newStart.slice(0, 10) ? value.end : null };
    }
    actions!.updateCell.mutate({ rowId: row.id, propId: prop.id, value: next });
  };

  const startDrag = (e: React.PointerEvent, row: DatabaseRow, kind: Drag["kind"]) => {
    if (!editableDates) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { rowId: row.id, kind, x: e.clientX, delta: 0, moved: false };
    setDrag(dragRef.current);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const delta = Math.round((e.clientX - d.x) / px);
    const moved = d.moved || Math.abs(e.clientX - d.x) > 4;
    if (delta !== d.delta || moved !== d.moved) setDrag((dragRef.current = { ...d, delta, moved }));
  };
  const onPointerUp = (row: DatabaseRow) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    if (d.moved) save(row, d);
    else if (d.kind === "move") navigate(rowHref(row));
  };

  /** Bar position while dragging. */
  const shown = (row: DatabaseRow, r: [string, string]): [string, string] => {
    if (drag?.rowId !== row.id || !drag.delta) return r;
    if (drag.kind === "move") return [addDays(r[0], drag.delta), addDays(r[1], drag.delta)];
    if (drag.kind === "end") return [r[0], addDays(r[1], drag.delta) < r[0] ? r[0] : addDays(r[1], drag.delta)];
    return [addDays(r[0], drag.delta) > r[1] ? r[1] : addDays(r[0], drag.delta), r[1]];
  };

  const label = (day: string) =>
    scale === "day"
      ? String(dateOf(day).getDate())
      : dateOf(day).toLocaleDateString(intlLocale(), scale === "week" ? { day: "numeric", month: "short" } : { month: "short", year: "2-digit" });
  const months = days.filter((d, i) => i === 0 || dateOf(d).getDate() === 1);
  const btn = "rounded p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800";
  const seg = (on: boolean) =>
    `px-2 py-0.5 ${on ? "bg-neutral-100 font-medium dark:bg-neutral-800" : "text-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-800/60"}`;
  const titleCol = "sticky left-0 z-10 w-28 shrink-0 truncate border-r border-neutral-200 bg-white px-2 sm:w-48 dark:border-neutral-800 dark:bg-neutral-900";

  return (
    <div className="text-sm">
      <div className="mb-2 flex flex-wrap items-center gap-1">
        <div className="mr-auto flex overflow-hidden rounded border border-neutral-200 text-xs dark:border-neutral-700">
          {(["day", "week", "month"] as const).map((s) => (
            <button key={s} className={seg(scale === s)} onClick={() => setScale(s)}>
              {t(`timeline.${s}`)}
            </button>
          ))}
        </div>
        <button className={btn} onClick={() => setFrom(addDays(from, -Math.round(span / 2)))} aria-label={t("calendar.previous")}>
          <ChevronLeft size={16} />
        </button>
        <button
          className="rounded px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          onClick={() => setFrom(addDays(today, -Math.round(span / 6)))}
        >
          {t("calendar.today")}
        </button>
        <button className={btn} onClick={() => setFrom(addDays(from, Math.round(span / 2)))} aria-label={t("calendar.next")}>
          <ChevronRight size={16} />
        </button>
      </div>
      <div ref={scroller} className="thin-scroll overflow-x-auto rounded border border-neutral-200 dark:border-neutral-800" data-timeline>
        <div className="w-max min-w-full">
          {/* Months, then days, weeks or months. */}
          <div className="flex border-b border-neutral-200 text-xs text-neutral-500 dark:border-neutral-800">
            <div className={`${titleCol} py-1`} />
            <div className="relative h-10" style={{ width }}>
              {scale !== "month" &&
                months.map((m) => (
                  <span key={m} className="absolute top-0.5 whitespace-nowrap pl-1 font-medium first-letter:uppercase" style={{ left: x(m) }}>
                    {dateOf(m).toLocaleDateString(intlLocale(), { month: "long", year: "numeric" })}
                  </span>
                ))}
              {ticks.map(({ day }) => (
                <span
                  key={day}
                  className={`absolute bottom-0.5 whitespace-nowrap border-l border-neutral-200 pl-1 dark:border-neutral-800 ${day === today ? "font-semibold text-red-500" : ""}`}
                  style={{ left: x(day) }}
                >
                  {label(day)}
                </span>
              ))}
            </div>
          </div>
          {rows.map((row) => {
            const r = range(row);
            const [start, end] = r ? shown(row, r) : ["", ""];
            const visible = r && end >= from && start <= days[days.length - 1]!;
            const barWidth = r ? Math.max(px, (daysBetween(start, end) + 1) * px) : 0;
            // Short bars show their title after them, and keep the whole bar to drag (no ends to resize).
            const wide = barWidth >= 72;
            const resizable = editableDates && barWidth >= 28;
            return (
              <div
                key={row.id}
                className="flex border-b border-neutral-100 last:border-b-0 dark:border-neutral-800/60"
                style={{ height: ROW_HEIGHT }}
                data-row={row.id}
              >
                <button onClick={() => navigate(rowHref(row))} className={`${titleCol} text-left hover:underline`} title={row.title || t("common.untitled")}>
                  <RowTitle row={row} />
                </button>
                <div
                  className={`relative ${!r && editableDates ? "cursor-copy" : ""}`}
                  style={{ width }}
                  onClick={(e) => {
                    // A row without a date gets the clicked day.
                    if (r || !editableDates) return;
                    const day = addDays(from, Math.floor((e.clientX - e.currentTarget.getBoundingClientRect().left) / px));
                    actions!.updateCell.mutate({ rowId: row.id, propId: prop.id, value: { start: day, end: null } });
                  }}
                  title={!r && editableDates ? t("timeline.setDate") : undefined}
                >
                  {today >= from && today <= days[days.length - 1]! && (
                    <div className="pointer-events-none absolute inset-y-0 w-px bg-red-400/70" style={{ left: x(today) + px / 2 }} />
                  )}
                  {visible && !wide && (
                    // Short bars: the title follows the bar.
                    <span
                      className="pointer-events-none absolute top-1/2 -translate-y-1/2 truncate pl-1.5 text-xs text-neutral-600 dark:text-neutral-300"
                      style={{ left: x(start) + barWidth, maxWidth: 220 }}
                    >
                      {row.title || t("common.untitled")}
                    </span>
                  )}
                  {visible && (
                    <div
                      role="button"
                      aria-label={row.title || t("common.untitled")}
                      data-bar={row.id}
                      onPointerDown={(e) => startDrag(e, row, "move")}
                      onPointerMove={onPointerMove}
                      onPointerUp={() => onPointerUp(row)}
                      onClick={(e) => !editableDates && (e.stopPropagation(), navigate(rowHref(row)))}
                      className={`group absolute top-1 flex items-center overflow-hidden rounded-md border border-blue-300 bg-blue-100 px-1.5 text-xs text-blue-900 shadow-sm select-none dark:border-blue-700 dark:bg-blue-900/60 dark:text-blue-100 ${editableDates ? "cursor-grab touch-none active:cursor-grabbing" : "cursor-pointer"} ${drag?.rowId === row.id ? "ring-2 ring-blue-400" : ""}`}
                      style={{ left: x(start), width: barWidth, height: ROW_HEIGHT - 8 }}
                    >
                      {resizable && (
                        <span
                          data-edge="start"
                          onPointerDown={(e) => startDrag(e, row, "start")}
                          onPointerMove={onPointerMove}
                          onPointerUp={() => onPointerUp(row)}
                          className="absolute inset-y-0 left-0 w-2 cursor-ew-resize hover:bg-blue-300/60"
                        />
                      )}
                      {wide && <span className="truncate">{row.title || t("common.untitled")}</span>}
                      {resizable && (
                        <span
                          data-edge="end"
                          onPointerDown={(e) => startDrag(e, row, "end")}
                          onPointerMove={onPointerMove}
                          onPointerUp={() => onPointerUp(row)}
                          className="absolute inset-y-0 right-0 w-2 cursor-ew-resize hover:bg-blue-300/60"
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {!rows.length && <p className="px-2 py-3 text-neutral-400">{t("view.noRows")}</p>}
        </div>
      </div>
    </div>
  );
}
