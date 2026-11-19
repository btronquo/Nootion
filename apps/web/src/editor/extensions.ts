import type { AnyExtension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import type { ClientPluginInfo } from "@nootion/shared";
import { DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import {
  ButtonBlock,
  CalendarBlock,
  Callout,
  DateMention,
  Drawing,
  Column,
  Columns,
  DatabaseBlock,
  WIDGETS,
  WidgetCommands,
  FileAttachment,
  PageLink,
  TableOfContents,
  Toggle,
  UserMention,
  Video,
} from "./nodes";
import { pluginNodes } from "../plugins/nodes";
import { BlockAttributes } from "./blockAttrs";
import { HandleTargets } from "./handleTargets";
import { ColumnResize } from "./columnResize";
import { LinkClicks } from "./linkClicks";
import { ImageViewer } from "./imageViewer";
import { NootionImage } from "./imageBlock";
import { Highlight, TextColor } from "./textColors";
import { NootionCodeBlock } from "./codeBlock";
import { MathBlock, MathInline } from "./mathNodes";
import { RepeatingTaskItem, TaskRepeatExtension } from "./taskRepeat";
import { SyncedBlock } from "./syncedBlock";
import { t } from "@nootion/shared";

/** Extensions shared by the collaborative editor and the read-only public view. Keep both schemas identical. */
export function baseExtensions(opts: {
  collaborative: boolean;
  plugins: ClientPluginInfo[];
  pageLink?: Parameters<typeof PageLink.configure>[0];
  publicToken?: string;
  /** The page being edited, for calendar feeds. */
  pageId?: string;
  /** Opens a path of this site in the app, when a text link to it is clicked. */
  navigate?: (path: string) => void;
  /** Inside a synced block: the synced blocks it is in (see SyncedBlock). */
  syncedAncestors?: string[];
}): AnyExtension[] {
  return [
    StarterKit.configure({
      // Yjs has its own undo history.
      undoRedo: opts.collaborative ? false : undefined,
      link: { openOnClick: !opts.collaborative, autolink: true, HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" } },
      heading: { levels: [1, 2, 3] },
      // Where a dragged block will land: drawn by .nt-dropcursor (index.css).
      dropcursor: { color: false, width: 3, class: "nt-dropcursor" },
      // Replaced below by the one with colours and a language menu.
      codeBlock: false,
      // A synced block ends with its last block, without the empty line pages keep at their end.
      ...(opts.syncedAncestors?.length ? { trailingNode: false as const } : {}),
    }),
    TextColor,
    Highlight,
    NootionCodeBlock,
    MathInline,
    MathBlock,
    TaskList,
    RepeatingTaskItem.configure({ nested: true }),
    TaskRepeatExtension,
    TableKit.configure({ table: { resizable: true } }),
    NootionImage,
    ImageViewer,
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
    UserMention,
    TableOfContents,
    DatabaseBlock.configure({ pageId: opts.pageId ?? null, publicToken: opts.publicToken ?? null }),
    CalendarBlock.configure({ pageId: opts.pageId ?? null, publicToken: opts.publicToken ?? null }),
    Drawing,
    ButtonBlock.configure({ pageId: opts.publicToken ? null : (opts.pageId ?? null) }),
    Video.configure({ pageId: opts.publicToken ? null : (opts.pageId ?? null) }),
    SyncedBlock.configure({ pageId: opts.publicToken ? null : (opts.pageId ?? null), ancestors: opts.syncedAncestors ?? [] }),
    ...WIDGETS.map((w) => w.configure({ publicToken: opts.publicToken ?? null, pageId: opts.publicToken ? null : (opts.pageId ?? null) })),
    WidgetCommands,
    ...pluginNodes(opts.plugins, opts.publicToken ? null : (opts.pageId ?? null)),
    BlockAttributes,
    HandleTargets,
    ColumnResize,
    // The read-only views keep the links' own behaviour (openOnClick above).
    ...(opts.collaborative ? [LinkClicks.configure({ navigate: opts.navigate ?? null })] : []),
    Placeholder.configure({
      placeholder: ({ node }) => (node.type.name === "heading" ? t("editor.headingPlaceholder") : t("editor.placeholder")),
      // Only top-level blocks: with includeChildren, placeholders stay on lines the cursor has left.
      showOnlyCurrent: true,
    }),
  ];
}
