import type { Editor, Range } from "@tiptap/core";
import {
  CheckSquare,
  Code,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Link2,
  List,
  ListOrdered,
  Minus,
  Paperclip,
  Quote,
  Table,
  Text,
  Lightbulb,
  Database,
  ListCollapse,
  Columns2,
  Columns3,
  CalendarDays,
  CalendarClock,
  Clock,
  ListChecks,
  Star,
  Bell,
  MousePointerClick,
  ListTree,
} from "lucide-react";
import { currentLocale, parseNaturalDate, pluginNodeName, type ClientPluginInfo, type PageSummary, type UserDirectoryEntry } from "@nootion/shared";
import { formatMentionDate } from "../lib/reminders";
import { api } from "../lib/api";
import { pageTitle } from "../lib/tree";
import { item } from "./suggestion";
import { Avatar } from "../components/Avatar";
import { insertFiles, insertUploaded, pickFiles } from "./upload";
import { fileSources } from "../plugins/registry";
import { t } from "@nootion/shared";
import { pageIcon } from "../lib/icons";

export interface CommandContext {
  pageId: string;
  workspaceId: string;
  /** Called after a subpage is created, so the sidebar can refresh. */
  onPageCreated: () => void;
  /** Pages the user can link to, for "@". */
  linkablePages: () => PageSummary[];
  /** Installed plugins: enabled ones add their blocks to the "/" menu. */
  plugins: ClientPluginInfo[];
  /** The user editing, who receives the reminders they set. */
  userId: string | null;
  /** People who can be mentioned with "@". */
  people: () => UserDirectoryEntry[];
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function slashItems(ctx: CommandContext) {
  const del = (e: Editor, r: Range) => e.chain().focus().deleteRange(r);
  const all = [
    item("Text", t("command.text"), <Text size={16} />, (e, r) => del(e, r).setParagraph().run(), "paragraph"),
    item("Heading 1", t("command.h1"), <Heading1 size={16} />, (e, r) => del(e, r).setHeading({ level: 1 }).run(), "h1 title"),
    item("Heading 2", t("command.h2"), <Heading2 size={16} />, (e, r) => del(e, r).setHeading({ level: 2 }).run(), "h2 title"),
    item("Heading 3", t("command.h3"), <Heading3 size={16} />, (e, r) => del(e, r).setHeading({ level: 3 }).run(), "h3 title"),
    item("Bullet list", t("command.bullets"), <List size={16} />, (e, r) => del(e, r).toggleBulletList().run(), "ul"),
    item("Numbered list", t("command.numbers"), <ListOrdered size={16} />, (e, r) => del(e, r).toggleOrderedList().run(), "ordered ol"),
    item("To-do list", t("command.todo"), <CheckSquare size={16} />, (e, r) => del(e, r).toggleTaskList().run(), "todo task checkbox"),
    item("Quote", t("command.quote"), <Quote size={16} />, (e, r) => del(e, r).toggleBlockquote().run(), "blockquote"),
    item("Callout", t("command.callout"), <Lightbulb size={16} />, (e, r) => del(e, r).setCallout().run(), "note info"),
    item("Toggle", t("command.toggle"), <ListCollapse size={16} />, (e, r) => del(e, r).insertToggle().run(), "collapse details fold"),
    item("Toggle heading 1", t("command.toggleH1"), <ListCollapse size={16} />, (e, r) => del(e, r).insertToggle(1).run(), "collapse h1"),
    item("Toggle heading 2", t("command.toggleH2"), <ListCollapse size={16} />, (e, r) => del(e, r).insertToggle(2).run(), "collapse h2"),
    item("Toggle heading 3", t("command.toggleH3"), <ListCollapse size={16} />, (e, r) => del(e, r).insertToggle(3).run(), "collapse h3"),
    item("Table of contents", t("command.toc"), <ListTree size={16} />, (e, r) => del(e, r).insertTableOfContents().run(), "toc outline summary headings"),
    item("2 columns", t("command.columns2"), <Columns2 size={16} />, (e, r) => del(e, r).insertColumns(2).run(), "columns side layout"),
    item("3 columns", t("command.columns3"), <Columns3 size={16} />, (e, r) => del(e, r).insertColumns(3).run(), "columns side layout"),
    item("Code", t("command.code"), <Code size={16} />, (e, r) => del(e, r).toggleCodeBlock().run(), "codeblock"),
    item("Table", t("command.table"), <Table size={16} />, (e, r) => del(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), "grid"),
    item("Divider", t("command.divider"), <Minus size={16} />, (e, r) => del(e, r).setHorizontalRule().run(), "hr separator"),
    item(
      "Image",
      t("command.image"),
      <ImageIcon size={16} />,
      async (e, r) => {
        del(e, r).run();
        await insertFiles(e, ctx.pageId, await pickFiles("image/*"));
      },
      "photo picture img",
    ),
    item(
      "File",
      t("command.file"),
      <Paperclip size={16} />,
      async (e, r) => {
        del(e, r).run();
        await insertFiles(e, ctx.pageId, await pickFiles("*/*"));
      },
      "pdf attachment upload",
    ),
    item(
      "Page",
      t("command.page"),
      <FileText size={16} />,
      async (e, r) => {
        del(e, r).run();
        const res = await api<{ page: PageSummary }>("/pages", { method: "POST", body: { workspaceId: ctx.workspaceId, parentId: ctx.pageId, title: "", linkInParent: false } });
        e.chain().focus().insertPageLink({ pageId: res.page.id, title: "" }).run();
        ctx.onPageCreated();
      },
      "subpage",
    ),
    item(
      "Database",
      t("command.database"),
      <Database size={16} />,
      async (e, r) => {
        del(e, r).run();
        const res = await api<{ database: { id: string } }>("/databases", { method: "POST", body: { workspaceId: ctx.workspaceId, parentId: ctx.pageId, title: "" } });
        e.chain().focus().insertDatabase(res.database.id).run();
        ctx.onPageCreated();
      },
      "db table",
    ),
    item("Button", t("command.button"), <MousePointerClick size={16} />, (e, r) => del(e, r).insertButton().run(), "action automation form webhook bouton formulaire"),
    item("Calendar", t("command.calendar"), <CalendarDays size={16} />, (e, r) => del(e, r).insertCalendar().run(), "agenda events dates ical"),
    item("Recent pages", t("command.recentPages"), <Clock size={16} />, (e, r) => del(e, r).insertWidget("recentPages").run(), "widget visited history home"),
    item("Favorites", t("command.favoritesList"), <Star size={16} />, (e, r) => del(e, r).insertWidget("favoritesList").run(), "widget starred home"),
    item("Upcoming events", t("command.upcomingEvents"), <CalendarClock size={16} />, (e, r) => del(e, r).insertWidget("upcomingEvents").run(), "widget agenda next home"),
    item("Database rows", t("command.databaseRows"), <ListChecks size={16} />, (e, r) => del(e, r).insertWidget("databaseRows").run(), "widget todo tasks list home"),
    item("Link to page", t("command.link"), <Link2 size={16} />, (e, r) => del(e, r).insertContent("@").run(), "mention"),
    // Other places to pick files from (cloud drives…), from plugins (before their blocks: "/nextcloud" picks files, "/nextcloud link" a link block).
    ...fileSources().map((source) =>
      item(
        source.label,
        t("command.fileFrom", { source: source.label }),
        <span className="w-4 text-center text-base leading-none">{source.icon ?? "📁"}</span>,
        async (e, r) => {
          del(e, r).run();
          for (const up of (await source.pick({ pageId: ctx.pageId, multiple: true })) ?? []) insertUploaded(e, up);
        },
        `${source.keywords ?? ""} file image fichier`,
      ),
    ),
    // Blocks of enabled plugins.
    ...ctx.plugins
      .filter((p) => p.enabled)
      .flatMap((p) =>
        p.blocks.map((b) =>
          item(
            b.title,
            b.description,
            <span className="w-4 text-center text-base leading-none">{b.icon}</span>,
            (e, r) =>
              del(e, r)
                .insertContent({ type: pluginNodeName(p.id, b.id), attrs: { data: JSON.stringify(b.defaultData) } })
                .run(),
            `${b.keywords} ${p.name}`,
          ),
        ),
      ),
  ];
  return ({ query }: { query: string }) => {
    const q = norm(query).trim();
    // Typing on past a non-matching command closes the menu.
    if (q.length > 25) return [];
    // Searched in English and in the user's language. "/heading1" and "/heading 1" both match "Heading 1".
    const compact = q.replace(/[\s-]/g, "");
    const found = all.filter((i) => norm(`${i.title} ${i.hint} ${i.keywords}`).includes(q) || norm(`${i.title}|${i.hint}`).replace(/[\s-]/g, "").includes(compact));
    // Names starting with what was typed come first: "/2 col" puts "2 columns" before "Toggle heading 2".
    const starts = (i: (typeof all)[number]) => norm(i.title).startsWith(q) || norm(i.hint ?? "").startsWith(q);
    return [...found.filter(starts), ...found.filter((i) => !starts(i))];
  };
}

/** "@": pages to link to, and dates written in words ("@tomorrow 9am", "@rappel vendredi"). */
export function mentionItems(ctx: CommandContext) {
  return ({ query }: { query: string }) => {
    const q = norm(query);
    const pages = ctx
      .linkablePages()
      .filter((p) => p.id !== ctx.pageId && norm(pageTitle(p.title)).includes(q))
      .slice(0, 12)
      .map((p) =>
        item(pageTitle(p.title), "", pageIcon(p.icon) ?? <FileText size={16} />, (e, r) => e.chain().focus().deleteRange(r).insertPageLink({ pageId: p.id, title: p.title }).run()),
      );
    const date = (text: string) => {
      const found = parseNaturalDate(text, new Date(), currentLocale() === "en" ? "mdy" : "dmy");
      if (!found) return [];
      const remind = found.remind && !!ctx.userId;
      return [
        item(formatMentionDate(found.date), remind ? t("date.remindHint") : t("date.hint"), remind ? <Bell size={16} /> : <CalendarDays size={16} />, (e, r) =>
          e
            .chain()
            .focus()
            .deleteRange(r)
            .insertDate({ date: found.date, reminder: remind ? 0 : null, remindUser: remind ? ctx.userId : null })
            .run(),
        ),
      ];
    };
    const people = ctx
      .people()
      .filter((u) => norm(u.name).includes(q) || norm(u.email).startsWith(q))
      .slice(0, q ? 5 : 3)
      .map((u) =>
        item(u.name, t("editor.people"), <Avatar name={u.name} url={u.avatarUrl} size={18} />, (e, r) =>
          e.chain().focus().deleteRange(r).insertUserMention({ userId: u.id, name: u.name, by: ctx.userId }).run(),
        ),
      );
    // A date typed comes first; with nothing typed yet, today's date comes after the pages.
    return q.trim() ? [...date(query), ...people, ...pages] : [...people, ...pages, ...date("today")];
  };
}
