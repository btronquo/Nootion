import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Link } from "react-router-dom";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Link2 } from "lucide-react";
import { atLeast, type DatabaseData, type ViewOwner } from "@nootion/shared";
import { api } from "../lib/api";
import { pageTitle } from "../lib/tree";
import { pageIcon } from "../lib/icons";
import { DatabaseTable, DatabaseViews } from "./DatabaseTable";
import { dbKey, useDatabase, useDatabaseList } from "./hooks";
import { t } from "@nootion/shared";

/** Database embedded in a page's content. */
export function DatabaseBlockView({ node, extension, editor, updateAttributes }: NodeViewProps) {
  const pageId = node.attrs.pageId as string | null;
  const token = extension.options.publicToken as string | null;
  const hostId = extension.options.pageId as string | null;
  const linkId = node.attrs.linkId as string | null;
  // A linked view's own views: they belong to this block in this page.
  const owner = node.attrs.linked && hostId && linkId ? { pageId: hostId, blockId: linkId } : null;
  if (node.attrs.linked)
    return (
      <NodeViewWrapper className="database-block my-4" contentEditable={false} data-drag-handle="" data-linked-view="">
        {!pageId && !token ? (
          <LinkedViewSetup editable={editor.isEditable} onPick={(id) => updateAttributes({ pageId: id })} />
        ) : !pageId ? (
          <div className="rounded border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-500 dark:border-neutral-700">🔒 {t("database.private")}</div>
        ) : token ? (
          <PublicDatabase id={pageId} token={token} owner={owner} />
        ) : (
          <LinkedDatabase id={pageId} owner={owner} />
        )}
      </NodeViewWrapper>
    );
  return (
    <NodeViewWrapper className="database-block my-4" contentEditable={false} data-drag-handle="">
      {!pageId ? (
        <div className="rounded border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-500 dark:border-neutral-700">🔒 {t("database.private")}</div>
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
        placeholder={t("common.untitled")}
        aria-label={t("database.titleLabel")}
        className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-neutral-400"
      />
      <Link data-print-hide to={`/page/${data.id}`} title={t("database.openFull")} className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800">
        <ExternalLink size={16} />
      </Link>
    </div>
  );
}

/**
 * A database shown with views of its own. The title is the original's, and leads to it: renaming it here would rename
 * the database everywhere.
 */
function LinkedDatabase({ id, owner }: { id: string; owner: ViewOwner | null }) {
  const db = useDatabase(id, owner);
  if (db.isError) return <div className="rounded border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-500 dark:border-neutral-700">🔒 {t("linkedView.unavailable")}</div>;
  return (
    <>
      {db.data && <LinkedHeading title={db.data.title} icon={db.data.icon} to={`/page/${id}`} />}
      <DatabaseTable id={id} compact owner={owner} />
    </>
  );
}

function LinkedHeading({ title, icon, to }: { title: string; icon: string | null; to?: string }) {
  const text = (
    <>
      <span>{pageIcon(icon) ?? "🗃"}</span>
      <span className="truncate">{pageTitle(title)}</span>
    </>
  );
  return (
    <div className="mb-1 flex items-center gap-1.5 text-lg font-semibold">
      <span title={t("linkedView.hint")} className="text-neutral-400" data-print-hide>
        <Link2 size={16} />
      </span>
      {to ? (
        <Link to={to} title={t("linkedView.openOriginal")} className="flex min-w-0 items-center gap-1.5 hover:underline">
          {text}
        </Link>
      ) : (
        text
      )}
    </div>
  );
}

/** Choosing the database a new linked view shows. */
function LinkedViewSetup({ editable, onPick }: { editable: boolean; onPick: (id: string) => void }) {
  const list = useDatabaseList();
  const [query, setQuery] = useState("");
  if (!editable)
    return <div className="rounded border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-500 dark:border-neutral-700">{t("linkedView.none")}</div>;
  const norm = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const databases = (list.data ?? []).filter((d) => norm(pageTitle(d.title)).includes(norm(query)));
  return (
    <div className="rounded border border-neutral-200 p-2 text-sm dark:border-neutral-700">
      <div className="mb-1 flex items-center gap-1.5 px-1 font-medium">
        <Link2 size={14} className="text-neutral-400" /> {t("linkedView.choose")}
      </div>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("linkedView.search")}
        aria-label={t("linkedView.search")}
        className="mb-1 w-full rounded border border-neutral-200 bg-transparent px-2 py-1.5 outline-none focus:border-neutral-400 dark:border-neutral-700"
      />
      <div className="max-h-64 overflow-y-auto">
        {databases.map((d) => (
          <button key={d.id} onClick={() => onPick(d.id)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800">
            <span className="w-4 text-center">{pageIcon(d.icon) ?? "🗃"}</span>
            <span className="truncate">{pageTitle(d.title)}</span>
          </button>
        ))}
        {list.isLoading && <p className="px-2 py-1 text-neutral-400">{t("common.loading")}</p>}
        {list.data && !databases.length && <p className="px-2 py-1 text-neutral-500">{t("relation.none")}</p>}
      </div>
    </div>
  );
}

export function PublicDatabase({ id, token, owner }: { id: string; token: string; owner?: ViewOwner | null }) {
  const suffix = owner ? `?${new URLSearchParams({ page: owner.pageId, block: owner.blockId })}` : "";
  const q = useQuery({
    queryKey: ["public", token, "database", id, owner?.blockId ?? null],
    queryFn: async () => (await api<{ database: DatabaseData }>(`/public/${token}/databases/${id}${suffix}`)).database,
  });
  if (!q.data) return null;
  return (
    <>
      {owner ? <LinkedHeading title={q.data.title} icon={q.data.icon} /> : <Heading title={q.data.title} />}
      <DatabaseViews data={q.data} compact rowHref={(r) => `/p/${token}/${r.id}`} fileUrl={(f) => `/api/public/${token}/attachments/${f}`} />
    </>
  );
}
