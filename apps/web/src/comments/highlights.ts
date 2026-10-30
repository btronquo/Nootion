import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, ySyncPluginKey } from "@tiptap/y-tiptap";
import * as Y from "yjs";
import type { CommentThread } from "@nootion/shared";

/**
 * Comment anchors are Yjs relative positions: they follow the text as everyone edits it, and they don't change the
 * document, so people who may only comment can anchor a comment too.
 */
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

function binding(state: EditorState) {
  const ys = ySyncPluginKey.getState(state) as { doc: Y.Doc; type: Y.XmlFragment; binding?: { mapping: Map<unknown, unknown> } } | undefined;
  return ys?.binding ? { doc: ys.doc, type: ys.type, mapping: ys.binding.mapping } : null;
}

/** The selected passage, as an anchor and its text. Null when nothing is selected. */
export function selectionAnchor(editor: Editor): { anchor: { start: string; end: string }; quote: string } | null {
  const { from, to } = editor.state.selection;
  const b = binding(editor.state);
  if (from === to || !b) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rel = (pos: number) => absolutePositionToRelativePosition(pos, b.type, b.mapping as any);
  const encode = (rp: Y.RelativePosition) => toBase64(Y.encodeRelativePosition(rp));
  // Positions stick to the character before them: right for the end, so text typed after the passage stays out of it.
  // The start sticks to the passage's first character instead, so text typed before it stays out too.
  const $from = editor.state.doc.resolve(from);
  let start = rel(from);
  if ($from.parent.isTextblock && $from.parentOffset < $from.parent.content.size) {
    const first = rel(from + 1);
    if (first.item) start = new Y.RelativePosition(first.type, first.tname, first.item, 0);
  }
  return { anchor: { start: encode(start), end: encode(rel(to)) }, quote: editor.state.doc.textBetween(from, to, " ").slice(0, 1000) };
}

/** Where an anchor is in the document now; null when its text was deleted. */
function resolve(state: EditorState, anchor: { start: string; end: string }) {
  const b = binding(state);
  if (!b) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const abs = (text: string) => relativePositionToAbsolutePosition(b.doc, b.type, Y.decodeRelativePosition(fromBase64(text)), b.mapping as any);
    const from = abs(anchor.start);
    const to = abs(anchor.end);
    return from !== null && to !== null && to > from ? { from, to } : null;
  } catch {
    return null;
  }
}

interface HighlightState {
  threads: Pick<CommentThread, "id" | "anchor" | "resolvedAt">[];
  active: string | null;
}

const key = new PluginKey<HighlightState>("commentHighlights");

/** Tells the editor which threads to highlight, and which one is open. */
export function setCommentHighlights(editor: Editor, value: HighlightState) {
  if (editor.isDestroyed) return;
  editor.view.dispatch(editor.state.tr.setMeta(key, value));
}

/** Where a thread's passage starts, to scroll to it. */
export function threadPosition(editor: Editor, thread: CommentThread): number | null {
  return thread.anchor ? (resolve(editor.state, thread.anchor)?.from ?? null) : null;
}

/** Highlights the passages of open threads; a click on one opens its thread. */
export const CommentHighlights = Extension.create<{ onOpen: (threadId: string) => void }>({
  name: "commentHighlights",
  addOptions() {
    return { onOpen: () => {} };
  },
  addProseMirrorPlugins() {
    const onOpen = () => this.options.onOpen;
    return [
      new Plugin<HighlightState>({
        key,
        state: {
          init: () => ({ threads: [], active: null }),
          apply: (tr, value) => tr.getMeta(key) ?? value,
        },
        props: {
          decorations(state) {
            const { threads, active } = key.getState(state)!;
            const decorations: Decoration[] = [];
            for (const th of threads) {
              if (!th.anchor || th.resolvedAt) continue;
              const range = resolve(state, th.anchor);
              if (!range) continue;
              decorations.push(
                Decoration.inline(range.from, range.to, {
                  class: `comment-highlight${th.id === active ? " comment-highlight-active" : ""}`,
                  "data-comment-thread": th.id,
                }),
              );
            }
            return DecorationSet.create(state.doc, decorations);
          },
          handleClick(view, _pos, event) {
            const el = (event.target as HTMLElement).closest<HTMLElement>("[data-comment-thread]");
            if (!el) return false;
            onOpen()(el.dataset.commentThread!);
            return false;
          },
        },
      }),
    ];
  },
});
