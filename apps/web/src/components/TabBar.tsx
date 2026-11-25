import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { Bell, Copy, Home, Inbox, Library, ListChecks, Pin, PinOff, Plus, RefreshCw, Settings, Trash2, User, Users, Waypoints, X } from "lucide-react";
import { t, type PageSummary } from "@nootion/shared";
import {
  activate,
  close,
  follow,
  getTabs,
  insertNear,
  move,
  open,
  othersOf,
  rightOf,
  setTabsUser,
  togglePin,
  updateTabs,
  useTabs,
  type Tab,
} from "../lib/tabs";
import { fetchWorkspacePages, keys, usePage, useSharedPages, useWorkspaces } from "../lib/queries";
import { workspaceName } from "../lib/labels";
import { pageTitle } from "../lib/tree";
import { PageGlyph } from "../lib/icons";
import { Popover } from "../database/Popover";
import { toElement, type MenuAnchor } from "./PageMenu";
import { DRAG_TYPE, FAVORITE_TYPE } from "./PageTree";

const TAB_TYPE = "application/x-nootion-tab";

/** The places of the app a tab can show (not the setup assistant, public links or the API). */
const TAB_PATH = /^\/(page\/[^/]+|workspace\/[^/]+|trash|pages|graph|reminders|tasks|capture|account|sync|admin)?\/?$/;
export const isTabPath = (pathname: string) => TAB_PATH.test(pathname);

const here = () => location.pathname + location.search;

/**
 * Opens a place of the app in a new tab, in the background as in browsers (Ctrl+click, middle click, "Open in a new
 * tab"): the page on screen stays, and the new tab is a click away.
 */
export function openInTab(path: string) {
  updateTabs((s) => open(s, path, { background: true, current: here() }));
}

/**
 * Keeps the tabs in step with the app: the account whose tabs they are, the current tab following the links, and,
 * while the bar is on, Ctrl+click or a middle click on a link of the app opening it in a new tab instead of the
 * browser's.
 */
export function useTabsSync(userId: string | undefined) {
  setTabsUser(userId ?? null);
  const { enabled } = useTabs();
  const location = useLocation();
  const navigate = useNavigate();
  const path = location.pathname + location.search;
  const arrived = useRef(false);

  useEffect(() => {
    if (!enabled || !isTabPath(location.pathname)) return;
    if (!arrived.current) {
      arrived.current = true;
      const s = getTabs();
      const current = s.tabs.find((tab) => tab.id === s.active);
      // The installed app opens at the home page: it comes back to the tab shown last time.
      if (location.pathname === "/" && !location.search && current && current.path !== "/") {
        navigate(current.path, { replace: true });
        return;
      }
      // A link opened from elsewhere: its tab, or a new one, without replacing the page of the tab shown last time.
      if (current && current.path !== path) {
        const existing = s.tabs.find((tab) => tab.path === path);
        updateTabs((st) => (existing ? activate(st, existing.id) : open(st, path)));
        return;
      }
    }
    updateTabs((s) => follow(s, path));
  }, [enabled, path, location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!enabled) return;
    const linkOf = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.hasAttribute("download") || a.origin !== window.location.origin || !isTabPath(a.pathname)) return null;
      return a;
    };
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      const a = linkOf(e);
      if (!a) return;
      e.preventDefault();
      openInTab(a.pathname + a.search);
    };
    const onAux = (e: MouseEvent) => {
      if (e.button !== 1) return;
      const a = linkOf(e);
      if (!a) return;
      e.preventDefault();
      openInTab(a.pathname + a.search);
    };
    // Captured before the links' own handlers, which would follow them.
    document.addEventListener("click", onClick, true);
    document.addEventListener("auxclick", onAux, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("auxclick", onAux, true);
    };
  }, [enabled]);
}

