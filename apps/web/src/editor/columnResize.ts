import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { t } from "@nootion/shared";

/** Narrowest a column gets while resizing, in pixels: enough for a few words on a line. */
const MIN_WIDTH = 120;
/** Width of the strip, in the middle of the gap between two columns, that takes the pointer. */
const GRAB = 8;
/** Below this width the columns are one under the other (see index.css). */
const STACKED = 640;

/** The widths of columns as CSS grid columns, from the share each one keeps (equal shares for those that keep none). */
export function columnsTemplate(columns: ProseMirrorNode): string | null {
  const widths: (number | null)[] = [];
  columns.forEach((c) => widths.push(validWidth(c.attrs.width)));
  const known = widths.filter((w): w is number => w !== null);
  if (!known.length || widths.length < 2) return null;
  // A column added since the others were resized gets an equal share; the others share the rest as they did.
  const missing = widths.length - known.length;
  const knownSum = known.reduce((a, b) => a + b, 0);
  const rest = 1 - missing / widths.length;
  const shares = widths.map((w) => (w === null ? 1 / widths.length : (w / knownSum) * rest));
  return shares.map((w) => `minmax(0, ${+(w * shares.length).toFixed(4)}fr)`).join(" ");
}

export function validWidth(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? parseFloat(value) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : null;
}

/** The share of a row's width (0 to 1) of each column, from their widths in pixels, rounded and adding up to 1. */
export function columnShares(widths: number[]): number[] {
  const total = widths.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return widths.map(() => 1 / widths.length);
  const shares = widths.map((w) => Math.round((w / total) * 10_000) / 10_000);
  // The rounding goes to the last column, for the shares to add up to exactly 1.
  shares[shares.length - 1] = Math.round((1 - shares.slice(0, -1).reduce((a, b) => a + b, 0)) * 10_000) / 10_000;
  return shares;
}

/**
 * Two columns side by side are resized, as in Notion, with the bar that shows in the gap between them: dragging it
 * moves the width from one to the other, a double click gives every column of the row the same width again. The
 * widths are kept on the columns (`width`, a share of the row) and shared with everyone editing the page.
 */
