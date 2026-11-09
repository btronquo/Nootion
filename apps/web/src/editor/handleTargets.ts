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
              if (block) {
                const r = block.getBoundingClientRect();
                // Far enough from the edges for the handle not to prefer the block around it.
                Object.defineProperty(event, "clientX", { value: Math.max(event.clientX, r.left + 16), configurable: true });
                Object.defineProperty(event, "clientY", { value: r.top + Math.min(16, r.height / 2), configurable: true });
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