/** Titles and icons of the pages, from the lists the sidebar already has. */
function usePageSummaries() {
  const workspaces = useWorkspaces().data ?? [];
  const shared = useSharedPages().data;
  const lists = useQueries({
    queries: workspaces.map((ws) => ({ queryKey: keys.pages(ws.id), queryFn: () => fetchWorkspacePages(ws.id) })),
  });
  // Drawn again only when a list changes.
  const version = lists.map((l) => l.dataUpdatedAt).join();
  return useMemo(() => {
    const map = new Map<string, PageSummary>();
    for (const list of [...lists.map((l) => l.data), shared]) for (const page of list ?? []) map.set(page.id, page);
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared, version]);
}

/** What a tab shows: its title and icon. */
function usePlace(path: string, pages: Map<string, PageSummary>): { title: string; icon: ReactNode } {
  const pathname = path.split("?")[0]!;
  const pageId = /^\/page\/([^/]+)/.exec(pathname)?.[1] ?? "";
  const known = pages.get(pageId);
  // Pages not in the sidebar (a database's rows): fetched on their own.
  const detail = usePage(pageId, !!pageId && !known).data;
  const workspaces = useWorkspaces().data;
  const icon = (node: ReactNode) => <span className="flex w-4 shrink-0 justify-center text-neutral-500">{node}</span>;
  if (pageId) {
    const page = known ?? detail;
    return {
      title: page ? pageTitle(page.title) : "…",
      icon: <span className="w-4 shrink-0 text-center">{page ? <PageGlyph icon={page.icon} kind={page.kind} /> : null}</span>,
    };
  }
  const spaceId = /^\/workspace\/([^/]+)/.exec(pathname)?.[1];
  if (spaceId) {
    const ws = workspaces?.find((w) => w.id === spaceId);
    return { title: ws ? workspaceName(ws) : t("workspace.settings"), icon: icon(<Users size={14} />) };
  }
  const places: Record<string, [string, ReactNode]> = {
    "/": [t("home.title"), <Home size={14} key="i" />],
    "/tasks": [t("tasks.title"), <ListChecks size={14} key="i" />],
    "/pages": [t("library.title"), <Library size={14} key="i" />],
    "/graph": [t("graph.title"), <Waypoints size={14} key="i" />],
    "/reminders": [t("reminders.title"), <Bell size={14} key="i" />],
    "/trash": [t("trash.title"), <Trash2 size={14} key="i" />],
    "/capture": [t("inbox.capture"), <Inbox size={14} key="i" />],
    "/account": [t("account.title"), <User size={14} key="i" />],
    "/sync": [t("sync.title"), <RefreshCw size={14} key="i" />],
    "/admin": [t("admin.title"), <Settings size={14} key="i" />],
  };
  const [title, glyph] = places[pathname.replace(/(.)\/$/, "$1")] ?? [pathname, null];
  return { title, icon: icon(glyph) };
}

/**
 * The tab bar, over the content (wide screens), shown once turned on in "Account › Appearance". A tab is chosen by a
 * click, closed by its cross or a middle click, dragged to reorder (among the pinned ones, it is pinned), and pinned
 * or closed with others from its menu (right click). A page dragged from the sidebar opens in a new tab where dropped.
 */
