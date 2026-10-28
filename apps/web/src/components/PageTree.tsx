import { useState, type DragEvent } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { ChevronRight, Database, FileText, Plus, Trash2 } from "lucide-react";
import type { PageSummary } from "@nootion/shared";
import { api } from "../lib/api";
import { useRefreshPages } from "../lib/queries";
import { pageTitle, type TreeNode } from "../lib/tree";

const DRAG_TYPE = "application/x-nootion-page";

type DropZone = "before" | "inside" | "after";

interface TreeProps {
  nodes: TreeNode[];
  workspaceId: string;
  /** False for read-only trees (no add, trash or drag). */
  editable: boolean;
  /** Pages of the whole tree, used to forbid dropping a page into its own subtree. */
  all: PageSummary[];
}

export function PageTree(props: TreeProps) {
  if (props.nodes.length === 0) return <p className="px-2 py-1 text-xs text-neutral-400">Aucune page</p>;
  return (
    <ul>
      {props.nodes.map((n) => (
        <PageTreeItem key={n.page.id} node={n} depth={0} {...props} />
      ))}
    </ul>
  );
}

function isInside(all: PageSummary[], pageId: string, ancestorId: string): boolean {
  const byId = new Map(all.map((p) => [p.id, p]));
  let cur = byId.get(pageId);
  while (cur) {
    if (cur.id === ancestorId) return true;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return false;
}

function PageTreeItem({ node, depth, workspaceId, editable, all }: TreeProps & { node: TreeNode; depth: number }) {
  const [open, setOpen] = useState(false);
  const [drop, setDrop] = useState<DropZone | null>(null);
  const navigate = useNavigate();
  const refresh = useRefreshPages();
  const { page, children } = node;

  async function addChild() {
    const res = await api<{ page: PageSummary }>("/pages", { method: "POST", body: { workspaceId, parentId: page.id, title: "" } });
    setOpen(true);
    await refresh();
    navigate(`/page/${res.page.id}`);
  }

  async function trash() {
    await api(`/pages/${page.id}`, { method: "DELETE" });
    await refresh();
    if (location.pathname.startsWith(`/page/${page.id}`)) navigate("/");
  }

  function zoneFor(e: DragEvent<HTMLElement>): DropZone {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    return y < 0.25 ? "before" : y > 0.75 ? "after" : "inside";
  }

  async function onDrop(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    const zone = zoneFor(e);
    setDrop(null);
    const draggedId = e.dataTransfer.getData(DRAG_TYPE);
    if (!draggedId || draggedId === page.id || isInside(all, page.id, draggedId)) return;
    let body: { parentId: string | null; index?: number };
    if (zone === "inside") {
      body = { parentId: page.id };
      setOpen(true);
    } else {
      const siblings = all
        .filter((p) => p.parentId === page.parentId && p.id !== draggedId)
        .sort((a, b) => a.position - b.position);
      const idx = siblings.findIndex((p) => p.id === page.id);
      body = { parentId: page.parentId, index: zone === "before" ? idx : idx + 1 };
    }
    await api(`/pages/${draggedId}/move`, { method: "POST", body }).catch((err) => alert(err.message));
    await refresh();
  }

  const dropStyle =
    drop === "inside" ? "bg-blue-100 dark:bg-blue-950" : drop === "before" ? "shadow-[inset_0_2px_0_#3b82f6]" : drop === "after" ? "shadow-[inset_0_-2px_0_#3b82f6]" : "";

  return (
    <li>
      <div
        className={`group flex items-center rounded-md pr-1 ${dropStyle}`}
        style={{ paddingLeft: depth * 12 }}
        draggable={editable}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, page.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          if (!editable || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
          e.preventDefault();
          setDrop(zoneFor(e));
        }}
        onDragLeave={() => setDrop(null)}
        onDrop={onDrop}
      >
        <button
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800"
          onClick={() => setOpen(!open)}
          aria-label={open ? "Replier" : "Déplier"}
        >
          <ChevronRight size={14} className={`transition ${open ? "rotate-90" : ""} ${children.length ? "" : "opacity-30"}`} />
        </button>
        <NavLink
          to={`/page/${page.id}`}
          className={({ isActive }) =>
            `flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-1 text-sm ${isActive ? "bg-neutral-200/80 font-medium dark:bg-neutral-800" : "hover:bg-neutral-200/50 dark:hover:bg-neutral-800/60"}`
          }
        >
          <span className="w-4 shrink-0 text-center">{page.icon ?? (page.kind === "database" ? <Database size={14} className="inline text-neutral-400" /> : <FileText size={14} className="inline text-neutral-400" />)}</span>
          <span className="truncate">{pageTitle(page.title)}</span>
        </NavLink>
        {editable && (
          <span className="hidden shrink-0 items-center group-hover:flex">
            <button className="rounded p-1 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800" onClick={trash} title="Mettre à la corbeille">
              <Trash2 size={13} />
            </button>
            <button className="rounded p-1 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800" onClick={addChild} title="Ajouter une sous-page">
              <Plus size={14} />
            </button>
          </span>
        )}
      </div>
      {open && children.length > 0 && (
        <ul>
          {children.map((c) => (
            <PageTreeItem key={c.page.id} node={c} depth={depth + 1} workspaceId={workspaceId} editable={editable} all={all} nodes={[]} />
          ))}
        </ul>
      )}
    </li>
  );
}