export const ColumnResize = Extension.create({
  name: "columnResize",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("columnResize"),
        view(view) {
          const bar = document.createElement("div");
          bar.className = "nt-column-resize";
          bar.setAttribute("role", "separator");
          bar.setAttribute("aria-orientation", "vertical");
          bar.title = t("editor.resizeColumns");
          bar.hidden = true;
          document.body.appendChild(bar);

          /** The gap the bar is in: its row of columns and the column on its left. */
          let target: { row: HTMLElement; index: number } | null = null;
          let drag: { startX: number; widths: number[]; cols: HTMLElement[] } | null = null;
          let frame = 0;
          let pointer: { x: number; y: number } | null = null;

          const columnsOf = (row: HTMLElement) => [...row.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c.matches(".column"));

          const hide = () => {
            if (drag) return;
            bar.hidden = true;
            bar.classList.remove("is-active");
            target = null;
          };

          const place = (row: HTMLElement, index: number) => {
            const cols = columnsOf(row);
            const box = row.getBoundingClientRect();
            const left = cols[index]!.getBoundingClientRect().right;
            const right = cols[index + 1]!.getBoundingClientRect().left;
            bar.style.left = `${(left + right) / 2 - GRAB / 2}px`;
            bar.style.top = `${box.top}px`;
            bar.style.height = `${box.height}px`;
            bar.hidden = false;
            target = { row, index };
          };

          /** The gap under the pointer, in the innermost row of columns of this editor. */
          const gapAt = (x: number, y: number): { row: HTMLElement; index: number } | null => {
            if (!view.editable || window.innerWidth < STACKED) return null;
            let found: { row: HTMLElement; index: number; width: number } | null = null;
            for (const row of view.dom.querySelectorAll<HTMLElement>(".columns")) {
              const box = row.getBoundingClientRect();
              if (y < box.top || y > box.bottom || x < box.left || x > box.right || (found && box.width >= found.width)) continue;
              const cols = columnsOf(row);
              for (let i = 0; i < cols.length - 1; i++) {
                const middle = (cols[i]!.getBoundingClientRect().right + cols[i + 1]!.getBoundingClientRect().left) / 2;
                if (Math.abs(x - middle) <= GRAB / 2) found = { row, index: i, width: box.width };
              }
            }
            return found && { row: found.row, index: found.index };
          };

          const onMove = (e: MouseEvent) => {
            pointer = { x: e.clientX, y: e.clientY };
            if (drag || frame) return;
            frame = requestAnimationFrame(() => {
              frame = 0;
              if (view.isDestroyed || !pointer || drag) return;
              if (pointer && document.elementFromPoint(pointer.x, pointer.y) === bar) return;
              const gap = gapAt(pointer.x, pointer.y);
              if (gap) place(gap.row, gap.index);
              else hide();
            });
          };

          /** Where the row of columns is in the document, from its element. */
          const rowPos = (row: HTMLElement): number | null => {
            try {
              const pos = view.posAtDOM(row, 0) - 1;
              return view.state.doc.nodeAt(pos)?.type.name === "columns" && view.nodeDOM(pos) === row ? pos : null;
            } catch {
              return null;
            }
          };

          const save = (row: HTMLElement, shares: (number | null)[]) => {
            const pos = rowPos(row);
            if (pos === null) return;
            const node = view.state.doc.nodeAt(pos)!;
            if (node.childCount !== shares.length) return;
            const tr = view.state.tr;
            let at = pos + 1;
            node.forEach((col, _, i) => {
              if (col.attrs.width !== shares[i]) tr.setNodeAttribute(at, "width", shares[i]);
              at += col.nodeSize;
            });
            if (tr.docChanged) view.dispatch(tr);
          };

          const onDown = (e: PointerEvent) => {
            if (!target || e.button !== 0) return;
            e.preventDefault();
            const cols = columnsOf(target.row);
            drag = { startX: e.clientX, widths: cols.map((c) => c.getBoundingClientRect().width), cols };
            bar.setPointerCapture(e.pointerId);
            bar.classList.add("is-active");
            document.body.classList.add("nt-resizing-columns");
          };

          const widthsAt = (x: number): number[] => {
            const { startX, widths } = drag!;
            const i = target!.index;
            const pair = widths[i]! + widths[i + 1]!;
            // Narrow columns on a narrow page each keep at least a third of the two.
            const min = Math.min(MIN_WIDTH, pair / 3);
            const left = Math.min(pair - min, Math.max(min, widths[i]! + x - startX));
            const next = [...widths];
            next[i] = left;
            next[i + 1] = pair - left;
            return next;
          };

          const onDrag = (e: PointerEvent) => {
            if (!drag || !target) return;
            const widths = widthsAt(e.clientX);
            // Shown at once; the document gets the widths when the bar is let go.
            target.row.style.gridTemplateColumns = widths.map((w) => `minmax(0, ${w}fr)`).join(" ");
            place(target.row, target.index);
          };

          const onUp = (e: PointerEvent) => {
            if (!drag || !target) return;
            const widths = widthsAt(e.clientX);
            const moved = Math.abs(e.clientX - drag.startX) > 1;
            drag = null;
            bar.classList.remove("is-active");
            document.body.classList.remove("nt-resizing-columns");
            if (bar.hasPointerCapture(e.pointerId)) bar.releasePointerCapture(e.pointerId);
            if (moved) save(target.row, columnShares(widths));
            if (target.row.isConnected) place(target.row, target.index);
            else hide();
          };

          const onDouble = (e: MouseEvent) => {
            if (!target) return;
            e.preventDefault();
            save(
              target.row,
              columnsOf(target.row).map(() => null),
            );
            requestAnimationFrame(() => target?.row.isConnected && place(target.row, target.index));
          };

          const onScroll = () => hide();

          document.addEventListener("mousemove", onMove, { passive: true });
          document.addEventListener("scroll", onScroll, { capture: true, passive: true });
          window.addEventListener("resize", onScroll);
          bar.addEventListener("pointerdown", onDown);
          bar.addEventListener("pointermove", onDrag);
          bar.addEventListener("pointerup", onUp);
          bar.addEventListener("pointercancel", onUp);
          bar.addEventListener("dblclick", onDouble);
          bar.addEventListener("mouseleave", () => !drag && requestAnimationFrame(() => pointer && !gapAt(pointer.x, pointer.y) && hide()));

          return {
            update() {
              // The page changed under the bar (someone typed, a column went away).
              if (!drag && target) {
                if (!target.row.isConnected || columnsOf(target.row).length < target.index + 2) hide();
                else place(target.row, target.index);
              }
            },
            destroy() {
              cancelAnimationFrame(frame);
              document.removeEventListener("mousemove", onMove);
              document.removeEventListener("scroll", onScroll, { capture: true });
              window.removeEventListener("resize", onScroll);
              document.body.classList.remove("nt-resizing-columns");
              bar.remove();
            },
          };
        },
      }),
    ];
  },
});
