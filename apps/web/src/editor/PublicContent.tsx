import { EditorContent, useEditor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import { baseExtensions } from "./extensions";

/** Read-only rendering of published content (no connection to the collaboration server). */
export function PublicContent({ content, token }: { content: JSONContent; token: string }) {
  const editor = useEditor(
    {
      editable: false,
      content,
      extensions: baseExtensions({ collaborative: false, pageLink: { live: false, hrefFor: (id) => `/p/${token}/${id}` } }),
      editorProps: { attributes: { class: "nootion-content" } },
    },
    [content, token],
  );
  return <EditorContent editor={editor} />;
}
