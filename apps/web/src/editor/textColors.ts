import { Mark, mergeAttributes, type Editor } from "@tiptap/core";
import { OPTION_COLORS, type OptionColor } from "@nootion/shared";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    textColors: {
      /** Colors the selected text, or takes its color off (null). */
      setTextColor: (color: OptionColor | null) => ReturnType;
      /** Highlights the selected text with a background color, or takes the highlight off (null). */
      setHighlight: (color: OptionColor | null) => ReturnType;
    };
  }
}

const isColor = (c: unknown): c is OptionColor => typeof c === "string" && (OPTION_COLORS as readonly string[]).includes(c);

/**
 * The color of a piece of text: one of the colors blocks already take, never a free CSS value.
 * Shown as `<span data-color="red">`, which the blocks' color styles already cover.
 */
export const TextColor = Mark.create({
  name: "textColor",
  // Not carried on when typing at the end of the colored text: as in Notion, the color stays where it was put.
  inclusive: false,
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el) => {
          const c = el.getAttribute("data-color");
          return isColor(c) ? c : null;
        },
        renderHTML: (attrs) => (isColor(attrs.color) ? { "data-color": attrs.color } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-color]", getAttrs: (el) => (isColor(el.getAttribute("data-color")) ? null : false) }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "nt-text-color" }), 0];
  },
  addCommands() {
    return {
      setTextColor:
        (color) =>
        ({ commands }) =>
          isColor(color) ? commands.setMark(this.name, { color }) : commands.unsetMark(this.name, { extendEmptyMarkRange: true }),
    };
  },
});

/**
 * A highlight behind a piece of text, in one of the blocks' background colors.
 * Shown as `<mark data-color="yellow-bg">`; Ctrl+Shift+H highlights in yellow, or takes the highlight off.
 */
export const Highlight = Mark.create({
  name: "highlight",
  inclusive: false,
  addAttributes() {
    return {
      color: {
        default: "yellow",
        parseHTML: (el) => {
          const c = el.getAttribute("data-color")?.replace(/-bg$/, "");
          return isColor(c) ? c : "yellow";
        },
        renderHTML: (attrs) => ({ "data-color": `${isColor(attrs.color) ? attrs.color : "yellow"}-bg` }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "mark" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["mark", mergeAttributes(HTMLAttributes, { class: "nt-highlight" }), 0];
  },
  addCommands() {
    return {
      setHighlight:
        (color) =>
        ({ commands }) =>
          isColor(color) ? commands.setMark(this.name, { color }) : commands.unsetMark(this.name, { extendEmptyMarkRange: true }),
    };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-h": () => this.editor.commands.toggleMark(this.name, { color: "yellow" }),
    };
  },
});

/** The text color and the highlight of the selection, when the whole selection has the same. */
export function selectionColors(editor: Editor): { text: OptionColor | null; highlight: OptionColor | null } {
  const text = editor.isActive("textColor") ? editor.getAttributes("textColor").color : null;
  const highlight = editor.isActive("highlight") ? editor.getAttributes("highlight").color : null;
  return { text: isColor(text) ? text : null, highlight: isColor(highlight) ? highlight : null };
}
