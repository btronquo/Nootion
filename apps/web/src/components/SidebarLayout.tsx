import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Menu } from "lucide-react";
import { t } from "@nootion/shared";

const SidebarContext = createContext<{ open: () => void } | null>(null);

/**
 * Sidebar next to the content on wide screens. On phones it slides in over the content
 * from the menu button, and closes when a link is followed.
 */
export function SidebarLayout({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <SidebarContext.Provider value={{ open: () => setOpen(true) }}>
      <div className="flex h-full">
        {open && <div className="fixed inset-0 z-40 bg-black/30 md:hidden" onClick={() => setOpen(false)} aria-hidden />}
        <aside
          aria-label={t("sidebar.label")}
          className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] shrink-0 flex-col border-r border-neutral-200 bg-neutral-50 transition-transform duration-200 md:static md:z-auto md:w-64 md:translate-x-0 md:transition-none dark:border-neutral-800 dark:bg-neutral-950 ${open ? "translate-x-0 shadow-2xl" : "-translate-x-full"}`}
        >
          {sidebar}
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </SidebarContext.Provider>
  );
}

/** Opens the sidebar on phones; hidden on wide screens, where the sidebar is always shown. */
export function MenuButton({ className = "" }: { className?: string }) {
  const ctx = useContext(SidebarContext);
  if (!ctx) return null;
  return (
    <button
      onClick={ctx.open}
      aria-label={t("sidebar.open")}
      className={`-ml-1 rounded-md p-2 text-neutral-600 hover:bg-neutral-100 md:hidden dark:text-neutral-300 dark:hover:bg-neutral-800 ${className}`}
    >
      <Menu size={20} />
    </button>
  );
}

/** Top bar of the pages that have no header of their own, shown on phones only. */
export function MobileBar({ children }: { children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 flex items-center gap-1 border-b border-neutral-200 bg-white/95 px-3 py-1.5 backdrop-blur md:hidden dark:border-neutral-800 dark:bg-neutral-900/95">
      <MenuButton />
      <span className="flex-1" />
      {children}
    </header>
  );
}
