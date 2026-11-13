import { useEffect, useRef, useState } from "react";
import { t } from "@nootion/shared";

/**
 * Rows are shown a batch at a time: a database of thousands of rows only puts on the page what is close to the screen,
 * and the next batch comes as the reader scrolls down (or clicks "Show more").
 */
export const ROWS_BATCH = 100;

/** How many rows a view shows; back to one batch when `reset` changes (another view, other filters). */
export function useShownRows(reset: unknown, batch = ROWS_BATCH) {
  const [state, setState] = useState({ reset, limit: batch });
  // Adjusting state during render (not in an effect), so a changed view never paints with the old limit.
  let current = state;
  if (!Object.is(state.reset, reset)) {
    current = { reset, limit: batch };
    setState(current);
  }
  const more = () => setState((s) => ({ ...s, limit: s.limit + batch }));
  return { limit: current.limit, more };
}

/** Shows the first `limit` rows of groups, in order: later groups wait until earlier ones are shown in full. */
export function limitGroups<G extends { rows: unknown[] }>(
  groups: G[],
  limit: number,
  isOpen: (g: G) => boolean = () => true,
): { group: G; rows: G["rows"] }[] {
  const out: { group: G; rows: G["rows"] }[] = [];
  let left = limit;
  for (const g of groups) {
    if (!isOpen(g)) {
      out.push({ group: g, rows: [] });
      continue;
    }
    if (left <= 0) break;
    const rows = g.rows.length > left ? g.rows.slice(0, left) : g.rows;
    left -= rows.length;
    out.push({ group: g, rows });
  }
  return out;
}

/** Rows a list of groups holds (each open group counted once per row it shows). */
export const countGroupRows = <G extends { rows: unknown[] }>(groups: G[], isOpen: (g: G) => boolean = () => true) =>
  groups.reduce((n, g) => n + (isOpen(g) ? g.rows.length : 0), 0);

/**
 * Placed after the rows shown: loads the next batch when it comes near the screen, and is a button too
 * (keyboard, or a browser without IntersectionObserver).
 */
export function ShowMoreRows({ shown, total, onMore, className = "" }: { shown: number; total: number; onMore: () => void; className?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const left = total - shown;
  const onMoreRef = useRef(onMore);
  onMoreRef.current = onMore;
  useEffect(() => {
    const el = ref.current;
    if (!el || left <= 0 || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && onMoreRef.current(), { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
    // A new observer after each batch: it fires again if the button is still near the screen.
  }, [left, shown]);
  if (left <= 0) return null;
  return (
    <button
      ref={ref}
      type="button"
      onClick={onMore}
      data-show-more
      className={`flex items-center gap-1 rounded px-2 py-1.5 text-sm text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200 ${className}`}
    >
      {t("view.showMore", { count: left })}
    </button>
  );
}
