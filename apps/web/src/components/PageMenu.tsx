import { useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Copy, CornerUpRight, Database, ExternalLink, FileText, Link2, Pencil, Star, Trash2 } from "lucide-react";
import { t, type PageSummary } from "@nootion/shared";
import { api } from "../lib/api";
import { copyText } from "../lib/browser";
import { keys, useFavorites, useRefreshPages } from "../lib/queries";
import { pageTitle } from "../lib/tree";
import { Popover } from "../database/Popover";
import { Modal } from "./ui";

/** Where a menu opens: under a button, or where the mouse was right-clicked. */
export type MenuAnchor = HTMLElement | { x: number; y: number };

const toElement = (a: MenuAnchor): HTMLElement =>
  a instanceof HTMLElement
    ? a
    : ({ getBoundingClientRect: () => new DOMRect(a.x, a.y, 0, 0), contains: () => false } as unknown as HTMLElement);

function Item({ icon, children, onClick, danger }: { icon: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 whitespace-nowrap rounded px-2 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 ${danger ? "text-red-600 dark:text-red-400" : ""}`}
    >
      <span className="flex w-4 shrink-0 justify-center text-neutral-500">{icon}</span>
      {children}
    </button>
  );
}

const Separator = () => <div className="my-1 h-px bg-neutral-200 dark:bg-neutral-800" />;

/**
 * The menu of a page of the sidebar (right click, or its "…" button): favorites, link, duplicate, rename, move,
 * trash, new tab.
 */
export function PageMenu({
  page,
  all,
  anchor,
  editable,
  onClose,
  onRename,
}: {
  page: PageSummary;
  /** Pages of the page's space, to choose where to move it. */
  all: PageSummary[];
  anchor: MenuAnchor;
  editable: boolean;
  onClose: () => void;
  onRename: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const refresh = useRefreshPages();
  const favorites = useFavorites();
  const [moving, setMoving] = useState(false);
  const starred = !!favorites.data?.some((p) => p.id === page.id);
  const element = useMemo(() => toElement(anchor), [anchor]);

  const run = (action: () => Promise<unknown> | void) => () => {
    onClose();
    void Promise.resolve(action()).catch((e: Error) => alert(e.message));
  };

  async function toggleFavorite() {
    qc.setQueryData<PageSummary[]>(keys.favorites, (old = []) => (starred ? old.filter((p) => p.id !== page.id) : [...old, page]));
    await api(`/favorites/${page.id}`, { method: starred ? "DELETE" : "PUT" }).catch(() => {});
    await qc.invalidateQueries({ queryKey: keys.favorites });
  }

  async function duplicate() {
    const { page: copy } = await api<{ page: PageSummary }>(`/pages/${page.id}/duplicate`, { method: "POST" });
    await refresh();
    navigate(`/page/${copy.id}`);
  }

  async function trash() {
    await api(`/pages/${page.id}`, { method: "DELETE" });
    await refresh();
    if (location.pathname.startsWith(`/page/${page.id}`)) navigate("/");
  }

  // Out of the sidebar, whose drawer would hold a fixed dialog inside it.
  if (moving) return createPortal(<MoveDialog page={page} all={all} onClose={onClose} />, document.body);
  return (
    <Popover anchor={element} onClose={onClose} width={260}>
      <div role="menu" aria-label={t("page.options")} data-page-menu>
        <Item icon={<Star size={15} className={starred ? "fill-amber-400 text-amber-400" : ""} />} onClick={run(toggleFavorite)}>
          {starred ? t("favorites.remove") : t("favorites.add")}
        </Item>
        <Separator />
        <Item icon={<Link2 size={15} />} onClick={run(() => copyText(`${location.origin}/page/${page.id}`))}>
          {t("page.copyLink")}
        </Item>
        {editable && (
          <>
            <Item icon={<Copy size={15} />} onClick={run(duplicate)}>
              {t("page.duplicate")}
            </Item>
            <Item icon={<Pencil size={15} />} onClick={run(onRename)}>
              {t("common.rename")}
            </Item>
            <Item icon={<CornerUpRight size={15} />} onClick={() => setMoving(true)}>
              {t("page.moveTo")}
            </Item>
            <Item icon={<Trash2 size={15} />} onClick={run(trash)} danger>
              {t("page.trash")}
            </Item>
          </>
        )}
        <Separator />
        <Item icon={<ExternalLink size={15} />} onClick={run(() => void window.open(`/page/${page.id}`, "_blank", "noopener"))}>
          {t("page.openNewTab")}
        </Item>
      </div>
    </Popover>
  );
}

/** Chooses the page to move a page into, in the same space, or the top of the space. */
function MoveDialog({ page, all, onClose }: { page: PageSummary; all: PageSummary[]; onClose: () => void }) {
  const refresh = useRefreshPages();
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Not into itself, its subpages, its current parent, or a database.
  const choices = useMemo(() => {
    const below = new Set([page.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const p of all) if (p.parentId && below.has(p.parentId) && !below.has(p.id)) (below.add(p.id), (grew = true));
    }
    const q = query.trim().toLocaleLowerCase();
    return all.filter((p) => !below.has(p.id) && p.id !== page.parentId && p.kind === "page" && pageTitle(p.title).toLocaleLowerCase().includes(q)).slice(0, 50);
  }, [all, page, query]);

  async function move(parentId: string | null) {
    try {
      await api(`/pages/${page.id}/move`, { method: "POST", body: { parentId } });
      await refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const row = "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800";
  return (
    <Modal title={t("page.moveTitle", { title: pageTitle(page.title) })} onClose={onClose}>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("page.moveSearch")}
        aria-label={t("page.moveSearch")}
        className="mb-2 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-900"
      />
      <div className="max-h-72 overflow-y-auto" data-move-choices>
        {page.parentId && !query && (
          <button type="button" className={row} onClick={() => void move(null)}>
            <CornerUpRight size={14} className="shrink-0 text-neutral-400" /> {t("page.moveRoot")}
          </button>
        )}
        {choices.map((p) => (
          <button key={p.id} type="button" className={row} onClick={() => void move(p.id)}>
            <span className="w-4 shrink-0 text-center">
              {p.icon ?? (p.kind === "database" ? <Database size={14} className="inline text-neutral-400" /> : <FileText size={14} className="inline text-neutral-400" />)}
            </span>
            <span className="truncate">{pageTitle(p.title)}</span>
          </button>
        ))}
        {choices.length === 0 && <p className="px-2 py-1.5 text-sm text-neutral-500">{t("page.moveNone")}</p>}
      </div>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </Modal>
  );
}
