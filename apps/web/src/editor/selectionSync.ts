import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/**
 * The editor learns where the caret is from the browser's "selectionchange" event, which the browser sends a little
 * after the click, and sometimes not at all: after a cut, a click elsewhere then Enter (or Ctrl+V) acted where the cut
 * had been, as if the click hadn't happened.
 *
 * Before a key, a paste, a cut or a copy is handled, and once a click is over, the caret the browser shows is taken
 * when the editor still has another one. Only for a caret or selected text: a picked block or several selected blocks
 * are not what the browser shows, and stay as they are.
 */
export function syncSelectionFromDOM(view: EditorView): boolean {
  if (view.composing || !view.hasFocus() || !(view.state.selection instanceof TextSelection)) return false;
  const dom = (view.root as Document).getSelection?.() ?? document.getSelection();
  if (!dom?.anchorNode || !dom.focusNode || !view.dom.contains(dom.anchorNode) || !view.dom.contains(dom.focusNode)) return false;
  // In a block's own controls (a field, a menu of a code block…), not in the text.
  const inControls = (node: Node) => {
    const el = node instanceof Element ? node : node.parentElement;
    const locked = el?.closest('[contenteditable="false"]');
    return !!locked && view.dom.contains(locked);
  };
  if (inControls(dom.anchorNode) || inControls(dom.focusNode)) return false;
  let anchor: number;
  let head: number;
  try {
    anchor = view.posAtDOM(dom.anchorNode, dom.anchorOffset);
    head = view.posAtDOM(dom.focusNode, dom.focusOffset);
  } catch {
    return false;
  }
  const { state } = view;
  if (anchor < 0 || head < 0 || anchor > state.doc.content.size || head > state.doc.content.size) return false;
  const next = TextSelection.between(state.doc.resolve(anchor), state.doc.resolve(head));
  if (next.eq(state.selection)) return false;
  view.dispatch(state.tr.setSelection(next).setMeta("addToHistory", false));
  return true;
}

export const SelectionSync = Extension.create({
  name: "selectionSync",
  // Before every other key handler, which then sees the right caret.
  priority: 10000,
  addProseMirrorPlugins() {
    const sync = (view: EditorView) => {
      syncSelectionFromDOM(view);
      return false;
    };
    return [
      new Plugin({
        key: new PluginKey("selectionSync"),
        props: {
          handleDOMEvents: {
            keydown: sync,
            beforeinput: sync,
            paste: sync,
            cut: sync,
            copy: sync,
            // Once the browser has placed the caret.
            mouseup: (view) => {
              window.setTimeout(() => !view.isDestroyed && syncSelectionFromDOM(view), 0);
              return false;
            },
          },
        },
      }),
    ];
  },
});
