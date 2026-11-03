import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, History, LayoutTemplate, Lock, MessageSquare, MoreHorizontal, Repeat, Share2, Star, Trash2 } from "lucide-react";
import { atLeast, t, type PageDetail, type PageSummary } from "@nootion/shared";
import { api } from "../lib/api";
import { sendOrQueue } from "../lib/offline";
import { keys, useFavorites, usePage, useRefreshPages } from "../lib/queries";
import { pageRoleLabel } from "../lib/labels";
import { pageTitle } from "../lib/tree";
import { Button } from "../components/ui";
import { ShareDialog } from "../components/ShareDialog";
import { EditedAt } from "../components/EditedAt";
import { HistoryDialog } from "../components/HistoryDialog";
import { Backlinks } from "../components/Backlinks";
import { IconPicker } from "../components/IconPicker";
import { AddCoverButton, PageCover } from "../components/PageCover";
import { PageEditor } from "../editor/PageEditor";
import { DatabaseTable } from "../database/DatabaseTable";
import { RowProperties } from "../database/RowProperties";
import { dbKey } from "../database/hooks";
import { Popover } from "../database/Popover";
import { MenuButton } from "../components/SidebarLayout";
import { SyncStatus } from "../components/SyncStatus";
import { useSession } from "../lib/session";
import { CommentsPanel, type DraftAnchor } from "../comments/CommentsPanel";
import { useComments } from "../comments/queries";
import { nextRunText, recurrenceText, RecurrenceDialog, useRecurrence } from "../components/RecurrenceDialog";
import { pageIcon } from "../lib/icons";

/** A page, by the id in the address (or the one given, for the home page). */
export function PagePage({ id: given }: { id?: string }) {
  const { id: param = "" } = useParams();
  const id = given ?? param;
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

/** "Good morning" to "Good evening", by the time of day. */
function greeting(name: string) {
  const hour = new Date().getHours();
  return t(hour >= 5 && hour < 12 ? "home.morning" : hour >= 12 && hour < 18 ? "home.afternoon" : "home.evening", { name });
}

function PageView({ page }: { page: PageDetail }) {
  const { user } = useSession();
  const canEdit = atLeast(page.role, "editor");
  const canManage = page.role === "full";
  const [title, setTitle] = useState(page.title);
  const [sharing, setSharing] = useState(false);
  const [history, setHistory] = useState(false);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
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

  async function save(patch: { title?: string; icon?: string | null; fullWidth?: boolean; cover?: string | null; coverPosition?: number; template?: boolean }) {
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
            {pageIcon(page.icon)} {pageTitle(title)}
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
                document.querySelector<HTMLElement>(".nootion-content")?.focus();
              }
            }}
            placeholder={page.template ? t("template.untitled") : t("common.untitled")}
            aria-label={t("page.titleLabel")}
            className="w-full resize-none overflow-hidden bg-transparent text-3xl font-bold sm:text-4xl outline-none placeholder:text-neutral-300 dark:placeholder:text-neutral-600"
          />
        )}
        {page.template && <TemplateBanner page={page} canEdit={canEdit} />}
        {page.kind === "row" && page.parentId && <RowProperties databaseId={page.parentId} rowId={page.id} />}
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
        <Popover anchor={menu} onClose={() => setMenu(null)} width={240}>
          {canEdit && (
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
          {canEdit && page.kind === "page" && !page.home && (
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
    </div>
  );
}

function FavoriteButton({ page }: { page: PageDetail }) {
  const favorites = useFavorites();
  const qc = useQueryClient();
  const starred = !!favorites.data?.some((p) => p.id === page.id);
  const label = starred ? t("favorites.remove") : t("favorites.add");

  async function toggle() {
    qc.setQueryData<PageSummary[]>(keys.favorites, (old = []) => (starred ? old.filter((p) => p.id !== page.id) : [...old, page]));
    await api(`/favorites/${page.id}`, { method: starred ? "DELETE" : "PUT" }).catch(() => {});
    await qc.invalidateQueries({ queryKey: keys.favorites });
  }

  return (
    <Button variant="ghost" onClick={toggle} title={label} aria-label={label} aria-pressed={starred}>
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
