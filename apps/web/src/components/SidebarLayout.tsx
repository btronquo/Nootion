import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { ChevronsLeft, ChevronsRight, Menu } from "lucide-react";
import { isMac } from "./QuickCapture";
import { t } from "@nootion/shared";

interface SidebarState {
  /** Opens the drawer on phones. */
  open: () => void;
  /** Wide screens: the sidebar is put away, and shows over the content while hovered. */
  collapsed: boolean;
  toggle: () => void;
  peek: (on: boolean) => void;
}
const SidebarContext = createContext<SidebarState | null>(null);
const COLLAPSED_KEY = "nootion-sidebar-collapsed";

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Sidebar next to the content on wide screens, which can be put away (« or Ctrl+\) and then shows over the content
 * when the menu button or the left edge is hovered, as in Notion. On phones it slides in over the content from the
 * menu button, and closes when a link is followed.
 */
export function SidebarLayout({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [peeking, setPeeking] = useState(false);
  const hideTimer = useRef<number | undefined>(undefined);
  const location = useLocation();
  const main = useRef<HTMLElement>(null);
  useEffect(() => setOpen(false), [location.pathname]);
  // A gentle fade when moving to another page; nothing is remounted for it.
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    main.current?.animate?.(
      [
        { opacity: 0, transform: "translateY(4px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 240, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
    );
  }, [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const toggle = useCallback(() => {
    setPeeking(false);
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, c ? "0" : "1");
      } catch {
        // Private browsing: not remembered.
      }
      return !c;
    });
  }, []);
  // Ctrl+\ (⌘\ on a Mac), as in Notion.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "\\") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);
  // Leaving it hides it a moment later, so that the mouse can go from the button to the sidebar.
  const peek = useCallback((on: boolean) => {
    window.clearTimeout(hideTimer.current);
    if (on) setPeeking(true);
    else hideTimer.current = window.setTimeout(() => setPeeking(false), 300);
  }, []);
  // Following a link from it puts it away.
  useEffect(() => setPeeking(false), [location.pathname]);
  const state = useMemo(() => ({ open: () => setOpen(true), collapsed, toggle, peek }), [collapsed, toggle, peek]);

  const desktop = collapsed
    ? `md:top-12 md:bottom-3 md:rounded-r-xl md:border md:border-l-0 md:shadow-2xl ${peeking ? "md:translate-x-0" : "md:-translate-x-full"}`
    : "md:static md:z-auto md:translate-x-0 md:transition-none";
  return (
    <SidebarContext.Provider value={state}>
      <div className="flex h-full">
        {open && <div className="nt-backdrop fixed inset-0 z-40 bg-black/30 md:hidden" onClick={() => setOpen(false)} aria-hidden />}
        {/* Put away: hovering the left edge brings it out. */}
        {collapsed && (
          <div className="fixed inset-y-0 left-0 z-40 hidden w-2 md:block" onMouseEnter={() => peek(true)} onMouseLeave={() => peek(false)} aria-hidden />
        )}
        <aside
          aria-label={t("sidebar.label")}
          inert={collapsed && !peeking && !open ? true : undefined}
          onMouseEnter={collapsed ? () => peek(true) : undefined}
          onMouseLeave={collapsed ? () => peek(false) : undefined}
          className={`group/sidebar fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] shrink-0 flex-col border-r border-neutral-200 bg-neutral-50 transition-transform duration-200 md:w-64 dark:border-neutral-800 dark:bg-neutral-950 ${open ? "translate-x-0 shadow-2xl" : "-translate-x-full"} ${desktop}`}
        >
          <button
            onClick={toggle}
            title={`${collapsed ? t("sidebar.dock") : t("sidebar.collapse")} (${isMac() ? "⌘" : "Ctrl+"}\\)`}
            aria-label={collapsed ? t("sidebar.dock") : t("sidebar.collapse")}
            data-sidebar-toggle
            className="absolute top-3 right-2 z-10 hidden rounded-md bg-neutral-50 p-1 text-neutral-500 opacity-0 transition-opacity group-hover/sidebar:opacity-100 hover:bg-neutral-200 focus-visible:opacity-100 md:block dark:bg-neutral-950 dark:hover:bg-neutral-800"
          >
            {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
          </button>
          {sidebar}
        </aside>
        <main ref={main} className="min-w-0 flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </SidebarContext.Provider>
  );
}

/** Opens the sidebar: the drawer on phones; on wide screens, shown only when the sidebar is put away. */
export function MenuButton({ className = "" }: { className?: string }) {
  const ctx = useContext(SidebarContext);
  if (!ctx) return null;
  return (
    <button
      onClick={() => (window.matchMedia?.("(min-width: 768px)").matches ? ctx.toggle() : ctx.open())}
      onMouseEnter={() => ctx.collapsed && ctx.peek(true)}
      onMouseLeave={() => ctx.collapsed && ctx.peek(false)}
      aria-label={t("sidebar.open")}
      data-menu-button
      className={`-ml-1 rounded-md p-2 text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800 ${ctx.collapsed ? "" : "md:hidden"} ${className}`}
    >
      <Menu size={20} />
    </button>
  );
}

/** Top bar of the pages that have no header of their own, shown on phones. */
export function MobileBar({ children }: { children?: ReactNode }) {
  // Also on wide screens while the sidebar is put away, for its menu button.
  const collapsed = useContext(SidebarContext)?.collapsed;
  return (
    <header
      className={`sticky top-0 z-30 flex items-center gap-1 border-b border-neutral-200 bg-white/95 px-3 py-1.5 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95 ${collapsed ? "md:border-b-0" : "md:hidden"}`}
    >
      <MenuButton />
      <span className="flex-1" />
      {children}
    </header>
  );
}
