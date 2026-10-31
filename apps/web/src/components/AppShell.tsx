import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useMatch, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Plus, Settings, Share2, Trash2, Users, User, Download, Search, Star, X, Database, FileText, Home, Bell, Inbox } from "lucide-react";
import { disablePush, useReminderNotifications, useReminders } from "../lib/reminders";
import { useCommentNotifications } from "../comments/queries";
import { t, type PageSummary, type WorkspaceSummary } from "@nootion/shared";
import { workspaceName } from "../lib/labels";
import { api, isOfflineError } from "../lib/api";
import { keys, useFavorites, useRefreshPages, useSharedPages, useWorkspacePages, useWorkspaces } from "../lib/queries";
import { useSession } from "../lib/session";
import { buildTree, pageTitle } from "../lib/tree";
import { DRAG_TYPE, PageTree } from "./PageTree";
import { Avatar } from "./Avatar";
import { Button, CancelButton, ErrorText, Field, Modal } from "./ui";
import { usePlugins } from "../plugins/registry";
import { SearchDialog, useSearchShortcut } from "./SearchDialog";
import { captureShortcutLabel, QuickCaptureDialog, useCaptureShortcut } from "./QuickCapture";
import { MobileBar, SidebarLayout } from "./SidebarLayout";
import { useIsTouch } from "../lib/mobile";
import { clearOfflineData } from "../lib/offline";
import { SyncStatus } from "./SyncStatus";
import { useLiveEvents } from "../lib/live";

