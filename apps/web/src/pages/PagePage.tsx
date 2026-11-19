import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  Copy,
  CornerUpRight,
  Download,
  FilePlus,
  History,
  LayoutTemplate,
  Link2,
  Lock,
  LockOpen,
  MessageSquare,
  MoreHorizontal,
  MoveHorizontal,
  Printer,
  Repeat,
  Share2,
  Star,
  Trash2,
} from "lucide-react";
import { atLeast, t, type PageDetail, type PageSummary } from "@nootion/shared";
import { api } from "../lib/api";
import { sendOrQueue } from "../lib/offline";
import { keys, usePage, useRefreshPages, useWorkspacePages } from "../lib/queries";
import { useRegisterActions } from "../lib/actions";
import { usePageActions } from "../lib/pageActions";
import { MoveDialog } from "../components/PageMenu";
import { pageRoleLabel } from "../lib/labels";
import { pageTitle } from "../lib/tree";
import { Button } from "../components/ui";
import { ShareDialog } from "../components/ShareDialog";
import { EditedAt } from "../components/EditedAt";
import { HistoryDialog } from "../components/HistoryDialog";
import { PrintDialog } from "../components/PrintDialog";
import { Backlinks } from "../components/Backlinks";
import { IconPicker } from "../components/IconPicker";
import { AddCoverButton, PageCover } from "../components/PageCover";
import { PageEditor } from "../editor/PageEditor";
import { DatabaseTable } from "../database/DatabaseTable";
import { RowProperties } from "../database/RowProperties";
import { dbKey } from "../database/hooks";
import { Popover } from "../database/Popover";
import { MenuButton } from "../components/SidebarLayout";
import { isMac } from "../components/QuickCapture";
import { SyncStatus } from "../components/SyncStatus";
import { useSession } from "../lib/session";
import { CommentsPanel, type DraftAnchor } from "../comments/CommentsPanel";
import { useComments } from "../comments/queries";
import { nextRunText, recurrenceText, RecurrenceDialog, useRecurrence } from "../components/RecurrenceDialog";
import { PageGlyph, pageIcon } from "../lib/icons";
import { DatabaseIntro } from "../components/DatabaseIntro";
import { PageSkeleton } from "../components/Skeleton";

/** A page, by the id in the address (or the one given, for the home page). */
export function PagePage({ id: given }: { id?: string }) {
  const { id: param = "" } = useParams();
  const id = given ?? param;
  const page = usePage(id);
  if (page.isLoading) return <PageSkeleton />;
  if (page.isError || !page.data) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8 sm:py-16 text-neutral-500">
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">{t("page.notFound")}</h1>
        <p className="mt-2">{t("page.notFoundHelp")}</p>
      </div>
    );
  }
  // The content of a synced block (a link to it, a reminder in it): shown in the page where it lives.
  if (page.data.kind === "block" && page.data.parentId) return <Navigate to={`/page/${page.data.parentId}`} replace />;
  return <PageView key={page.data.id} page={page.data} />;
}

/** "Good morning" to "Good evening", by the time of day. */
function greeting(name: string) {
  const hour = new Date().getHours();
  return t(hour >= 5 && hour < 12 ? "home.morning" : hour >= 12 && hour < 18 ? "home.afternoon" : "home.evening", { name });
}

