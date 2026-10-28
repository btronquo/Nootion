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
} from "lucide-react";
import type { PageSummary } from "@nootion/shared";
import { api } from "../lib/api";
import { pageTitle } from "../lib/tree";
import { item } from "./suggestion";
import { insertFiles, pickFiles } from "./upload";

export interface CommandContext {
  pageId: string;
  workspaceId: string;
  /** Called after a subpage is created, so the sidebar can refresh. */
  onPageCreated: () => void;
  /** Pages the user can link to, for "@". */
  linkablePages: () => PageSummary[];
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function slashItems(ctx: CommandContext) {
  const del = (e: Editor, r: Range) => e.chain().focus().deleteRange(r);
  const all = [
    item("Texte", "Paragraphe simple", <Text size={16} />, (e, r) => del(e, r).setParagraph().run(), "paragraphe"),
    item("Titre 1", "Grand titre", <Heading1 size={16} />, (e, r) => del(e, r).setHeading({ level: 1 }).run(), "h1 heading"),
    item("Titre 2", "Titre moyen", <Heading2 size={16} />, (e, r) => del(e, r).setHeading({ level: 2 }).run(), "h2 heading"),
    item("Titre 3", "Petit titre", <Heading3 size={16} />, (e, r) => del(e, r).setHeading({ level: 3 }).run(), "h3 heading"),
    item("Liste à puces", "Liste simple", <List size={16} />, (e, r) => del(e, r).toggleBulletList().run(), "bullet ul"),
    item("Liste numérotée", "Liste 1, 2, 3", <ListOrdered size={16} />, (e, r) => del(e, r).toggleOrderedList().run(), "ordered ol numero"),
    item("Liste de tâches", "Cases à cocher", <CheckSquare size={16} />, (e, r) => del(e, r).toggleTaskList().run(), "todo checkbox tache"),
    item("Citation", "Bloc de citation", <Quote size={16} />, (e, r) => del(e, r).toggleBlockquote().run(), "quote"),
    item("Encadré", "Bloc mis en évidence", <Lightbulb size={16} />, (e, r) => del(e, r).setCallout().run(), "callout note info"),
    item("Code", "Bloc de code", <Code size={16} />, (e, r) => del(e, r).toggleCodeBlock().run(), "code"),
    item("Tableau", "Tableau 3 × 3", <Table size={16} />, (e, r) => del(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), "table"),
    item("Séparateur", "Ligne horizontale", <Minus size={16} />, (e, r) => del(e, r).setHorizontalRule().run(), "hr divider ligne"),
    item(
      "Image",
      "Envoyer une image",
      <ImageIcon size={16} />,
      async (e, r) => {
        del(e, r).run();
        await insertFiles(e, ctx.pageId, await pickFiles("image/*"));
      },
      "photo picture",
    ),
    item(
      "Fichier",
      "Joindre un fichier (PDF…)",
      <Paperclip size={16} />,
      async (e, r) => {
        del(e, r).run();
        await insertFiles(e, ctx.pageId, await pickFiles("*/*"));
      },
      "pdf piece jointe attachment",
    ),
    item(
      "Sous-page",
      "Créer une page dans celle-ci",
      <FileText size={16} />,
      async (e, r) => {
        del(e, r).run();
        const res = await api<{ page: PageSummary }>("/pages", { method: "POST", body: { workspaceId: ctx.workspaceId, parentId: ctx.pageId, title: "" } });
        e.chain().focus().insertPageLink({ pageId: res.page.id, title: "" }).run();
        ctx.onPageCreated();
      },
      "page subpage",
    ),
    item("Lien vers une page", "Mentionner une page existante", <Link2 size={16} />, (e, r) => del(e, r).insertContent("@").run(), "mention lien"),
  ];
  return ({ query }: { query: string }) => {
    const q = norm(query).trim();
    // Typing on past a non-matching command closes the menu.
    if (q.length > 25) return [];
    return all.filter((i) => norm(`${i.title} ${i.keywords}`).includes(q));
  };
}

export function mentionItems(ctx: CommandContext) {
  return ({ query }: { query: string }) => {
    const q = norm(query);
    return ctx
      .linkablePages()
      .filter((p) => p.id !== ctx.pageId && norm(pageTitle(p.title)).includes(q))
      .slice(0, 12)
      .map((p) =>
        item(pageTitle(p.title), "", p.icon ?? <FileText size={16} />, (e, r) => e.chain().focus().deleteRange(r).insertPageLink({ pageId: p.id, title: p.title }).run()),
      );
  };
}
