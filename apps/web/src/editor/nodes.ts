import { mergeAttributes, Node, type Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { Details } from "@tiptap/extension-details";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { PageLinkView } from "./PageLinkView";
import { DatabaseBlockView } from "../database/DatabaseBlockView";
import { intlLocale, t } from "@nootion/shared";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: { setCallout: () => ReturnType };
    fileAttachment: { insertFile: (attrs: { url: string; name: string; size: number; mimeType: string }) => ReturnType };
    pageLink: { insertPageLink: (attrs: { pageId: string; title: string }) => ReturnType };
    databaseBlock: { insertDatabase: (pageId: string) => ReturnType };
    toggle: { insertToggle: (level?: 1 | 2 | 3) => ReturnType };
    columns: { insertColumns: (count: number) => ReturnType };
  }
}

/** Highlighted block with an emoji, like Notion's callout. */
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "paragraph+",
  defining: true,
  addAttributes() {
    return { emoji: { default: "💡" } };
  },
  parseHTML() {
    return [{ tag: "div[data-callout]", getAttrs: (el) => ({ emoji: (el as HTMLElement).dataset.emoji || "💡" }) }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-callout": "", "data-emoji": node.attrs.emoji, class: "callout" }), 0];
  },
  addCommands() {
    return {
      setCallout:
        () =>
        ({ commands }) =>
          commands.wrapIn(this.name),
    };
  },
});

export function formatSize(bytes: number): string {
  const [value, unit, digits] = bytes < 1024 ? [bytes, "byte", 0] : bytes < 1024 * 1024 ? [bytes / 1024, "kilobyte", 0] : [bytes / 1024 / 1024, "megabyte", 1];
  return new Intl.NumberFormat(intlLocale(), { style: "unit", unit, unitDisplay: "short", maximumFractionDigits: digits }).format(value);
}

/** A downloadable file (PDF of an invoice, etc.). */
export const FileAttachment = Node.create({
  name: "fileAttachment",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { url: { default: null }, name: { default: "file" }, size: { default: 0 }, mimeType: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "a[data-file]" }];
  },
  renderHTML({ node }) {
    const { url, name, size } = node.attrs;
    return [
      "a",
      { "data-file": "", class: "file-attachment", href: url ? `${url}?download` : undefined, target: "_blank", rel: "noopener" },
      `📎 ${name} · ${formatSize(size)}`,
    ];
  },
  addCommands() {
    return {
      insertFile:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

/**
 * Inline link to another page. In the app the title is looked up live (and hidden when the reader
 * has no access); in public views the stored attributes are rendered as-is.
 */
export const PageLink = Node.create<{ live: boolean; hrefFor: (pageId: string) => string }>({
  name: "pageLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addOptions() {
    return { live: true, hrefFor: (id: string) => `/page/${id}` };
  },
  addAttributes() {
    return { pageId: { default: null }, title: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "a[data-page-link]" }];
  },
  renderHTML({ node }) {
    const { pageId, title } = node.attrs;
    return [
      "a",
      { "data-page-link": pageId ?? "", class: `page-link${pageId ? "" : " page-link-private"}`, href: pageId ? this.options.hrefFor(pageId) : undefined },
      `📄 ${title || t("common.untitled")}`,
    ];
  },
  renderText({ node }) {
    return node.attrs.title || t("common.untitled");
  },
  addNodeView() {
    return this.options.live ? ReactNodeViewRenderer(PageLinkView, { as: "span" }) : null;
  },
  addCommands() {
    return {
      insertPageLink:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent([{ type: this.name, attrs }, { type: "text", text: " " }]),
    };
  },
});

/**
 * Database shown inside a page. The database itself is a child page; this block only says where it
 * appears. `publicToken` switches the view to the read-only public API.
 */
export const DatabaseBlock = Node.create<{ publicToken: string | null }>({
  name: "databaseBlock",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addOptions() {
    return { publicToken: null };
  },
  addAttributes() {
    return { pageId: { default: null } };
  },
  parseHTML() {
    return [{ tag: "div[data-database]", getAttrs: (el) => ({ pageId: (el as HTMLElement).dataset.database || null }) }];
  },
  renderHTML({ node }) {
    return ["div", { "data-database": node.attrs.pageId ?? "" }, t("common.database")];
  },
  addNodeView() {
    // The table handles its own clicks and keys.
    return ReactNodeViewRenderer(DatabaseBlockView, { stopEvent: () => true });
  },
  addCommands() {
    return {
      insertDatabase:
        (pageId) =>
        ({ commands }) =>
          commands.insertContent([{ type: this.name, attrs: { pageId } }, { type: "paragraph" }]),
    };
  },
});

/**
 * Collapsible block (Notion's toggle), optionally with a heading as its summary. Whether it is open is
 * kept by each reader, not in the page: opening it doesn't change the page for others.
 */
