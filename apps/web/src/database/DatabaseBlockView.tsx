import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Link } from "react-router-dom";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { atLeast, type DatabaseData } from "@nootion/shared";
import { api } from "../lib/api";
import { pageTitle } from "../lib/tree";
import { DatabaseTable, TableView } from "./DatabaseTable";
import { dbKey, useDatabase } from "./hooks";

/** Database embedded in a page's content. */
export function DatabaseBlockView({ node, extension }: NodeViewProps) {
  const pageId = node.attrs.pageId as string | null;
  const token = extension.options.publicToken as string | null;
  return (
    <NodeViewWrapper className="database-block my-4" contentEditable={false} data-drag-handle="">
      {!pageId ? (
        <div className="rounded border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-500 dark:border-neutral-700">🔒 Base de données privée</div>
      ) : token ? (
        <PublicDatabase id={pageId} token={token} />
      ) : (
        <LiveDatabase id={pageId} />
      )}
    </NodeViewWrapper>
  );
}

function Heading({ title, to }: { title: string; to?: string }) {
  const text = `🗃 ${pageTitle(title)}`;
  return <div className="mb-1 text-lg font-semibold">{to ? <Link to={to} className="hover:underline">{text}</Link> : text}</div>;
}

function LiveDatabase({ id }: { id: string }) {
  // Shares the cache with the table below, so this costs no extra request.
  const db = useDatabase(id);
  return (
    <>
      {db.data && (atLeast(db.data.role, "editor") ? <EditableHeading data={db.data} /> : <Heading title={db.data.title} to={`/page/${id}`} />)}
      <DatabaseTable id={id} compact />
    </>
  );
}

function EditableHeading({ data }: { data: DatabaseData }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(data.title);
  const save = async () => {
    if (title === data.title) return;
    await api(`/pages/${data.id}`, { method: "PATCH", body: { title } });
    await Promise.all([qc.invalidateQueries({ queryKey: dbKey(data.id) }), qc.invalidateQueries({ queryKey: ["pages"] }), qc.invalidateQueries({ queryKey: ["page", data.id] })]);
  };
  return (
    <div className="mb-1 flex items-center gap-1 text-lg font-semibold">
      <span>🗃</span>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        placeholder="Sans titre"
        aria-label="Titre de la base de données"
        className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-neutral-400"
      />
      <Link to={`/page/${data.id}`} title="Ouvrir en pleine page" className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800">
        <ExternalLink size={16} />
      </Link>
    </div>
  );
}

export function PublicDatabase({ id, token }: { id: string; token: string }) {
  const q = useQuery({ queryKey: ["public", token, "database", id], queryFn: async () => (await api<{ database: DatabaseData }>(`/public/${token}/databases/${id}`)).database });
  if (!q.data) return null;
  return (
    <>
      <Heading title={q.data.title} />
      <TableView data={q.data} compact rowHref={(r) => `/p/${token}/${r.id}`} fileUrl={(f) => `/api/public/${token}/attachments/${f}`} />
    </>
  );
}
