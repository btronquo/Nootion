import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Lock, Share2, Trash2 } from "lucide-react";
import { atLeast, type PageDetail } from "@nootion/shared";
import { api } from "../lib/api";
import { keys, usePage, useRefreshPages } from "../lib/queries";
import { PAGE_ROLE_LABELS } from "../lib/labels";
import { pageTitle } from "../lib/tree";
import { Button } from "../components/ui";
import { ShareDialog } from "../components/ShareDialog";
import { IconPicker } from "../components/IconPicker";
import { PageEditor } from "../editor/PageEditor";

export function PagePage() {
  const { id = "" } = useParams();
  const page = usePage(id);
  if (page.isLoading) return null;
  if (page.isError || !page.data) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-16 text-neutral-500">
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Page introuvable</h1>
        <p className="mt-2">Elle n'existe pas, a été mise à la corbeille, ou ne vous a pas été partagée.</p>
      </div>
    );
  }
  return <PageView key={page.data.id} page={page.data} />;
}

function PageView({ page }: { page: PageDetail }) {
  const canEdit = atLeast(page.role, "editor");
  const canManage = page.role === "full";
  const [title, setTitle] = useState(page.title);
  const [sharing, setSharing] = useState(false);
  const qc = useQueryClient();
  const refresh = useRefreshPages();
  const navigate = useNavigate();
  const saveTimer = useRef<number | undefined>(undefined);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (canEdit && !page.title) titleRef.current?.focus();
  }, [canEdit, page.title]);

  useEffect(() => {
    const el = titleRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [title]);

  async function save(patch: { title?: string; icon?: string | null }) {
    await api(`/pages/${page.id}`, { method: "PATCH", body: patch });
    qc.setQueryData(keys.page(page.id), { ...page, ...patch });
    await qc.invalidateQueries({ queryKey: ["pages"] });
    await qc.invalidateQueries({ queryKey: keys.shared });
  }

  function onTitleChange(value: string) {
    setTitle(value);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => save({ title: value }), 400);
  }

  async function trash() {
    await api(`/pages/${page.id}`, { method: "DELETE" });
    await refresh();
    navigate("/");
  }

  return (
    <div>
      <header className="flex items-center justify-between gap-4 px-4 py-2 text-sm">
        <nav className="flex min-w-0 items-center gap-1 text-neutral-500">
          {page.breadcrumb.map((b) => (
            <span key={b.id} className="flex min-w-0 items-center gap-1">
              <Link to={`/page/${b.id}`} className="truncate rounded px-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                {b.icon} {pageTitle(b.title)}
              </Link>
              <ChevronRight size={14} className="shrink-0" />
            </span>
          ))}
          <span className="truncate px-1 text-neutral-800 dark:text-neutral-200">
            {page.icon} {pageTitle(title)}
          </span>
        </nav>
        <div className="flex shrink-0 items-center gap-1">
          {!canManage && (
            <span className="flex items-center gap-1 rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
              <Lock size={12} /> {PAGE_ROLE_LABELS[page.role]}
            </span>
          )}
          {canManage && (
            <>
              <Button variant="ghost" onClick={() => setSharing(true)}>
                <Share2 size={16} /> Partager
              </Button>
              <Button variant="ghost" onClick={trash} title="Mettre à la corbeille">
                <Trash2 size={16} />
              </Button>
            </>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-12 pb-24 pt-16">
        <IconPicker icon={page.icon} editable={canEdit} onChange={(icon) => save({ icon })} />
        <textarea
          ref={titleRef}
          rows={1}
          value={title}
          readOnly={!canEdit}
          onChange={(e) => onTitleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              document.querySelector<HTMLElement>(".nootion-content")?.focus();
            }
          }}
          placeholder="Sans titre"
          aria-label="Titre de la page"
          className="w-full resize-none overflow-hidden bg-transparent text-4xl font-bold outline-none placeholder:text-neutral-300 dark:placeholder:text-neutral-600"
        />
        <div className="mt-4">
          <PageEditor page={page} canEdit={canEdit} />
        </div>
      </div>

      {sharing && <ShareDialog page={page} onClose={() => setSharing(false)} />}
    </div>
  );
}
