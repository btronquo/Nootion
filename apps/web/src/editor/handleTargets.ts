import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/**
 * The block handle finds the block under the pointer with ProseMirror's posAtCoords, which misses a block drawn by
 * its own view (drawing, widget, database…) inside a list item: below the block's middle it gives the position after
 * it, and from the margin, where the handle sits, the list item wins. So the handle jumped to the to-do around it.
 *
 * When the pointer is over such a block, or in the margin on its left, the handle is told the pointer is near the
 * block's top-left corner, where it finds the block.
 *
 * The same goes for text in a column: near its top or left edge, and in the gap between the columns where its
 * handle sits, the handle used to jump to the whole columns block.
 *
 * And for a block in a callout: left of its text, over the callout's emoji and in the margin where its handle sits,
 * the handle went to the whole callout.
 *
 * It also places the handle again when the page scrolls.
 */
export const HandleTargets = Extension.create({
  name: "handleTargets",
  // Before the block handle's own plugin.
  priority: 1000,
  addProseMirrorPlugins() {
    /** Where the pointer last was over the page. */
    let pointer: { x: number; y: number } | null = null;
    return [
      new Plugin({
        key: new PluginKey("handleTargets"),
        view(view) {
          // The handle is placed when the pointer moves, and doesn't follow the page when it scrolls: it stayed where
          // it was, beside another block. On scroll it is hidden, then placed again by the block under the pointer.
          let frame = 0;
          let dragging = false;
          const onScroll = () => {
            if (dragging || frame || !pointer || !view.editable) return;
            frame = requestAnimationFrame(() => {
              frame = 0;
              if (view.isDestroyed || !pointer) return;
              view.dispatch(view.state.tr.setMeta("hideDragHandle", true).setMeta("addToHistory", false));
              const r = view.dom.getBoundingClientRect();
              if (pointer.y >= r.top && pointer.y <= r.bottom)
                view.dom.dispatchEvent(new MouseEvent("mousemove", { clientX: pointer.x, clientY: pointer.y, bubbles: true }));
            });
          };
          const onDrag = (e: DragEvent) => (dragging = e.type === "dragstart");
          const onLeave = () => (pointer = null);
          document.addEventListener("scroll", onScroll, { capture: true, passive: true });
          document.addEventListener("dragstart", onDrag, true);
          document.addEventListener("dragend", onDrag, true);
          view.dom.addEventListener("mouseleave", onLeave);
          return {
            destroy() {
              cancelAnimationFrame(frame);
              document.removeEventListener("scroll", onScroll, { capture: true });
              document.removeEventListener("dragstart", onDrag, true);
              document.removeEventListener("dragend", onDrag, true);
              view.dom.removeEventListener("mouseleave", onLeave);
            },
          };
        },
        props: {
          handleDOMEvents: {
            mousemove(view, event) {
              if (event.isTrusted) pointer = { x: event.clientX, y: event.clientY };
              const block = atomBlockBeside(view, event.clientX, event.clientY);
              const r =
                block?.getBoundingClientRect() ??
                columnTextBeside(view, event.clientX, event.clientY) ??
                calloutBlockBeside(view, event.clientX, event.clientY);
              if (r) {
                // Far enough from the edges for the handle not to prefer the block around it.
                Object.defineProperty(event, "clientX", { value: Math.max(event.clientX, r.left + 16), configurable: true });
                Object.defineProperty(event, "clientY", {
                  value: block ? r.top + Math.min(16, r.height / 2) : Math.max(event.clientY, r.top + Math.min(14, r.height / 2)),
                  configurable: true,
                });
                // Only for the handle, which reads them in this same dispatch: once ProseMirror is done, the event
                // gets its real position back for the listeners further up (a map being dragged in a widget follows
                // document mousemoves, and froze or jumped when it got the corner of its block instead).
                queueMicrotask(() => {
                  delete (event as { clientX?: number }).clientX;
                  delete (event as { clientY?: number }).clientY;
                });
              }
              return false;
            },
          },
        },
      }),
    ];
  },
});

/** The innermost block with its own view whose row the pointer is on (over it, or on its left). */
function atomBlockBeside(view: EditorView, x: number, y: number): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestWidth = Infinity;
  for (const el of view.dom.querySelectorAll<HTMLElement>("div.react-renderer")) {
    const r = el.getBoundingClientRect();
    if (y < r.top || y > r.bottom || x > r.right || r.width >= bestWidth) continue;
    let pos: number;
    try {
      pos = view.posAtDOM(el, 0);
    } catch {
      continue;
    }
    const node = view.state.doc.nodeAt(pos);
    if (!node?.isBlock || !node.isAtom || view.nodeDOM(pos) !== el) continue;
    best = el;
    bestWidth = r.width;
  }
  return best;
}

/**
 * The text block in a column that the pointer is on: over it, or up to the width of the handle on its left (the gap
 * between columns). Near its top or its left edge, the handle would otherwise pick the whole columns block.
 */
function columnTextBeside(view: EditorView, x: number, y: number): DOMRect | null {
  for (let d = 0; d <= 64; d += 8) {
    const found = view.posAtCoords({ left: x + d, top: y });
    if (!found) continue;
    const $pos = view.state.doc.resolve(found.pos);
    if (!$pos.parent.isTextblock || $pos.depth < 2) continue;
    let inColumn = false;
    for (let depth = $pos.depth - 1; depth > 0; depth--) if ($pos.node(depth).type.name === "column") inColumn = true;
    if (!inColumn) return null;
    const dom = view.nodeDOM($pos.before());
    if (!(dom instanceof HTMLElement)) return null;
    const r = dom.getBoundingClientRect();
    if (y < r.top || y > r.bottom || x + d < r.left) return null;
    // A line further left (in the column before): look further right.
    if (x > r.right) continue;
    return r;
  }
  return null;
}

/** How far left of a block its handle reaches (the "+" and the dots). */
const HANDLE_WIDTH = 56;

/**
 * The block of a callout whose row the pointer is on, at the left of its text: over the emoji, in the margin where the
 * block's handle sits, or at the very start of the text.
 */
function calloutBlockBeside(view: EditorView, x: number, y: number): DOMRect | null {
  let best: DOMRect | null = null;
  let bestWidth = Infinity;
  for (const callout of view.dom.querySelectorAll<HTMLElement>(".callout")) {
    const box = callout.getBoundingClientRect();
    if (y < box.top || y > box.bottom || box.width >= bestWidth) continue;
    const textLeft = box.left + parseFloat(getComputedStyle(callout).paddingLeft);
    // A little into the text too: at its very edge, the handle also picked the callout.
    if (x < box.left - HANDLE_WIDTH || x >= textLeft + 16) continue;
    for (const child of callout.children) {
      const r = child.getBoundingClientRect();
      if (y < r.top || y > r.bottom) continue;
      best = r;
      bestWidth = box.width;
      break;
    }
  }
  return best;
}
