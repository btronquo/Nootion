import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileText, LogOut, Settings, Users } from "lucide-react";
import type { WorkspaceSummary } from "@nootion/shared";
import { api } from "../lib/api";
import { useSession } from "../lib/session";

export function AppShell() {
  const { user, refresh } = useSession();
  const navigate = useNavigate();
  const workspaces = useQuery({ queryKey: ["workspaces"], queryFn: () => api<{ workspaces: WorkspaceSummary[] }>("/workspaces") });

  async function logout() {
    await api("/auth/logout", { method: "POST" });
    await refresh();
    navigate("/login", { replace: true });
  }

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${isActive ? "bg-neutral-200/70 font-medium dark:bg-neutral-800" : "hover:bg-neutral-200/50 dark:hover:bg-neutral-800/60"}`;

  return (
    <div className="flex h-full">
      <aside className="flex w-64 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex items-center gap-2 px-4 py-3">
          <img src="/favicon.svg" alt="" className="h-6 w-6" />
          <span className="truncate text-sm font-semibold">{user?.name}</span>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-2">
          {workspaces.data?.workspaces.map((ws) => (
            <div key={ws.id}>
              <div className="flex items-center gap-1.5 px-2 pb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
                {ws.kind === "personal" ? <FileText size={12} /> : <Users size={12} />}
                {ws.name}
              </div>
              <p className="px-2 text-xs text-neutral-400">Aucune page pour l'instant</p>
            </div>
          ))}
        </nav>
        <div className="space-y-0.5 border-t border-neutral-200 p-2 dark:border-neutral-800">
          {user?.role === "admin" && (
            <NavLink to="/admin" className={linkClass}>
              <Settings size={16} /> Administration
            </NavLink>
          )}
          <button onClick={logout} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-neutral-200/50 dark:hover:bg-neutral-800/60">
            <LogOut size={16} /> Se déconnecter
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
