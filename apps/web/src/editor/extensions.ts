import type { AnyExtension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import { Placeholder } from "@tiptap/extensions";
import type { ClientPluginInfo } from "@nootion/shared";
import { DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import { Callout, Column, Columns, DatabaseBlock, FileAttachment, PageLink, Toggle } from "./nodes";
import { pluginNodes } from "../plugins/nodes";
import { t } from "@nootion/shared";

/** Extensions shared by the collaborative editor and the read-only public view. Keep both schemas identical. */
export function baseExtensions(opts: {
  collaborative: boolean;
  plugins: ClientPluginInfo[];
  pageLink?: Parameters<typeof PageLink.configure>[0];
  publicToken?: string;
}): AnyExtension[] {
  return [
    StarterKit.configure({
      // Yjs has its own undo history.
      undoRedo: opts.collaborative ? false : undefined,
      link: { openOnClick: !opts.collaborative, autolink: true, HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" } },
      heading: { levels: [1, 2, 3] },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true } }),
    Image,
    Callout,
    Toggle,
    DetailsSummary,
    DetailsContent,
    Columns,
    Column,
    FileAttachment,
    PageLink.configure(opts.pageLink ?? {}),
    DatabaseBlock.configure({ publicToken: opts.publicToken ?? null }),
    ...pluginNodes(opts.plugins),
    Placeholder.configure({
      placeholder: ({ node }) =>
        node.type.name === "detailsSummary" ? t("toggle.placeholder") : node.type.name === "heading" ? t("editor.headingPlaceholder") : t("editor.placeholder"),
      showOnlyCurrent: true,
      includeChildren: true,
    }),
  ];
}
