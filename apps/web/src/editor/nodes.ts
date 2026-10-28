import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { PageLinkView } from "./PageLinkView";
import { DatabaseBlockView } from "../database/DatabaseBlockView";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: { setCallout: () => ReturnType };
    fileAttachment: { insertFile: (attrs: { url: string; name: string; size: number; mimeType: string }) => ReturnType };
    pageLink: { insertPageLink: (attrs: { pageId: string; title: string }) => ReturnType };
    databaseBlock: { insertDatabase: (pageId: string) => ReturnType };
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
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

/** A downloadable file (PDF of an invoice, etc.). */
export const FileAttachment = Node.create({
  name: "fileAttachment",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { url: { default: null }, name: { default: "fichier" }, size: { default: 0 }, mimeType: { default: "" } };
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
      `📄 ${title || "Sans titre"}`,
    ];
  },
  renderText({ node }) {
    return node.attrs.title || "Sans titre";
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
    return ["div", { "data-database": node.attrs.pageId ?? "" }, "Base de données"];
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
