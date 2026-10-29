import { EditorContent, useEditor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import type { ClientPluginInfo } from "@nootion/shared";
import { baseExtensions } from "./extensions";
import { usePlugins } from "../plugins/registry";

/** Read-only rendering of published content (no connection to the collaboration server). */
export function PublicContent({ content, token }: { content: JSONContent; token: string }) {
  const plugins = usePlugins();
  // Unknown plugin blocks would make the content invalid: wait for the list (or show it without them on error).
  if (!plugins.data && !plugins.isError) return null;
  return <PublicEditor content={content} token={token} plugins={plugins.data ?? []} />;
}

function PublicEditor({ content, token, plugins }: { content: JSONContent; token: string; plugins: ClientPluginInfo[] }) {
  const editor = useEditor(
    {
      editable: false,
      content,
      extensions: baseExtensions({ collaborative: false, plugins, pageLink: { live: false, hrefFor: (id) => `/p/${token}/${id}` }, publicToken: token }),
      editorProps: { attributes: { class: "nootion-content" } },
    },
    [content, token, plugins],
  );
  return <EditorContent editor={editor} />;
}
