import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, NodeViewWrapper, useEditor, type NodeViewProps } from "@tiptap/react";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Copy, ExternalLink, Plus, RefreshCw, Unlink } from "lucide-react";
import { atLeast, t, type ClientPluginInfo, type PageSummary, type SyncedBlockInfo, type SyncedBlockSummary, type UserDirectoryEntry, type GroupSummary } from "@nootion/shared";
import { api, ApiError } from "../lib/api";
import { PAGE_DB_PREFIX } from "../lib/offline";
import { useSession } from "../lib/session";
import { keys, useRefreshPages } from "../lib/queries";
import { pageTitle } from "../lib/tree";
import { pageIcon } from "../lib/icons";
import { useIsTouch } from "../lib/mobile";
import { usePlugins } from "../plugins/registry";
import { Popover } from "../database/Popover";
import { baseExtensions } from "./extensions";
import { createSuggestionExtension } from "./suggestion";
import { mentionItems, slashItems, type CommandContext } from "./commands";
import { BlockShortcuts } from "./blockActions";
import { insertFiles } from "./upload";
import { colorFor } from "./PageEditor";
import { copySyncedBlock, unsyncBlock, type SyncedBlockOptions } from "./syncedBlock";

export const syncedKey = (id: string) => ["synced-block", id] as const;

const box = "rounded border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-500 dark:border-neutral-700";

/** A synced block in a page: its content, edited in place, with the pages it is shown in. */
export function SyncedBlockView({ node, extension, editor, updateAttributes, getPos }: NodeViewProps) {
  const options = extension.options as SyncedBlockOptions;
  const sourceId = node.attrs.sourceId as string | null;
  const editable = editor.isEditable && !!options.pageId;
  if (!sourceId)
    return (
      <NodeViewWrapper className="synced-block-setup my-2" contentEditable={false} data-drag-handle="">
        {editable ? (
          <SyncedSetup pageId={options.pageId!} onPick={(id) => updateAttributes({ sourceId: id })} />
        ) : (
          <div className={box}>{t("synced.none")}</div>
        )}
      </NodeViewWrapper>
    );
  if (options.ancestors.includes(sourceId))
    return (
      <NodeViewWrapper className="my-2" contentEditable={false}>
        <div className={box}>{t("synced.nested")}</div>
      </NodeViewWrapper>
    );
  return (
    <NodeViewWrapper className="my-1" contentEditable={false}>
      <SyncedContent
        id={sourceId}
        ancestors={options.ancestors}
        outerEditable={editable}
        onCopy={() => {
          const pos = getPos();
          if (pos !== undefined) copySyncedBlock(editor, pos);
        }}
        onUnsync={() => void unsyncBlock(editor, node, getPos).catch((err: Error) => alert(err.message))}
      />
    </NodeViewWrapper>
  );
}