export const Toggle = Details.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      level: {
        default: null,
        parseHTML: (el) => Number((el as HTMLElement).dataset.level) || null,
        renderHTML: (attrs) => (attrs.level ? { "data-level": attrs.level } : {}),
      },
    };
  },
  addCommands() {
    return {
      ...this.parent?.(),
      insertToggle:
        (level) =>
        ({ editor, chain }) => {
          const ok = chain()
            .insertContent({ type: this.name, attrs: { level: level ?? null }, content: [{ type: "detailsSummary" }, { type: "detailsContent", content: [{ type: "paragraph" }] }] })
            .run();
          // A new toggle opens at once, ready to be filled.
          if (ok) requestAnimationFrame(() => openToggleAtCursor(editor));
          return ok;
        },
    };
  },
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      // Enter in the summary of an open toggle whose content is empty goes to that content, instead of adding a line.
      Enter: ({ editor }) => {
        const { $head } = editor.state.selection;
        if ($head.parent.type.name !== "detailsSummary") return this.parent?.().Enter?.({ editor }) ?? false;
        const content = editor.state.doc.nodeAt($head.after());
        const first = content?.firstChild;
        const dom = editor.view.nodeDOM($head.before(-1)) as HTMLElement | null;
        if (dom?.classList.contains("is-open") && content?.childCount === 1 && first?.type.name === "paragraph" && !first.content.size) {
          return editor.commands.setTextSelection($head.after() + 2);
        }
        return this.parent?.().Enter?.({ editor }) ?? false;
      },
    };
  },
}).configure({
  persist: false,
  renderToggleButton: ({ element, isOpen }) => {
    element.setAttribute("aria-label", isOpen ? t("toggle.collapse") : t("toggle.expand"));
    element.setAttribute("aria-expanded", String(isOpen));
  },
});

/** Opens the toggle the cursor is in (or just after), and puts the cursor in its summary. */
function openToggleAtCursor(editor: Editor) {
  const { $from } = editor.state.selection;
  let pos: number | null = null;
  for (let d = $from.depth; d > 0 && pos === null; d--) if ($from.node(d).type.name === "details") pos = $from.before(d);
  if (pos === null && $from.nodeBefore?.type.name === "details") pos = $from.pos - $from.nodeBefore.nodeSize;
  if (pos === null) return;
  const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
  const button = dom?.querySelector<HTMLButtonElement>(":scope > button");
  if (button && !dom!.classList.contains("is-open")) button.click();
  editor.commands.focus(pos + 2);
}

/** Blocks side by side. Put one under the other on narrow screens. */
export const Columns = Node.create({
  name: "columns",
  group: "block",
  content: "column+",
  isolating: true,
  defining: true,
  parseHTML() {
    return [{ tag: "div[data-columns]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-columns": "", class: "columns" }), 0];
  },
  addCommands() {
    return {
      insertColumns:
        (count) =>
        ({ chain, tr }) => {
          const at = tr.selection.from;
          return chain()
            .insertContent([{ type: this.name, content: Array.from({ length: count }, () => ({ type: "column", content: [{ type: "paragraph" }] })) }, { type: "paragraph" }])
            .command(({ tr }) => {
              // The cursor goes into the first column.
              let columns: number | null = null;
              tr.doc.nodesBetween(Math.max(0, at - 2), Math.min(tr.doc.content.size, at + 2), (node, pos) => {
                if (columns === null && node.type.name === this.name) columns = pos;
              });
              if (columns !== null) tr.setSelection(TextSelection.create(tr.doc, columns + 3));
              return true;
            })
            .run();
        },
    };
  },
  addKeyboardShortcuts() {
    return {
      // Backspace in an empty column removes it; with a single column left, its blocks take the place of the columns.
      Backspace: ({ editor }) => {
        const { selection } = editor.state;
        const { $from, empty } = selection;
        if (!empty || $from.parentOffset !== 0 || $from.depth < 3) return false;
        const column = $from.node(-1);
        if (column.type.name !== "column" || $from.index(-1) !== 0) return false;
        if (column.childCount > 1 || column.firstChild!.content.size > 0 || column.firstChild!.type.name !== "paragraph") return false;
        const columns = $from.node(-2);
        const columnsPos = $from.before(-2);
        const index = $from.index(-2);
        const tr = editor.state.tr;
        if (columns.childCount <= 2) {
          const rest = columns.child(index === 0 ? 1 : 0);
          tr.replaceWith(columnsPos, columnsPos + columns.nodeSize, rest.content);
          tr.setSelection(TextSelection.near(tr.doc.resolve(columnsPos + 1)));
        } else {
          const from = $from.before(-1);
          tr.delete(from, from + column.nodeSize);
          // The cursor goes to the end of the previous column, or the start of the next one.
          tr.setSelection(TextSelection.near(tr.doc.resolve(index > 0 ? from - 1 : from + 1), index > 0 ? -1 : 1));
        }
        editor.view.dispatch(tr.scrollIntoView());
        return true;
      },
    };
  },
});

export const Column = Node.create({
  name: "column",
  content: "block+",
  isolating: true,
  defining: true,
  parseHTML() {
    return [{ tag: "div[data-column]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-column": "", class: "column" }), 0];
  },
});
