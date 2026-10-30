import type { AnyExtension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import { Placeholder } from "@tiptap/extensions";
import type { ClientPluginInfo } from "@nootion/shared";
import { DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import { ButtonBlock, CalendarBlock, Callout, DateMention, Column, Columns, DatabaseBlock, DatabaseRows, FavoritesList, RecentPages, UpcomingEvents, WidgetCommands, FileAttachment, PageLink, Toggle } from "./nodes";
import { pluginNodes } from "../plugins/nodes";
import { t } from "@nootion/shared";

/** Extensions shared by the collaborative editor and the read-only public view. Keep both schemas identical. */
export function baseExtensions(opts: {
  collaborative: boolean;
  plugins: ClientPluginInfo[];
  pageLink?: Parameters<typeof PageLink.configure>[0];
  publicToken?: string;
  /** The page being edited, for calendar feeds. */
  pageId?: string;
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
    // Its placeholder is shown by CSS (the Placeholder extension only handles top-level blocks).
    DetailsSummary.configure({ HTMLAttributes: { "data-placeholder": t("toggle.placeholder") } }),
    DetailsContent,
    Columns,
    Column,
    FileAttachment,
    PageLink.configure(opts.pageLink ?? {}),
    DateMention,
    DatabaseBlock.configure({ publicToken: opts.publicToken ?? null }),
    CalendarBlock.configure({ pageId: opts.pageId ?? null, publicToken: opts.publicToken ?? null }),
    ButtonBlock.configure({ pageId: opts.publicToken ? null : (opts.pageId ?? null) }),
    ...[RecentPages, FavoritesList, UpcomingEvents, DatabaseRows].map((w) => w.configure({ publicToken: opts.publicToken ?? null })),
    WidgetCommands,
    ...pluginNodes(opts.plugins),
    Placeholder.configure({
      placeholder: ({ node }) =>
        node.type.name === "heading" ? t("editor.headingPlaceholder") : t("editor.placeholder"),
      // Only top-level blocks: with includeChildren, placeholders stay on lines the cursor has left.
      showOnlyCurrent: true,
    }),
  ];
}