function SyncedContent({
  id,
  ancestors,
  outerEditable,
  onCopy,
  onUnsync,
}: {
  id: string;
  ancestors: string[];
  outerEditable: boolean;
  onCopy: () => void;
  onUnsync: () => void;
}) {
  const info = useQuery({
    queryKey: syncedKey(id),
    queryFn: async () => (await api<{ block: SyncedBlockInfo }>(`/synced-blocks/${id}`)).block,
    // No access stays no access: no retries.
    retry: (count, e) => !(e instanceof ApiError && e.status === 404) && count < 2,
  });
  // Just pasted, the page isn't saved yet: the pages showing it are counted again a moment later.
  const { refetch } = info;
  useEffect(() => {
    const timer = window.setTimeout(() => void refetch(), 4000);
    return () => window.clearTimeout(timer);
  }, [refetch]);
  const plugins = usePlugins();
  const touch = useIsTouch();
  const [pagesAnchor, setPagesAnchor] = useState<HTMLElement | null>(null);
  const [copied, setCopied] = useState(false);
  if (info.isError)
    return (
      <div className={box} data-synced-block-missing="">
        🔒 {t("synced.noAccess")}
      </div>
    );
  if (!info.data || !plugins.data) return <div className="px-1 py-2 text-sm text-neutral-400">{t("synced.loading")}</div>;
  const block = info.data;
  const canEdit = outerEditable && atLeast(block.role, "editor") && !block.locked;
  const count = Math.max(1, block.pages.length);
  const tool =
    "flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200";
  return (
    <div className={`synced-block group/synced ${touch ? "synced-block-touch" : ""}`} data-synced-block-id={id}>
      <div className="synced-block-bar" data-print-hide>
        <button type="button" className={tool} onClick={(e) => setPagesAnchor(e.currentTarget)} title={t("synced.shownIn")}>
          <RefreshCw size={12} /> {t("synced.usedIn", { count })}
        </button>
        {outerEditable && (
          <>
            <button
              type="button"
              className={tool}
              title={t("synced.copyHint")}
              aria-label={t("synced.copy")}
              onClick={() => {
                onCopy();
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }}
            >
              <Copy size={12} /> <span className="max-sm:hidden">{copied ? t("synced.copied") : t("synced.copy")}</span>
            </button>
            <button type="button" className={tool} title={t("synced.unsyncHint")} aria-label={t("synced.unsync")} onClick={onUnsync}>
              <Unlink size={12} /> <span className="max-sm:hidden">{t("synced.unsync")}</span>
            </button>
          </>
        )}
      </div>
      {pagesAnchor && (
        <Popover anchor={pagesAnchor} onClose={() => setPagesAnchor(null)} width={280}>
          <div className="p-1 text-sm">
            <p className="px-2 py-1 text-xs font-medium text-neutral-500">{t("synced.shownIn")}</p>
            {block.pages.map((p) => (
              <Link
                key={p.id}
                to={`/page/${p.id}`}
                onClick={() => setPagesAnchor(null)}
                className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <span className="w-4 text-center">{pageIcon(p.icon) ?? "📄"}</span>
                <span className="truncate">{pageTitle(p.title)}</span>
                {p.id === block.host.id && <span className="ml-auto shrink-0 text-xs text-neutral-400">{t("synced.originalBadge")}</span>}
              </Link>
            ))}
            {!block.pages.some((p) => p.id === block.host.id) && (
              <Link
                to={`/page/${block.host.id}`}
                onClick={() => setPagesAnchor(null)}
                className="mt-1 flex items-center gap-2 rounded border-t border-neutral-100 px-2 py-1.5 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                <ExternalLink size={14} /> <span className="truncate">{t("synced.original", { title: pageTitle(block.host.title) })}</span>
              </Link>
            )}
          </div>
        </Popover>
      )}
      <SyncedEditor id={id} editable={canEdit} ancestors={[...ancestors, id]} plugins={plugins.data} />
    </div>
  );
}

