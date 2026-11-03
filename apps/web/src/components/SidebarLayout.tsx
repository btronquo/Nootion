import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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

const WIDTH_KEY = "nootion-sidebar-width";
const DEFAULT_WIDTH = 256;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const clampWidth = (w: number) =>
  Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w)));

function readWidth() {
  try {
    const w = Number(localStorage.getItem(WIDTH_KEY));
    return w ? clampWidth(w) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

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
export function SidebarLayout({
  sidebar,
  children,
}: {
  sidebar: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [width, setWidth] = useState(readWidth);
  const [resizing, setResizing] = useState(false);
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
  const saveWidth = useCallback((w: number) => {
    try {
      localStorage.setItem(WIDTH_KEY, String(w));
    } catch {
      // Private browsing: not remembered.
    }
  }, []);
  // The edge: dragged, it resizes the sidebar; clicked, it puts it away (or docks it back), as in Notion.
  const onHandleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = width;
    let moved = false;
    let last = startWidth;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < 3) return;
      if (!moved) setResizing(true);
      moved = true;
      last = clampWidth(startWidth + ev.clientX - startX);
      setWidth(last);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      setResizing(false);
      if (moved) saveWidth(last);
      else toggle();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };
  const onHandleKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 48 : 16;
    const next =
      e.key === "ArrowLeft"
        ? width - step
        : e.key === "ArrowRight"
          ? width + step
          : e.key === "Home"
            ? MIN_WIDTH
            : e.key === "End"
              ? MAX_WIDTH
              : null;
    if (next === null) {
      if (e.key === "Enter" || e.key === " ") (e.preventDefault(), toggle());
      return;
    }
    e.preventDefault();
    const w = clampWidth(next);
    setWidth(w);
    saveWidth(w);
  };

  const state = useMemo(
    () => ({ open: () => setOpen(true), collapsed, toggle, peek }),
    [collapsed, toggle, peek],
  );

  // On phones it takes the visible height (above the browser's toolbars) and scrolls as a whole, so that its
  // footer (account, administration) can always be reached; on wide screens only its page list scrolls.
  const desktop = collapsed
    ? `md:top-12 md:bottom-3 md:rounded-r-xl md:border md:border-l-0 md:shadow-2xl ${peeking ? "md:translate-x-0" : "md:-translate-x-full"}`
    : "md:static md:z-auto md:translate-x-0 md:transition-none";
  return (
    <SidebarContext.Provider value={state}>
      {/* overflow-hidden: the fade-in nudges the page down 4px, which must not make the window scroll. */}
      <div
        className={`flex h-full overflow-hidden ${resizing ? "cursor-col-resize select-none" : ""}`}
        style={{ "--sidebar-w": `${width}px` } as React.CSSProperties}
      >
        {open && (
          <div
            className="nt-backdrop fixed inset-0 z-40 bg-black/30 md:hidden"
            onClick={() => setOpen(false)}
            aria-hidden
          />
        )}
        {/* Put away: hovering the left edge brings it out. */}
        {collapsed && (
          <div
            className="fixed inset-y-0 left-0 z-40 hidden w-2 md:block"
            onMouseEnter={() => peek(true)}
            onMouseLeave={() => peek(false)}
            aria-hidden
          />
        )}
        <aside
          aria-label={t("sidebar.label")}
          inert={collapsed && !peeking && !open ? true : undefined}
          onMouseEnter={collapsed ? () => peek(true) : undefined}
          onMouseLeave={collapsed ? () => peek(false) : undefined}
          className={`group/sidebar fixed top-0 left-0 z-50 flex h-dvh w-72 max-w-[85vw] shrink-0 flex-col overflow-y-auto border-r pb-[env(safe-area-inset-bottom)] md:h-auto md:overflow-visible md:pb-0 border-neutral-200 bg-neutral-50 transition-transform duration-200 md:w-(--sidebar-w) dark:border-neutral-800 dark:bg-neutral-950 ${open ? "translate-x-0 shadow-2xl" : "-translate-x-full"} ${desktop}`}
        >
          <button
            onClick={toggle}
            title={`${collapsed ? t("sidebar.dock") : t("sidebar.collapse")} (${isMac() ? "⌘" : "Ctrl+"}\\)`}
            aria-label={collapsed ? t("sidebar.dock") : t("sidebar.collapse")}
            data-sidebar-toggle
            className="absolute top-3 right-2 z-10 hidden rounded-md bg-neutral-50 p-1 text-neutral-500 opacity-0 transition-opacity group-hover/sidebar:opacity-100 hover:bg-neutral-200 focus-visible:opacity-100 md:block dark:bg-neutral-950 dark:hover:bg-neutral-800"
          >
            {collapsed ? (
              <ChevronsRight size={18} />
            ) : (
              <ChevronsLeft size={18} />
            )}
          </button>
          {sidebar}
          {/* The edge, to resize or put away (wide screens). */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t("sidebar.resize")}
            aria-valuemin={MIN_WIDTH}
            aria-valuemax={MAX_WIDTH}
            aria-valuenow={width}
            tabIndex={0}
            title={`${collapsed ? t("sidebar.edgeDock") : t("sidebar.edgeClose", { keys: `${isMac() ? "⌘" : "Ctrl+"}\\` })}\n${t("sidebar.edgeResize")}`}
            onPointerDown={onHandleDown}
            onKeyDown={onHandleKey}
            data-sidebar-resize
            className="group/edge absolute top-0 -right-1.5 bottom-0 z-20 hidden w-3 cursor-col-resize outline-none md:block"
          >
            <div
              className={`mx-auto h-full w-0.5 transition-colors ${resizing ? "bg-blue-500/70" : "bg-transparent group-hover/edge:bg-neutral-300 group-focus-visible/edge:bg-blue-500/70 dark:group-hover/edge:bg-neutral-700"}`}
            />
          </div>
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
      onClick={() =>
        window.matchMedia?.("(min-width: 768px)").matches
          ? ctx.toggle()
          : ctx.open()
      }
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
