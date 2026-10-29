import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Lock, MoreHorizontal, Share2, Trash2 } from "lucide-react";
import { atLeast, t, type PageDetail } from "@nootion/shared";
import { api } from "../lib/api";
import { sendOrQueue } from "../lib/offline";
import { keys, usePage, useRefreshPages } from "../lib/queries";
import { pageRoleLabel } from "../lib/labels";
import { pageTitle } from "../lib/tree";
import { Button } from "../components/ui";
import { ShareDialog } from "../components/ShareDialog";
import { IconPicker } from "../components/IconPicker";
import { PageEditor } from "../editor/PageEditor";
import { DatabaseTable } from "../database/DatabaseTable";
import { RowProperties } from "../database/RowProperties";
import { dbKey } from "../database/hooks";
import { Popover } from "../database/Popover";
import { MenuButton } from "../components/SidebarLayout";
import { SyncStatus } from "../components/SyncStatus";

export function PagePage() {
  const { id = "" } = useParams();
  const page = usePage(id);
  if (page.isLoading) return null;
  if (page.isError || !page.data) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8 sm:py-16 text-neutral-500">
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">{t("page.notFound")}</h1>
        <p className="mt-2">{t("page.notFoundHelp")}</p>
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
  const [menu, setMenu] = useState<HTMLElement | null>(null);
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

  async function save(patch: { title?: string; icon?: string | null; fullWidth?: boolean }) {
    // Kept for later when the server can't be reached.
    await sendOrQueue(`/pages/${page.id}`, patch);
    qc.setQueryData(keys.page(page.id), { ...page, ...patch });
    await qc.invalidateQueries({ queryKey: ["pages"] });
    await qc.invalidateQueries({ queryKey: keys.shared });
    if (page.kind === "database") await qc.invalidateQueries({ queryKey: dbKey(page.id) });
    if (page.kind === "row" && page.parentId) await qc.invalidateQueries({ queryKey: dbKey(page.parentId) });
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
      <header className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm max-md:sticky max-md:top-0 max-md:z-30 max-md:border-b max-md:border-neutral-200 max-md:bg-white/95 max-md:backdrop-blur sm:gap-4 md:px-4 md:py-2 dark:max-md:border-neutral-800 dark:max-md:bg-neutral-900/95">
        <nav className="flex min-w-0 items-center gap-1 text-neutral-500">
          <MenuButton />
          {page.breadcrumb.map((b) => (
            // On phones, only the parent page is shown, as a way back.
            <span key={b.id} className={`min-w-0 items-center gap-1 ${b === page.breadcrumb[page.breadcrumb.length - 1] ? "flex" : "hidden md:flex"}`}>
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
          <SyncStatus />
          <Button variant="ghost" onClick={(e) => setMenu(e.currentTarget)} title={t("page.options")} aria-label={t("page.options")}>
            <MoreHorizontal size={16} />
          </Button>
          {!canManage && (
            <span title={pageRoleLabel(page.role)} className="flex items-center gap-1 rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
              <Lock size={12} /> <span className="hidden sm:inline">{pageRoleLabel(page.role)}</span>
            </span>
          )}
          {canManage && (
            <>
              <Button variant="ghost" onClick={() => setSharing(true)} aria-label={t("share.button")}>
                <Share2 size={16} /> <span className="hidden sm:inline">{t("share.button")}</span>
              </Button>
              <Button variant="ghost" onClick={trash} title={t("page.trash")}>
                <Trash2 size={16} />
              </Button>
            </>
          )}
        </div>
      </header>

      <div className={`mx-auto px-5 pb-24 pt-8 sm:px-12 sm:pt-16 ${page.fullWidth ? "max-w-none sm:px-24" : page.kind === "database" ? "max-w-6xl" : "max-w-3xl"}`}>
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
          placeholder={t("common.untitled")}
          aria-label={t("page.titleLabel")}
          className="w-full resize-none overflow-hidden bg-transparent text-3xl font-bold sm:text-4xl outline-none placeholder:text-neutral-300 dark:placeholder:text-neutral-600"
        />
        {page.kind === "row" && page.parentId && <RowProperties databaseId={page.parentId} rowId={page.id} />}
        <div className="mt-4">
          {page.kind === "database" ? <DatabaseTable id={page.id} /> : <PageEditor page={page} canEdit={canEdit} />}
        </div>
      </div>

      {menu && (
        <Popover anchor={menu} onClose={() => setMenu(null)} width={240}>
          {canEdit && (
            <label className="flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
              {t("page.fullWidth")}
              <input type="checkbox" role="switch" className="h-4 w-4 accent-blue-600" checked={page.fullWidth} onChange={(e) => save({ fullWidth: e.target.checked })} />
            </label>
          )}
          <a
            href={`/api/pages/${page.id}/export`}
            download
            onClick={() => setMenu(null)}
            className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            {t("page.exportMarkdown")}
          </a>
        </Popover>
      )}
      {sharing && <ShareDialog page={page} onClose={() => setSharing(false)} />}
    </div>
  );
}