function collabUrl(): string {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/collab`;
}

/** The synced block's own editor, on the hidden page holding its content: live, kept offline, as any page. */
function SyncedEditor({ id, editable, ancestors, plugins }: { id: string; editable: boolean; ancestors: string[]; plugins: ClientPluginInfo[] }) {
  const [collab, setCollab] = useState<{ doc: Y.Doc; provider: HocuspocusProvider } | null>(null);
  useEffect(() => {
    const doc = new Y.Doc();
    const local = new IndexeddbPersistence(PAGE_DB_PREFIX + id, doc);
    const provider = new HocuspocusProvider({ url: collabUrl(), name: id, document: doc, token: "session" });
    setCollab({ doc, provider });
    return () => {
      provider.destroy();
      void local.destroy();
      doc.destroy();
    };
  }, [id]);
  if (!collab) return null;
  return <InnerEditor key={id} id={id} editable={editable} ancestors={ancestors} plugins={plugins} doc={collab.doc} provider={collab.provider} />;
}

/** Blocks of the "/" menu left out inside a synced block: they would make pages under its hidden page. */
const NOT_INSIDE = new Set(["Page", "Database", "Synced block"]);

function InnerEditor({
  id,
  editable,
  ancestors,
  plugins,
  doc,
  provider,
}: {
  id: string;
  editable: boolean;
  ancestors: string[];
  plugins: ClientPluginInfo[];
  doc: Y.Doc;
  provider: HocuspocusProvider;
}) {
  const { user } = useSession();
  const qc = useQueryClient();
  const refreshPages = useRefreshPages();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const ctx: CommandContext = useMemo(
    () => ({
      pageId: id,
      workspaceId: "",
      plugins,
      userId: user?.id ?? null,
      people: () => qc.getQueryData<UserDirectoryEntry[]>(keys.users) ?? [],
      groups: () => qc.getQueryData<GroupSummary[]>(keys.groups) ?? [],
      onPageCreated: () => void refreshPages(),
      linkablePages: () => {
        const seen = new Map<string, PageSummary>();
        for (const [, data] of qc.getQueriesData<PageSummary[]>({ queryKey: ["pages"] })) data?.forEach((p) => seen.set(p.id, p));
        return [...seen.values()];
      },
    }),
    [id, plugins, user?.id, qc, refreshPages],
  );
  const editorRef = useRef<ReturnType<typeof useEditor>>(null);
  const editor = useEditor(
    {
      editable,
      extensions: [
        ...baseExtensions({ collaborative: true, plugins, pageId: id, navigate: (path) => navigateRef.current(path), syncedAncestors: ancestors }),
        Collaboration.configure({ document: doc }),
        CollaborationCaret.configure({ provider, user: { name: user?.name ?? "?", color: colorFor(user?.id ?? "") } }),
        createSuggestionExtension("slashCommands", "/", slashItems(ctx, NOT_INSIDE), t("editor.noCommand")),
        createSuggestionExtension("pageMentions", "@", mentionItems(ctx), t("editor.noPage")),
        BlockShortcuts,
      ],
      editorProps: {
        attributes: { class: "nootion-content synced-block-content", "aria-label": t("synced.name") },
        handlePaste: (_view, event) => {
          const files = Array.from(event.clipboardData?.files ?? []);
          if (!files.length || !editorRef.current?.isEditable) return false;
          void insertFiles(editorRef.current, id, files);
          return true;
        },
      },
    },
    [doc, provider],
  );
  editorRef.current = editor;
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);
  // "Synced in 3 pages" follows: someone may have pasted it elsewhere.
  useEffect(() => {
    const refresh = () => void qc.invalidateQueries({ queryKey: syncedKey(id) });
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [qc, id]);
  return (
    <div data-synced-inner="">
      <EditorContent editor={editor} />
    </div>
  );
}

/** A new synced block, or one already shown elsewhere ("/synced"). */
function SyncedSetup({ pageId, onPick }: { pageId: string; onPick: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const list = useQuery({
    queryKey: ["synced-blocks", query],
    queryFn: async () => (await api<{ blocks: SyncedBlockSummary[] }>(`/synced-blocks?q=${encodeURIComponent(query)}`)).blocks,
  });
  const create = async () => {
    setBusy(true);
    setFailed(false);
    try {
      onPick((await api<{ id: string }>(`/pages/${pageId}/synced-blocks`, { method: "POST", body: {} })).id);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const blocks = list.data ?? [];
  return (
    <div className="rounded border border-neutral-200 p-2 text-sm dark:border-neutral-700" data-synced-inner="">
      <div className="mb-1 flex items-center gap-1.5 px-1 font-medium">
        <RefreshCw size={14} className="text-neutral-400" /> {t("synced.choose")}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => void create()}
        className="mb-1 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800"
      >
        <Plus size={15} className="text-neutral-500" /> {t("synced.new")}
      </button>
      {failed && <p className="px-2 py-1 text-red-600">{t("synced.failed")}</p>}
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("synced.search")}
        aria-label={t("synced.search")}
        className="mb-1 w-full rounded border border-neutral-200 bg-transparent px-2 py-1.5 outline-none focus:border-neutral-400 dark:border-neutral-700"
      />
      <div className="max-h-64 overflow-y-auto">
        {blocks.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => onPick(b.id)}
            className="flex w-full flex-col rounded px-2 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <span className="line-clamp-2">{b.preview || t("common.untitled")}</span>
            <span className="flex items-center gap-1 text-xs text-neutral-500">
              <span>{pageIcon(b.host.icon) ?? "📄"}</span>
              <span className="truncate">{pageTitle(b.host.title)}</span>
            </span>
          </button>
        ))}
        {list.isLoading && <p className="px-2 py-1 text-neutral-400">{t("common.loading")}</p>}
        {list.data && !blocks.length && <p className="px-2 py-1 text-neutral-500">{t("synced.none")}</p>}
      </div>
    </div>
  );
}