export function TabBar() {
  const { enabled, tabs, active } = useTabs();
  const navigate = useNavigate();
  const pages = usePageSummaries();
  const [drop, setDrop] = useState<{ id: string | null; after: boolean } | null>(null);
  const [menu, setMenu] = useState<{ tab: Tab; anchor: MenuAnchor } | null>(null);
  const strip = useRef<HTMLDivElement>(null);

  // The app goes to the tab now shown, if it isn't there already.
  const show = useCallback(
    (change: Parameters<typeof updateTabs>[0]) => {
      updateTabs(change);
      const s = getTabs();
      const tab = s.tabs.find((x) => x.id === s.active);
      const target = tab?.path ?? "/";
      if (target !== here()) navigate(target);
    },
    [navigate],
  );

  // The tab shown stays in sight when there are many.
  useLayoutEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>(`[data-tab="${active}"]`);
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [active, tabs.length]);

  if (!enabled) return null;

  const dropSide = (e: React.DragEvent) => {
    const box = e.currentTarget.getBoundingClientRect();
    return e.clientX > box.left + box.width / 2;
  };
  const accepts = (e: React.DragEvent) =>
    e.dataTransfer.types.includes(TAB_TYPE) || e.dataTransfer.types.includes(DRAG_TYPE) || e.dataTransfer.types.includes(FAVORITE_TYPE);
  const onDrop = (e: React.DragEvent, target: string | null, after: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    setDrop(null);
    const moved = e.dataTransfer.getData(TAB_TYPE);
    if (moved) return updateTabs((s) => move(s, moved, target, after));
    const pageId = e.dataTransfer.getData(DRAG_TYPE) || e.dataTransfer.getData(FAVORITE_TYPE);
    if (pageId) show((s) => insertNear(s, `/page/${pageId}`, target, after, here()));
  };

  return (
    <div
      role="tablist"
      aria-label={t("tabs.label")}
      data-tab-bar
      className="print:hidden hidden h-10 shrink-0 items-center gap-1 border-b border-neutral-200 bg-neutral-50 pr-2 pl-2 md:flex dark:border-neutral-800 dark:bg-neutral-950"
      onDragOver={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        if (e.target === e.currentTarget) setDrop({ id: null, after: true });
      }}
      onDragLeave={(e) => e.target === e.currentTarget && setDrop(null)}
      onDrop={(e) => onDrop(e, null, true)}
      onDoubleClick={(e) => e.target === e.currentTarget && show((s) => open(s, "/", { current: here() }))}
    >
      <div ref={strip} className="thin-scroll flex min-w-0 items-center gap-1 overflow-x-auto py-1">
        {tabs.map((tab, i) => (
          <TabItem
            key={tab.id}
            tab={tab}
            pages={pages}
            active={tab.id === active}
            // A thin line between two tabs, except next to the one shown, as in browsers.
            divider={i > 0 && tab.id !== active && tabs[i - 1]!.id !== active}
            dropLine={drop?.id === tab.id ? (drop.after ? "after" : "before") : null}
            onSelect={() => show((s) => activate(s, tab.id))}
            onClose={() => show((s) => close(s, [tab.id]))}
            onMenu={(anchor) => setMenu({ tab, anchor })}
            onDragOver={(e) => {
              if (!accepts(e)) return;
              e.preventDefault();
              e.stopPropagation();
              setDrop({ id: tab.id, after: dropSide(e) });
            }}
            onDrop={(e) => onDrop(e, tab.id, dropSide(e))}
          />
        ))}
        {drop?.id === null && <span className="h-5 w-0.5 shrink-0 rounded bg-blue-500" aria-hidden />}
      </div>
      <button
        onClick={() => show((s) => open(s, "/", { current: here() }))}
        title={t("tabs.new")}
        aria-label={t("tabs.new")}
        data-tab-new
        className="shrink-0 rounded-md p-1 text-neutral-500 hover:bg-neutral-200/70 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
      >
        <Plus size={16} />
      </button>
      {menu && (
        <TabMenu
          tab={menu.tab}
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          show={show}
        />
      )}
    </div>
  );
}

