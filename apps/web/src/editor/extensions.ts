import type { AnyExtension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import { Placeholder } from "@tiptap/extensions";
import { Callout, FileAttachment, PageLink } from "./nodes";

/** Extensions shared by the collaborative editor and the read-only public view. Keep both schemas identical. */
export function baseExtensions(opts: { collaborative: boolean; pageLink?: Parameters<typeof PageLink.configure>[0] }): AnyExtension[] {
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
    FileAttachment,
    PageLink.configure(opts.pageLink ?? {}),
    Placeholder.configure({
      placeholder: ({ node }) => (node.type.name === "heading" ? "Titre" : "Écrivez, ou tapez « / » pour les commandes…"),
      showOnlyCurrent: true,
    }),
  ];
}
