import { InputRule, Node, mergeAttributes, type Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { MATH_EDIT_EVENT, MathView } from "./MathView";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mathInline: { insertMathInline: (latex?: string) => ReturnType };
    mathBlock: { insertMathBlock: (latex?: string) => ReturnType };
  }
}

/**
 * "$x^2$" typed in a line: the closing "$" turns it into an equation. Like Pandoc, the LaTeX may not start or end with
 * a space, and a "$" after a letter, a digit or a backslash doesn't open one: "it costs $5 and $10" stays text.
 */
export const INLINE_MATH_INPUT = /(?:^|[^\\$\w])(\$([^\s$](?:[^$\n]*?[^\s$\\])?)\$)$/;

/** Opens the editor of the equation at `pos`, once its view is drawn. */
export function openMathEditor(editor: Editor, pos: number) {
  requestAnimationFrame(() => {
    if (editor.isDestroyed) return;
    const dom = editor.view.nodeDOM(pos);
    document.dispatchEvent(new CustomEvent(MATH_EDIT_EVENT, { detail: { dom } }));
  });
}

/** Enter on a selected equation opens its editor. */
function editSelected(editor: Editor, type: string): boolean {
  const { selection } = editor.state;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== type) return false;
  openMathEditor(editor, selection.from);
  return true;
}

const latexAttr = {
  latex: {
    default: "",
    parseHTML: (el: HTMLElement) => el.getAttribute("data-latex") ?? "",
    renderHTML: (attrs: Record<string, unknown>) => ({ "data-latex": String(attrs.latex ?? "") }),
  },
};

/** An equation in a line of text, written in LaTeX ("$…$" in Markdown). */
export const MathInline = Node.create({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return latexAttr;
  },
  parseHTML() {
    return [{ tag: "span[data-math-inline]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-math-inline": "", class: "math-inline" }), `$${String(node.attrs.latex)}$`];
  },
  renderText({ node }) {
    return `$${String(node.attrs.latex)}$`;
  },
  addNodeView() {
    return ReactNodeViewRenderer(MathView, { as: "span" });
  },
  addCommands() {
    return {
      insertMathInline:
        (latex = "") =>
        ({ editor, chain, tr, dispatch }) => {
          const at = tr.selection.from;
          if (!chain().insertContent({ type: this.name, attrs: { latex } }).run()) return false;
          if (dispatch && !latex && tr.doc.nodeAt(at)?.type.name === this.name) {
            tr.setSelection(NodeSelection.create(tr.doc, at));
            openMathEditor(editor, at);
          }
          return true;
        },
    };
  },
  addKeyboardShortcuts() {
    return { Enter: ({ editor }) => editSelected(editor, this.name) };
  },
  addInputRules() {
    return [
      new InputRule({
        find: INLINE_MATH_INPUT,
        handler: ({ state, range, match }) => {
          const latex = match[2]!;
          const start = range.from + match[0].length - match[1]!.length;
          state.tr.replaceWith(start, range.to, this.type.create({ latex }));
        },
      }),
    ];
  },
});

/** An equation on its own, centred ("$$…$$" in Markdown). */
export const MathBlock = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return latexAttr;
  },
  parseHTML() {
    return [{ tag: "div[data-math-block]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-math-block": "", class: "math-block" }), `$$${String(node.attrs.latex)}$$`];
  },
  renderText({ node }) {
    return `$$${String(node.attrs.latex)}$$`;
  },
  addNodeView() {
    return ReactNodeViewRenderer(MathView);
  },
  addCommands() {
    return {
      insertMathBlock:
        (latex = "") =>
        ({ editor, chain, tr, dispatch }) => {
          if (!chain().insertContent({ type: this.name, attrs: { latex } }).run()) return false;
          if (!dispatch || latex) return true;
          // The new block sits just before the cursor (an empty line replaced, or a paragraph after it).
          const near = tr.selection.from;
          let at: number | null = null;
          tr.doc.nodesBetween(Math.max(0, near - 3), Math.min(tr.doc.content.size, near + 1), (n, pos) => {
            if (n.type.name === this.name && !n.attrs.latex) at = pos;
          });
          if (at !== null) {
            tr.setSelection(NodeSelection.create(tr.doc, at));
            openMathEditor(editor, at);
          }
          return true;
        },
    };
  },
  addKeyboardShortcuts() {
    return { Enter: ({ editor }) => editSelected(editor, this.name) };
  },
  addInputRules() {
    return [
      // "$$ " at the start of an empty line: a new block equation, its editor open.
      new InputRule({
        find: /^\$\$\s$/,
        handler: ({ range, chain }) => {
          chain().deleteRange(range).insertMathBlock().run();
        },
      }),
    ];
  },
});