function PageView({ page }: { page: PageDetail }) {
  const { user } = useSession();
  // Who can edit may lock the page; while it is locked, nobody changes its content, title, icon or cover.
  const canWrite = atLeast(page.role, "editor");
  const canEdit = canWrite && !page.locked;
  const canManage = page.role === "full";
  const [title, setTitle] = useState(page.title);
  const [sharing, setSharing] = useState(false);
  const [history, setHistory] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [moving, setMoving] = useState(false);
  const qc = useQueryClient();
  const refresh = useRefreshPages();
  const navigate = useNavigate();
  const saveTimer = useRef<number | undefined>(undefined);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [empty, setEmpty] = useState(false);
  // Comments: the panel, the open thread, and the passage picked for a new one. "?comment=<thread>" opens a thread.
  const hasComments = page.kind !== "database";
  const canComment = atLeast(page.role, "commenter");
  const [search, setSearch] = useSearchParams();
  const [commentsOpen, setCommentsOpen] = useState(() => !!search.get("comment"));
  const [activeThread, setActiveThread] = useState<string | null>(() => search.get("comment"));
  const [draft, setDraft] = useState<DraftAnchor | null>(null);
  const threads = useComments(page.id, hasComments);
  const openThreads = (threads.data ?? []).filter((th) => !th.resolvedAt).length;
  useEffect(() => {
    const wanted = search.get("comment");
    if (!wanted) return;
    setCommentsOpen(true);
    setActiveThread(wanted);
    search.delete("comment");
    setSearch(search, { replace: true });
  }, [search, setSearch]);
  // An empty page can start from a template.
  const offerTemplates = canEdit && page.kind === "page" && !page.template && !page.home;

  // The title can change elsewhere too (a template applied to the page).
  useEffect(() => setTitle(page.title), [page.title]);

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

  async function save(patch: {
    title?: string;
    icon?: string | null;
    description?: string;
    fullWidth?: boolean;
    cover?: string | null;
    coverPosition?: number;
    template?: boolean;
    locked?: boolean;
  }) {
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

  const toggleLock = () => save({ locked: !page.locked });

  usePalette(page, {
    canEdit: canWrite,
    canManage,
    lock: toggleLock,
    hasComments,
    share: () => setSharing(true),
    history: () => setHistory(true),
    comments: () => setCommentsOpen(true),
    fullWidth: (on) => save({ fullWidth: on }),
    move: () => setMoving(true),
    print: () => setPrinting(true),
  });

  return (
    <div>
      <header className="print:hidden flex items-center justify-between gap-2 px-3 py-1.5 text-sm max-md:sticky max-md:top-0 max-md:z-30 max-md:border-b max-md:border-neutral-200 max-md:bg-white/95 max-md:backdrop-blur sm:gap-4 md:px-4 md:py-2 dark:max-md:border-neutral-800 dark:max-md:bg-neutral-900/95">
        <nav className="flex min-w-0 items-center gap-1 text-neutral-500">
          <MenuButton />
          {page.breadcrumb.map((b) => (
            // On phones, only the parent page is shown, as a way back.
            <span key={b.id} className={`min-w-0 items-center gap-1 ${b === page.breadcrumb[page.breadcrumb.length - 1] ? "flex" : "hidden md:flex"}`}>
              <Link to={`/page/${b.id}`} className="truncate rounded px-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                <PageGlyph icon={b.icon} kind={b.kind} generic={false} /> {pageTitle(b.title)}
              </Link>
              <ChevronRight size={14} className="shrink-0" />
            </span>
          ))}
          <span className="truncate px-1 text-neutral-800 dark:text-neutral-200">
            <PageGlyph icon={page.icon} kind={page.kind} generic={false} /> {pageTitle(title)}
          </span>
        </nav>
        <div className="flex shrink-0 items-center gap-1">
          <SyncStatus />
          <EditedAt pageId={page.id} updatedAt={page.updatedAt} />
          {hasComments && (
            <Button
              variant="ghost"
              onClick={() => setCommentsOpen((o) => !o)}
              title={t("comments.title")}
              aria-label={t("comments.title")}
              aria-pressed={commentsOpen}
              data-comments-toggle
            >
              <MessageSquare size={16} />
              {openThreads > 0 && <span className="text-xs tabular-nums text-neutral-500">{openThreads}</span>}
            </Button>
          )}
          {page.kind !== "database" && (
            <Button variant="ghost" onClick={() => setHistory(true)} title={t("history.title")} aria-label={t("history.title")}>
              <History size={16} />
            </Button>
          )}
          {!page.home && <FavoriteButton page={page} />}
          <Button variant="ghost" onClick={(e) => setMenu(e.currentTarget)} title={t("page.options")} aria-label={t("page.options")}>
            <MoreHorizontal size={16} />
          </Button>
          {page.locked && (
            <button
              type="button"
              disabled={!canWrite}
              onClick={toggleLock}
              title={canWrite ? t("lock.unlockHint") : t(page.kind === "database" ? "lock.databaseHint" : "lock.pageHint")}
              aria-label={canWrite ? t(page.kind === "database" ? "lock.unlockDatabase" : "lock.unlockPage") : t("lock.badge")}
              data-page-locked
              className="flex items-center gap-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800 enabled:hover:bg-amber-100 dark:bg-amber-950/60 dark:text-amber-300 dark:enabled:hover:bg-amber-900/60"
            >
              <Lock size={12} /> <span className="hidden sm:inline">{t("lock.badge")}</span>
            </button>
          )}
          {!canManage && (
            <span
              title={pageRoleLabel(page.role)}
              className="flex items-center gap-1 rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
            >
              <Lock size={12} /> <span className="hidden sm:inline">{pageRoleLabel(page.role)}</span>
            </span>
          )}
          {canManage && !page.home && (
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

      {page.cover && <PageCover pageId={page.id} cover={page.cover} position={page.coverPosition} editable={canEdit} onChange={save} />}
      <div
        className={`mx-auto px-5 pb-24 ${page.cover ? "pt-6" : "pt-8 sm:pt-16"} sm:px-12 ${page.fullWidth ? "max-w-none sm:px-24" : page.kind === "database" ? "max-w-6xl" : "max-w-3xl"}`}
      >
        <div className="flex flex-wrap items-end gap-1">
          {!page.home && <IconPicker icon={page.icon} editable={canEdit} onChange={(icon) => save({ icon })} />}
          {canEdit && !page.cover && <AddCoverButton pageId={page.id} onChange={save} />}
        </div>
        {page.home ? (
          <>
            <h1 className="text-3xl font-bold sm:text-4xl">{greeting(user?.name ?? "")}</h1>
            <p className="mt-2 text-sm text-neutral-500">{t("home.hint")}</p>
          </>
        ) : (
          <textarea
            ref={titleRef}
            rows={1}
            value={title}
            readOnly={!canEdit}
            onChange={(e) => onTitleChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                // A database has no text: Enter goes to its description.
                document.querySelector<HTMLElement>(page.kind === "database" ? "[data-database-description]" : ".nootion-content")?.focus();
              }
            }}
            placeholder={page.template ? t("template.untitled") : t("common.untitled")}
            aria-label={t("page.titleLabel")}
            className="w-full resize-none overflow-hidden bg-transparent text-3xl font-bold sm:text-4xl outline-none placeholder:text-neutral-300 dark:placeholder:text-neutral-600"
          />
        )}
        {page.kind === "database" && <DatabaseIntro page={page} canEdit={canEdit} onSave={(description) => save({ description })} />}
        {page.template && <TemplateBanner page={page} canEdit={canEdit} />}
        {page.kind === "row" && page.parentId && <RowProperties databaseId={page.parentId} rowId={page.id} locked={page.locked} />}
        {offerTemplates && empty && <TemplatePicker page={page} />}
        <div className="mt-4">
          {page.kind === "database" ? (
            <DatabaseTable id={page.id} />
          ) : (
            <PageEditor
              page={page}
              canEdit={canEdit}
              onEmpty={offerTemplates ? setEmpty : undefined}
              comments={{
                // The passage of a comment being written shows as the open one.
                threads:
                  draft && commentsOpen
                    ? [
                        ...(threads.data ?? []),
                        { id: "draft", pageId: page.id, anchor: draft.anchor, quote: draft.quote, resolvedAt: null, resolvedByName: null, comments: [] },
                      ]
                    : (threads.data ?? []),
                active: commentsOpen ? (draft ? "draft" : activeThread) : null,
                canComment,
                onOpen: (id) => {
                  setCommentsOpen(true);
                  setActiveThread(id);
                },
                onComment: (d) => {
                  setDraft(d);
                  setActiveThread(null);
                  setCommentsOpen(true);
                },
              }}
            />
          )}
        </div>
        {!page.home && <Backlinks pageId={page.id} />}
      </div>

      {menu && (
        <Popover anchor={menu} onClose={() => setMenu(null)} width={290}>
          {canWrite && !page.home && (
            <label
              className="flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              title={t(page.kind === "database" ? "lock.databaseHint" : "lock.pageHint")}
              data-lock-toggle
            >
              <span className="flex items-center gap-2">
                <Lock size={15} className="text-neutral-500" /> {t(page.kind === "database" ? "lock.lockDatabase" : "lock.lockPage")}
              </span>
              <input type="checkbox" role="switch" className="h-4 w-4 accent-blue-600" checked={page.locked} onChange={toggleLock} />
            </label>
          )}
          {canWrite && (
            <label className="flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
              {t("page.fullWidth")}
              <input
                type="checkbox"
                role="switch"
                className="h-4 w-4 accent-blue-600"
                checked={page.fullWidth}
                onChange={(e) => save({ fullWidth: e.target.checked })}
              />
            </label>
          )}
          {canWrite && page.kind === "page" && !page.home && (
            <label className="flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
              {t("template.pageToggle")}
              <input
                type="checkbox"
                role="switch"
                className="h-4 w-4 accent-blue-600"
                checked={page.template}
                onChange={async (e) => {
                  await save({ template: e.target.checked });
                  await qc.invalidateQueries({ queryKey: ["page-templates"] });
                }}
              />
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
          <button
            type="button"
            onClick={() => {
              setMenu(null);
              setPrinting(true);
            }}
            className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
            data-print-page
          >
            <span className="flex items-center gap-2">
              <Printer size={15} className="text-neutral-500" /> {t("page.print")}
            </span>
            <kbd className="text-xs text-neutral-400">{isMac() ? "⌘P" : "Ctrl+P"}</kbd>
          </button>
        </Popover>
      )}
      {hasComments && commentsOpen && (
        <CommentsPanel
          pageId={page.id}
          canComment={canComment}
          active={activeThread}
          onActive={setActiveThread}
          draft={draft}
          onDraftDone={() => setDraft(null)}
          onClose={() => {
            setCommentsOpen(false);
            setDraft(null);
          }}
        />
      )}
      {sharing && <ShareDialog page={page} onClose={() => setSharing(false)} />}
      {history && <HistoryDialog page={page} onClose={() => setHistory(false)} />}
      {moving && <PageMove page={page} onClose={() => setMoving(false)} />}
      {printing && <PrintDialog onClose={() => setPrinting(false)} />}
    </div>
  );
}

/** "Move to…" from the palette: chooses among the pages of the page's space, as from the sidebar. */
function PageMove({ page, onClose }: { page: PageDetail; onClose: () => void }) {
  const all = useWorkspacePages(page.workspaceId).data;
  return all ? <MoveDialog page={page} all={all} onClose={onClose} /> : null;
}

/** The open page's actions in the command palette (Ctrl+K). */
function usePalette(
  page: PageDetail,
  ui: {
    canEdit: boolean;
    canManage: boolean;
    lock: () => Promise<unknown>;
    hasComments: boolean;
    share: () => void;
    history: () => void;
    comments: () => void;
    fullWidth: (on: boolean) => Promise<unknown>;
    move: () => void;
    print: () => void;
  },
) {
  const actions = usePageActions(page);
  const refresh = useRefreshPages();
  const navigate = useNavigate();
  const organisable = ui.canEdit && page.kind !== "row" && !page.home;
  useRegisterActions(() => [
    {
      id: "page:subpage",
      title: () => t("tree.addSubpage"),
      keywords: () => `${t("palette.kwCreate")} ${t("page.new")}`,
      section: "page",
      icon: <FilePlus size={16} />,
      when: () => ui.canEdit && page.kind === "page",
      run: async () => {
        const res = await api<{ page: PageSummary }>("/pages", { method: "POST", body: { workspaceId: page.workspaceId, parentId: page.id, title: "" } });
        await refresh();
        navigate(`/page/${res.page.id}`);
      },
    },
    {
      id: "page:share",
      title: () => t("share.button"),
      keywords: () => t("palette.kwShare"),
      section: "page",
      icon: <Share2 size={16} />,
      when: () => ui.canManage && !page.home,
      run: ui.share,
    },
    {
      id: "page:favorite",
      title: () => (actions.starred ? t("favorites.remove") : t("favorites.add")),
      keywords: () => "favorite favori star",
      section: "page",
      icon: <Star size={16} />,
      when: () => !page.home,
      run: actions.toggleFavorite,
    },
    {
      id: "page:comments",
      title: () => t("palette.comments"),
      keywords: () => t("comments.title"),
      section: "page",
      icon: <MessageSquare size={16} />,
      when: () => ui.hasComments,
      run: ui.comments,
    },
    {
      id: "page:history",
      title: () => t("history.title"),
      keywords: () => t("palette.kwHistory"),
      section: "page",
      icon: <History size={16} />,
      when: () => page.kind !== "database",
      run: ui.history,
    },
    {
      id: "page:lock",
      title: () =>
        page.kind === "database" ? t(page.locked ? "lock.unlockDatabase" : "lock.lockDatabase") : t(page.locked ? "lock.unlockPage" : "lock.lockPage"),
      keywords: () => t("lock.keywords"),
      section: "page",
      icon: page.locked ? <LockOpen size={16} /> : <Lock size={16} />,
      when: () => ui.canEdit && !page.home,
      run: ui.lock,
    },
    {
      id: "page:full-width",
      title: () => (page.fullWidth ? t("palette.fullWidthOff") : t("palette.fullWidthOn")),
      keywords: () => t("page.fullWidth"),
      section: "page",
      icon: <MoveHorizontal size={16} />,
      when: () => ui.canEdit,
      run: () => ui.fullWidth(!page.fullWidth),
    },
    {
      id: "page:duplicate",
      title: () => t("page.duplicate"),
      keywords: () => "copy copie",
      section: "page",
      icon: <Copy size={16} />,
      when: () => organisable,
      run: actions.duplicate,
    },
    { id: "page:move", title: () => t("page.moveTo"), section: "page", icon: <CornerUpRight size={16} />, when: () => organisable, run: ui.move },
    { id: "page:copy-link", title: () => t("page.copyLink"), keywords: () => "url", section: "page", icon: <Link2 size={16} />, run: actions.copyLink },
    {
      id: "page:export",
      title: () => t("page.exportMarkdown"),
      keywords: () => "download télécharger zip",
      section: "page",
      icon: <Download size={16} />,
      run: actions.exportMarkdown,
    },
    { id: "page:print", title: () => t("page.print"), keywords: () => "pdf print imprimer", section: "page", icon: <Printer size={16} />, run: ui.print },
  ]);
}

function FavoriteButton({ page }: { page: PageDetail }) {
  const { starred, toggleFavorite } = usePageActions(page);
  const label = starred ? t("favorites.remove") : t("favorites.add");
  return (
    <Button variant="ghost" onClick={toggleFavorite} title={label} aria-label={label} aria-pressed={starred}>
      <Star size={16} className={starred ? "fill-amber-400 text-amber-400" : ""} />
    </Button>
  );
}

/** Says that the page is a template, what it is for, and when it repeats. */
function TemplateBanner({ page, canEdit }: { page: PageDetail; canEdit: boolean }) {
  const database = page.kind === "row" ? page.breadcrumb[page.breadcrumb.length - 1] : undefined;
  const recurrence = useRecurrence(page.id);
  const [editing, setEditing] = useState(false);
  const r = recurrence.data;
  return (
    <>
      <div
        className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        data-template-banner
      >
        <LayoutTemplate size={16} className="mt-0.5 shrink-0" />
        <span className="min-w-0 flex-1">
          {database ? (
            <>
              {t("template.rowBanner", { database: pageTitle(database.title) })}{" "}
              <Link to={`/page/${database.id}`} className="underline">
                {t("template.backToDatabase")}
              </Link>
            </>
          ) : (
            t("template.pageBanner")
          )}
          {r && (
            <span className="mt-1 flex items-start gap-1.5 text-xs opacity-80" data-recurrence-summary>
              <Repeat size={12} className="mt-0.5 shrink-0" />
              <span>
                {recurrenceText(r)} · {nextRunText(r)}
                {r.lastError && <span className="text-red-600 dark:text-red-400"> · {t("recurrence.lastError", { error: r.lastError })}</span>}
              </span>
            </span>
          )}
        </span>
        {canEdit && (
          <button
            type="button"
            className="-my-1 flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium hover:bg-amber-100 dark:hover:bg-amber-900/40"
            onClick={() => setEditing(true)}
            data-recurrence-button
          >
            <Repeat size={13} /> {t("recurrence.button")}
          </button>
        )}
      </div>
      {/* Outside the banner, so it doesn't take its colors. */}
      {editing && <RecurrenceDialog page={page} recurrence={r ?? null} onClose={() => setEditing(false)} />}
    </>
  );
}

/** Page templates offered on an empty page. */
function TemplatePicker({ page }: { page: PageDetail }) {
  const qc = useQueryClient();
  const refresh = useRefreshPages();
  const templates = useQuery({ queryKey: ["page-templates"], queryFn: async () => (await api<{ pages: PageSummary[] }>("/pages/templates")).pages });
  const [applying, setApplying] = useState<string | null>(null);
  const list = (templates.data ?? []).filter((tpl) => tpl.id !== page.id);
  if (!list.length) return null;

  async function apply(templateId: string) {
    setApplying(templateId);
    try {
      await api(`/pages/${page.id}/apply-template`, { method: "POST", body: { templateId } });
      await Promise.all([qc.invalidateQueries({ queryKey: keys.page(page.id) }), refresh()]);
    } finally {
      setApplying(null);
    }
  }

  return (
    <div className="mt-4 text-sm" data-template-picker>
      <div className="mb-2 flex items-center gap-1.5 text-neutral-500">
        <LayoutTemplate size={14} /> {t("template.startFrom")}
      </div>
      <div className="flex flex-wrap gap-2">
        {list.map((tpl) => (
          <button
            key={tpl.id}
            disabled={!!applying}
            onClick={() => apply(tpl.id)}
            className="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            <span>{pageIcon(tpl.icon) ?? "📄"}</span>
            <span className="max-w-48 truncate">{applying === tpl.id ? t("template.applying") : pageTitle(tpl.title)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