export function AppShell() {
  const { user, refresh } = useSession();
  const navigate = useNavigate();
  const workspaces = useWorkspaces();
  // Loaded ahead: page editors wait for the plugins' blocks before opening.
  usePlugins();
  useLiveEvents(!!user);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [searching, setSearching] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const touch = useIsTouch();
  // Pages have their own header, with the menu button.
  // Pages (and the home page) have their own header with the menu button.
  const onPageRoute = useMatch("/page/:id");
  const onHome = useMatch({ path: "/", end: true });
  const onPage = onPageRoute || onHome;
  useSearchShortcut(useCallback(() => setSearching(true), []));
  useCaptureShortcut(useCallback(() => setCapturing(true), []));
  // "Capture" from the installed app's icon menu opens "/?capture".
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (!params.has("capture")) return;
    setCapturing(true);
    setParams((p) => (p.delete("capture"), p), { replace: true });
  }, [params, setParams]);
  useReminderNotifications();
  // Reminders due and unread mentions or replies.
  const due = (useReminders().data?.filter((r) => r.due).length ?? 0) + (useCommentNotifications().data?.filter((n) => !n.read).length ?? 0);

  async function logout() {
    // This device stops receiving the account's reminders.
    await disablePush().catch(() => {});
    try {
      await api("/auth/logout", { method: "POST" });
    } catch (e) {
      if (!isOfflineError(e)) throw e;
      return alert(e.message);
    }
    // Nothing of this account stays on the device.
    await clearOfflineData();
    await refresh();
    navigate("/login", { replace: true });
  }

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${isActive ? "bg-neutral-200/70 font-medium dark:bg-neutral-800" : "hover:bg-neutral-200/50 dark:hover:bg-neutral-800/60"}`;

  const sidebar = (
    <>
      <Link
        to="/account"
        title={t("account.title")}
        className="m-2 flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/60"
      >
        <Avatar name={user?.name ?? ""} url={user?.avatarUrl} size={26} />
        <span className="truncate text-sm font-semibold">{user?.name}</span>
      </Link>
      <SyncStatus className="mx-3 mb-2 w-fit" />
      <button
        onClick={() => setSearching(true)}
        className="mx-2 mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-neutral-600 hover:bg-neutral-200/50 dark:text-neutral-400 dark:hover:bg-neutral-800/60"
      >
        <Search size={16} /> {t("search.button")}
        {!touch && (
          <kbd className="ml-auto rounded border border-neutral-300 px-1 font-sans text-[10px] text-neutral-400 dark:border-neutral-700">
            {/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K"}
          </kbd>
        )}
      </button>
      <button
        onClick={() => setCapturing(true)}
        className="mx-2 mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-neutral-600 hover:bg-neutral-200/50 dark:text-neutral-400 dark:hover:bg-neutral-800/60"
        data-quick-capture-button
      >
        <Inbox size={16} /> {t("inbox.capture")}
        {!touch && (
          <kbd className="ml-auto rounded border border-neutral-300 px-1 font-sans text-[10px] text-neutral-400 dark:border-neutral-700">{captureShortcutLabel()}</kbd>
        )}
      </button>
      <NavLink
        to="/"
        end
        className={({ isActive }) =>
          `mx-2 mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-neutral-200/50 dark:hover:bg-neutral-800/60 ${isActive ? "bg-neutral-200/70 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100" : "text-neutral-600 dark:text-neutral-400"}`
        }
      >
        <Home size={16} /> {t("home.title")}
      </NavLink>
      <NavLink
        to="/reminders"
        className={({ isActive }) =>
          `mx-2 mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-neutral-200/50 dark:hover:bg-neutral-800/60 ${isActive ? "bg-neutral-200/70 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100" : "text-neutral-600 dark:text-neutral-400"}`
        }
      >
        <Bell size={16} /> {t("reminders.title")}
        {due > 0 && (
          <span className="ml-auto rounded-full bg-red-600 px-1.5 text-[11px] font-semibold leading-[18px] text-white" data-reminders-due>
            {due}
          </span>
        )}
      </NavLink>
      <nav className="flex-1 space-y-5 overflow-y-auto px-2 py-2">
        <FavoritesSection />
        {workspaces.data?.map((ws) => (
          <WorkspaceSection key={ws.id} workspace={ws} />
        ))}
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
    </>
  );

  return (
    <SidebarLayout sidebar={sidebar}>
      {!onPage && (
        <MobileBar>
          <SyncStatus className="mr-1" />
          <button
            onClick={() => setSearching(true)}
            aria-label={t("search.button")}
            className="rounded-md p-2 text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <Search size={20} />
          </button>
        </MobileBar>
      )}
      <Outlet />
      {creatingWorkspace && <CreateWorkspaceDialog onClose={() => setCreatingWorkspace(false)} />}
      {searching && <SearchDialog onClose={() => setSearching(false)} />}
      {capturing && <QuickCaptureDialog onClose={() => setCapturing(false)} />}
    </SidebarLayout>
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

const FAVORITE_TYPE = "application/x-nootion-favorite";

/** Starred pages, in the user's order: rows are dragged to reorder, and a page dragged from a tree is starred where it lands. */
function FavoritesSection() {
  const favorites = useFavorites();
  const qc = useQueryClient();
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const pages = favorites.data ?? [];
  if (!pages.length) return null;

  async function unstar(id: string) {
    qc.setQueryData<PageSummary[]>(keys.favorites, (old) => old?.filter((p) => p.id !== id));
    await api(`/favorites/${id}`, { method: "DELETE" }).catch(() => {});
    await qc.invalidateQueries({ queryKey: keys.favorites });
  }

  async function onDrop(e: React.DragEvent, target: string) {
    e.preventDefault();
    const box = e.currentTarget.getBoundingClientRect();
    const after = e.clientY > box.top + box.height / 2;
    setDrop(null);
    const moved = e.dataTransfer.getData(FAVORITE_TYPE) || e.dataTransfer.getData(DRAG_TYPE);
    if (!moved || moved === target) return;
    try {
      if (!pages.some((p) => p.id === moved)) await api(`/favorites/${moved}`, { method: "PUT" });
      const ids = pages.map((p) => p.id).filter((id) => id !== moved);
      ids.splice(ids.indexOf(target) + (after ? 1 : 0), 0, moved);
      const byId = new Map(pages.map((p) => [p.id, p]));
      qc.setQueryData<PageSummary[]>(keys.favorites, (old) => (old ? ids.flatMap((id) => byId.get(id) ?? []) : old));
      await api("/favorites/order", { method: "POST", body: { pageIds: ids } });
    } catch {
      // Offline or no longer readable: the server's order comes back below.
    }
    await qc.invalidateQueries({ queryKey: keys.favorites });
  }

  return (
    <div>
      <SectionHeader icon={<Star size={12} />} label={t("favorites.title")} />
      {pages.map((page) => {
        const line = drop?.id === page.id ? (drop.after ? "shadow-[inset_0_-2px_0_0] shadow-blue-500" : "shadow-[inset_0_2px_0_0] shadow-blue-500") : "";
        return (
          <div
            key={page.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(FAVORITE_TYPE, page.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(FAVORITE_TYPE) && !e.dataTransfer.types.includes(DRAG_TYPE)) return;
              e.preventDefault();
              const box = e.currentTarget.getBoundingClientRect();
              setDrop({ id: page.id, after: e.clientY > box.top + box.height / 2 });
            }}
            onDragLeave={() => setDrop(null)}
            onDrop={(e) => onDrop(e, page.id)}
            className={`group flex items-center rounded-md pr-1 ${line}`}
            data-favorite={page.id}
          >
            <NavLink
              to={`/page/${page.id}`}
              className={({ isActive }) =>
                `flex min-w-0 flex-1 items-center gap-1.5 rounded py-1 pl-2 pr-1 text-sm touch:py-2 ${isActive ? "bg-neutral-200/80 font-medium dark:bg-neutral-800" : "hover:bg-neutral-200/50 dark:hover:bg-neutral-800/60"}`
              }
            >
              <span className="w-4 shrink-0 text-center">
                {page.icon ?? (page.kind === "database" ? <Database size={14} className="inline text-neutral-400" /> : <FileText size={14} className="inline text-neutral-400" />)}
              </span>
              <span className="truncate">{pageTitle(page.title)}</span>
            </NavLink>
            <button
              className="hidden shrink-0 rounded p-1 text-neutral-500 hover:bg-neutral-200 group-hover:block touch:block dark:hover:bg-neutral-800"
              onClick={() => unstar(page.id)}
              title={t("favorites.remove")}
              aria-label={t("favorites.remove")}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
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
        <Field
          label={t("workspace.name")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("workspace.namePlaceholder")}
          required
          autoFocus
        />
        <p className="text-sm text-neutral-500">{t("workspace.newHelp")}</p>
        <ErrorText error={error} />
        <div className="flex justify-end gap-2">
          <CancelButton onClose={onClose} />
          <Button type="submit">{t("common.create")}</Button>
        </div>
      </form>
    </Modal>
  );
}
