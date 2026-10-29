import { useCallback, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Plus, Settings, Share2, Trash2, Users, User, Download, Search } from "lucide-react";
import { t, type PageSummary, type WorkspaceSummary } from "@nootion/shared";
import { workspaceName } from "../lib/labels";
import { api } from "../lib/api";
import { keys, useRefreshPages, useSharedPages, useWorkspacePages, useWorkspaces } from "../lib/queries";
import { useSession } from "../lib/session";
import { buildTree } from "../lib/tree";
import { PageTree } from "./PageTree";
import { Avatar } from "./Avatar";
import { Button, ErrorText, Field, Modal } from "./ui";
import { usePlugins } from "../plugins/registry";
import { SearchDialog, useSearchShortcut } from "./SearchDialog";

export function AppShell() {
  const { user, refresh } = useSession();
  const navigate = useNavigate();
  const workspaces = useWorkspaces();
  // Loaded ahead: page editors wait for the plugins' blocks before opening.
  usePlugins();
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [searching, setSearching] = useState(false);
  useSearchShortcut(useCallback(() => setSearching(true), []));

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
        <Link to="/account" title={t("account.title")} className="m-2 flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/60">
          <Avatar name={user?.name ?? ""} url={user?.avatarUrl} size={26} />
          <span className="truncate text-sm font-semibold">{user?.name}</span>
        </Link>
        <button
          onClick={() => setSearching(true)}
          className="mx-2 mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-neutral-600 hover:bg-neutral-200/50 dark:text-neutral-400 dark:hover:bg-neutral-800/60"
        >
          <Search size={16} /> {t("search.button")}
          <kbd className="ml-auto rounded border border-neutral-300 px-1 font-sans text-[10px] text-neutral-400 dark:border-neutral-700">
            {/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K"}
          </kbd>
        </button>
        <nav className="flex-1 space-y-5 overflow-y-auto px-2 py-2">
          {workspaces.data?.map((ws) => <WorkspaceSection key={ws.id} workspace={ws} />)}
          <SharedSection />
          <button
            onClick={() => setCreatingWorkspace(true)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-neutral-500 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/60"
          >
            <Plus size={16} /> {t("workspace.new")}
          </button>
        </nav>
        <div className="space-y-0.5 border-t border-neutral-200 p-2 dark:border-neutral-800">
          <NavLink to="/trash" className={linkClass}>
            <Trash2 size={16} /> {t("trash.title")}
          </NavLink>
          <NavLink to="/account" className={linkClass}>
            <User size={16} /> {t("account.title")}
          </NavLink>
          {user?.role === "admin" && (
            <NavLink to="/admin" className={linkClass}>
              <Settings size={16} /> {t("admin.title")}
            </NavLink>
          )}
          <button onClick={logout} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-neutral-200/50 dark:hover:bg-neutral-800/60">
            <LogOut size={16} /> {t("auth.logout")}
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
      {creatingWorkspace && <CreateWorkspaceDialog onClose={() => setCreatingWorkspace(false)} />}
      {searching && <SearchDialog onClose={() => setSearching(false)} />}
    </div>
  );
}

function SectionHeader({ icon, label, children }: { icon: React.ReactNode; label: string; children?: React.ReactNode }) {
  return (
    <div className="group flex items-center justify-between px-2 pb-1">
      <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-neutral-500">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      <span className="flex items-center gap-0.5">{children}</span>
    </div>
  );
}

function WorkspaceSection({ workspace }: { workspace: WorkspaceSummary }) {
  const pages = useWorkspacePages(workspace.id);
  const navigate = useNavigate();
  const refresh = useRefreshPages();
  const canEdit = workspace.role === "owner" || workspace.role === "editor";

  async function addPage() {
    const res = await api<{ page: PageSummary }>("/pages", { method: "POST", body: { workspaceId: workspace.id, parentId: null, title: "" } });
    await refresh();
    navigate(`/page/${res.page.id}`);
  }

  const iconBtn = "rounded p-0.5 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800";
  return (
    <div>
      <SectionHeader icon={workspace.kind === "personal" ? <User size={12} /> : <Users size={12} />} label={workspaceName(workspace)}>
        {workspace.kind === "shared" && (
          <Link to={`/workspace/${workspace.id}`} className={iconBtn} title={t("workspace.settings")}>
            <Settings size={13} />
          </Link>
        )}
        <a href={`/api/workspaces/${workspace.id}/export`} download className={iconBtn} title={t("workspace.export")}>
          <Download size={13} />
        </a>
        {canEdit && (
          <button onClick={addPage} className={iconBtn} title={t("page.new")}>
            <Plus size={14} />
          </button>
        )}
      </SectionHeader>
      {pages.data && <PageTree nodes={buildTree(pages.data)} all={pages.data} workspaceId={workspace.id} editable={canEdit} />}
    </div>
  );
}

function SharedSection() {
  const shared = useSharedPages();
  if (!shared.data?.length) return null;
  return (
    <div>
      <SectionHeader icon={<Share2 size={12} />} label={t("sidebar.shared")} />
      <PageTree nodes={buildTree(shared.data)} all={shared.data} workspaceId="" editable={false} />
    </div>
  );
}

function CreateWorkspaceDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<unknown>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();
  return (
    <Modal title={t("workspace.new")} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const res = await api<{ workspace: WorkspaceSummary }>("/workspaces", { method: "POST", body: { name } });
            await qc.invalidateQueries({ queryKey: keys.workspaces });
            onClose();
            navigate(`/workspace/${res.workspace.id}`);
          } catch (err) {
            setError(err);
          }
        }}
      >
        <Field label={t("workspace.name")} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("workspace.namePlaceholder")} required autoFocus />
        <p className="text-sm text-neutral-500">{t("workspace.newHelp")}</p>
        <ErrorText error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit">{t("common.create")}</Button>
        </div>
      </form>
    </Modal>
  );
}