function TabItem({
  tab,
  pages,
  active,
  divider,
  dropLine,
  onSelect,
  onClose,
  onMenu,
  onDragOver,
  onDrop,
}: {
  tab: Tab;
  pages: Map<string, PageSummary>;
  active: boolean;
  divider: boolean;
  dropLine: "before" | "after" | null;
  onSelect: () => void;
  onClose: () => void;
  onMenu: (anchor: MenuAnchor) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const { title, icon } = usePlace(tab.path, pages);
  const line = dropLine === "before" ? "shadow-[inset_2px_0_0_0] shadow-blue-500" : dropLine === "after" ? "shadow-[inset_-2px_0_0_0] shadow-blue-500" : "";
  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      title={title}
      draggable
      data-tab={tab.id}
      data-tab-pinned={tab.pinned || undefined}
      data-tab-active={active || undefined}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") (e.preventDefault(), onSelect());
        if (e.key === "Delete" && !tab.pinned) (e.preventDefault(), onClose());
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          const sibling = (e.key === "ArrowRight" ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling) as HTMLElement | null;
          if (sibling?.dataset.tab) (e.preventDefault(), sibling.click(), sibling.focus());
        }
      }}
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        onClose();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu({ x: e.clientX, y: e.clientY });
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData(TAB_TYPE, tab.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`group relative flex h-7 shrink-0 cursor-default select-none items-center gap-1.5 rounded-md text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-500/60 duration-(--nt-dur-fast) ${
        tab.pinned ? "w-9 justify-center" : "w-[clamp(7rem,14vw,13rem)] pr-1 pl-2"
      } ${
        active
          ? "bg-white font-medium text-neutral-900 shadow-sm ring-1 ring-neutral-200 dark:bg-neutral-800 dark:text-neutral-100 dark:ring-neutral-700"
          : "text-neutral-600 hover:bg-neutral-200/60 dark:text-neutral-400 dark:hover:bg-neutral-800/60"
      } ${line}`}
    >
      {divider && <span className="pointer-events-none absolute top-1.5 bottom-1.5 -left-[3px] w-px bg-neutral-200 group-hover:opacity-0 dark:bg-neutral-800" aria-hidden />}
      {icon}
      {!tab.pinned && (
        <>
          <span className="min-w-0 flex-1 truncate">{title}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            title={t("tabs.close")}
            aria-label={t("tabs.close")}
            data-tab-close
            tabIndex={-1}
            className={`shrink-0 rounded p-0.5 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-700 dark:hover:text-neutral-200 ${active ? "visible" : "invisible group-hover:visible"}`}
          >
            <X size={13} />
          </button>
        </>
      )}
    </div>
  );
}

function TabMenu({
  tab,
  anchor,
  onClose,
  show,
}: {
  tab: Tab;
  anchor: MenuAnchor;
  onClose: () => void;
  show: (change: Parameters<typeof updateTabs>[0]) => void;
}) {
  const element = useMemo(() => toElement(anchor), [anchor]);
  const s = getTabs();
  const others = othersOf(s, tab.id);
  const right = rightOf(s, tab.id);
  const run = (action: () => void) => () => {
    onClose();
    action();
  };
  const item = "flex w-full items-center gap-2 whitespace-nowrap rounded px-2 py-1.5 text-left hover:bg-neutral-100 disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-neutral-800";
  return (
    <Popover anchor={element} onClose={onClose} width={240}>
      <div role="menu" aria-label={t("tabs.label")} data-tab-menu>
        <button role="menuitem" className={item} onClick={run(() => updateTabs((st) => togglePin(st, tab.id)))}>
          <span className="flex w-4 justify-center text-neutral-500">{tab.pinned ? <PinOff size={15} /> : <Pin size={15} />}</span>
          {tab.pinned ? t("tabs.unpin") : t("tabs.pin")}
        </button>
        <button role="menuitem" className={item} onClick={run(() => show((st) => open(activate(st, tab.id), tab.path)))}>
          <span className="flex w-4 justify-center text-neutral-500">
            <Copy size={15} />
          </span>
          {t("tabs.duplicate")}
        </button>
        <div className="my-1 h-px bg-neutral-200 dark:bg-neutral-800" />
        <button role="menuitem" className={item} onClick={run(() => show((st) => close(st, [tab.id])))}>
          <span className="flex w-4 justify-center text-neutral-500">
            <X size={15} />
          </span>
          {t("tabs.close")}
        </button>
        <button role="menuitem" className={item} disabled={!others.length} onClick={run(() => show((st) => close(activate(st, tab.id), others)))}>
          <span className="w-4" />
          {t("tabs.closeOthers")}
        </button>
        <button role="menuitem" className={item} disabled={!right.length} onClick={run(() => show((st) => close(st, right)))}>
          <span className="w-4" />
          {t("tabs.closeRight")}
        </button>
      </div>
    </Popover>
  );
}
