import { useEffect, useMemo, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { PAGE_DB_PREFIX } from "../lib/offline";
import { useOnline } from "../lib/api";
import { NodeSelection } from "@tiptap/pm/state";
import { useQueryClient } from "@tanstack/react-query";
import { Bold, Code, Italic, Link as LinkIcon, Strikethrough, Underline } from "lucide-react";
import type { PageDetail, PageSummary } from "@nootion/shared";
import { useSession } from "../lib/session";
import { useRefreshPages } from "../lib/queries";
import { baseExtensions } from "./extensions";
import { createSuggestionExtension } from "./suggestion";
import { mentionItems, slashItems, type CommandContext } from "./commands";
import { insertFiles } from "./upload";
import { usePlugins } from "../plugins/registry";
import type { ClientPluginInfo } from "@nootion/shared";
import { t } from "@nootion/shared";
import { MobileToolbar } from "./MobileToolbar";
import { useIsTouch } from "../lib/mobile";

const COLORS = ["#e11d48", "#ea580c", "#ca8a04", "#16a34a", "#0891b2", "#2563eb", "#7c3aed", "#c026d3"];
export function colorFor(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

function collabUrl(): string {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/collab`;
}

interface Peer {
  clientId: number;
  name: string;
  color: string;
}

/**
 * Collaborative editor of a page body. Creates one Yjs document and connection per page.
 * The document is also kept in the browser (IndexedDB): the page opens and can be edited offline,
 * and the changes merge with everyone else's when the connection comes back.
 */
/** `onEmpty` hears whether the page has no content yet (to offer templates). */
export function PageEditor({ page, canEdit, onEmpty }: { page: PageDetail; canEdit: boolean; onEmpty?: (empty: boolean) => void }) {
  const [collab, setCollab] = useState<{ doc: Y.Doc; provider: HocuspocusProvider; local: IndexeddbPersistence } | null>(null);
  const plugins = usePlugins();
  useEffect(() => {
    const doc = new Y.Doc();
    const local = new IndexeddbPersistence(PAGE_DB_PREFIX + page.id, doc);
    const provider = new HocuspocusProvider({ url: collabUrl(), name: page.id, document: doc, token: "session" });
    setCollab({ doc, provider, local });
    return () => {
      provider.destroy();
      void local.destroy();
      doc.destroy();
    };
  }, [page.id]);
  // The editor's schema needs the plugins' blocks: without them, their blocks would be dropped from the page.
  if (plugins.isError) return <p className="text-sm text-red-600">{t("editor.pluginsFailed")}</p>;
  if (!collab || !plugins.data) return null;
  return <CollabEditor key={page.id} page={page} canEdit={canEdit} onEmpty={onEmpty} doc={collab.doc} provider={collab.provider} local={collab.local} plugins={plugins.data} />;
}

function CollabEditor({
  page,
  canEdit,
  onEmpty,
  doc,
  provider,
  local,
  plugins,
}: {
  page: PageDetail;
  canEdit: boolean;
  onEmpty?: (empty: boolean) => void;
  doc: Y.Doc;
  provider: HocuspocusProvider;
  local: IndexeddbPersistence;
  plugins: ClientPluginInfo[];
}) {
  const { user } = useSession();
  const qc = useQueryClient();
  const refreshPages = useRefreshPages();
  const [synced, setSynced] = useState(provider.isSynced);
  const [connected, setConnected] = useState(true);
  const [unsynced, setUnsynced] = useState(0);
  // Whether this device already had the page: only then can it be edited before the server answers.
  const [hasLocal, setHasLocal] = useState<boolean | null>(null);
  useEffect(() => {
    void local.whenSynced.then(() => setHasLocal(doc.getXmlFragment("default").length > 0));
  }, [local, doc]);
  const [peers, setPeers] = useState<Peer[]>([]);
  const touch = useIsTouch();

  useEffect(() => {
    const onSynced = () => setSynced(true);
    const onStatus = ({ status }: { status: string }) => setConnected(status === "connected");
    const onAwareness = ({ states }: { states: { clientId: number; user?: { name: string; color: string } }[] }) =>
      setPeers(states.filter((s) => s.clientId !== doc.clientID && s.user).map((s) => ({ clientId: s.clientId, name: s.user!.name, color: s.user!.color })));
    const onUnsynced = ({ number }: { number: number }) => setUnsynced(number);
    provider.on("synced", onSynced);
    provider.on("status", onStatus);
    provider.on("unsyncedChanges", onUnsynced);
    provider.on("awarenessChange", onAwareness);
    return () => {
      provider.off("synced", onSynced);
      provider.off("status", onStatus);
      provider.off("unsyncedChanges", onUnsynced);
      provider.off("awarenessChange", onAwareness);
    };
  }, [provider, doc]);

  const ctx: CommandContext = useMemo(
    () => ({
      pageId: page.id,
      workspaceId: page.workspaceId,
      plugins,
      onPageCreated: () => void refreshPages(),
      linkablePages: () => {
        const seen = new Map<string, PageSummary>();
        for (const [, data] of qc.getQueriesData<PageSummary[]>({ queryKey: ["pages"] })) data?.forEach((p) => seen.set(p.id, p));
        qc.getQueryData<PageSummary[]>(["shared"])?.forEach((p) => seen.set(p.id, p));
        return [...seen.values()];
      },
    }),
    [page.id, page.workspaceId, qc, refreshPages, plugins],
  );

  const editor = useEditor(
    {
      editable: canEdit,
      extensions: [
        ...baseExtensions({ collaborative: true, plugins, pageId: page.id }),
        Collaboration.configure({ document: doc }),
        CollaborationCaret.configure({ provider, user: { name: user?.name ?? "?", color: colorFor(user?.id ?? "") } }),
        createSuggestionExtension("slashCommands", "/", slashItems(ctx), t("editor.noCommand")),
        createSuggestionExtension("pageMentions", "@", mentionItems(ctx), t("editor.noPage")),
      ],
      editorProps: {
        attributes: { class: "nootion-content", "aria-label": t("editor.content") },
        handlePaste: (view, event) => {
          const files = Array.from(event.clipboardData?.files ?? []);
          if (!files.length || !canEdit) return false;
          void insertFiles(editorRef.current!, page.id, files);
          return true;
        },
        handleDrop: (view, event, _slice, moved) => {
          const files = Array.from((event as DragEvent).dataTransfer?.files ?? []);
          if (moved || !files.length || !canEdit) return false;
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
          void insertFiles(editorRef.current!, page.id, files, pos);
          return true;
        },
      },
    },
    [doc, provider],
  );
  const editorRef = useMemo(() => ({ current: null as Editor | null }), []);
  editorRef.current = editor;

  // Offline, a page never opened on this device can't be edited: typing into an empty copy would duplicate its content
  // once merged with the server's.
  const online = useOnline();
  const editable = canEdit && (online || synced || hasLocal !== false);
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  useEffect(() => {
    if (!editor || !onEmpty) return;
    // Only once the server's copy is in: a page still loading looks empty.
    const report = () => synced && onEmpty(editor.isEmpty);
    report();
    editor.on("update", report);
    return () => {
      editor.off("update", report);
    };
  }, [editor, onEmpty, synced]);

  return (
    <div>
      <div className="mb-2 flex h-6 items-center justify-end gap-2 text-xs text-neutral-400">
        {peers.map((p) => (
          <span key={p.clientId} className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold text-white" style={{ background: p.color }} title={t("editor.presence", { name: p.name })}>
            {p.name.slice(0, 1).toUpperCase()}
          </span>
        ))}
        {!connected ? (
          <span className="text-amber-600" title={hasLocal || synced ? t("editor.offlineHelp") : undefined}>
            {hasLocal || synced ? t("editor.offline") : t("editor.offlineNotSaved")}
          </span>
        ) : !synced ? (
          <span>{t("common.loading")}</span>
        ) : unsynced > 0 ? (
          <span>{t("editor.saving")}</span>
        ) : null}
      </div>
      {/* On touch screens, formatting is in the bar above the keyboard, away from the system's selection menu. */}
      {editor && canEdit && !touch && <FormatMenu editor={editor} />}
      {editor && canEdit && touch && <MobileToolbar editor={editor} />}
      {editor && canEdit && <TableMenu editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}

function FormatMenu({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      link: e.isActive("link"),
    }),
  });
  const btn = (active: boolean) => `rounded p-1.5 ${active ? "bg-neutral-200 dark:bg-neutral-700" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`;
  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor: e, from, to }) => from !== to && !(e.state.selection instanceof NodeSelection) && !e.isActive("image") && !e.isActive("fileAttachment") && !e.isActive("pageLink")}
      className="flex items-center gap-0.5 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
    >
      <button className={btn(state.bold)} onClick={() => editor.chain().focus().toggleBold().run()} title={t("editor.bold")}>
        <Bold size={15} />
      </button>
      <button className={btn(state.italic)} onClick={() => editor.chain().focus().toggleItalic().run()} title={t("editor.italic")}>
        <Italic size={15} />
      </button>
      <button className={btn(state.underline)} onClick={() => editor.chain().focus().toggleUnderline().run()} title={t("editor.underline")}>
        <Underline size={15} />
      </button>
      <button className={btn(state.strike)} onClick={() => editor.chain().focus().toggleStrike().run()} title={t("editor.strike")}>
        <Strikethrough size={15} />
      </button>
      <button className={btn(state.code)} onClick={() => editor.chain().focus().toggleCode().run()} title={t("editor.code")}>
        <Code size={15} />
      </button>
      <button
        className={btn(state.link)}
        title={t("editor.link")}
        onClick={() => {
          if (state.link) return editor.chain().focus().unsetLink().run();
          const url = prompt(t("editor.linkPrompt"));
          if (url) editor.chain().focus().setLink({ href: /^[a-z]+:/i.test(url) ? url : `https://${url}` }).run();
        }}
      >
        <LinkIcon size={15} />
      </button>
    </BubbleMenu>
  );
}

function TableMenu({ editor }: { editor: Editor }) {
  const inTable = useEditorState({ editor, selector: ({ editor: e }) => e.isActive("table") });
  if (!inTable) return null;
  const b = "rounded px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800";
  return (
    <div className="sticky top-0 z-10 mb-2 flex flex-wrap max-md:top-[52px] gap-1 rounded-lg border border-neutral-200 bg-white p-1 text-xs shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
      <button className={b} onClick={() => editor.chain().focus().addRowAfter().run()}>+ {t("editor.row")}</button>
      <button className={b} onClick={() => editor.chain().focus().addColumnAfter().run()}>+ {t("editor.column")}</button>
      <button className={b} onClick={() => editor.chain().focus().deleteRow().run()}>− {t("editor.row")}</button>
      <button className={b} onClick={() => editor.chain().focus().deleteColumn().run()}>− {t("editor.column")}</button>
      <button className={b} onClick={() => editor.chain().focus().toggleHeaderRow().run()}>{t("editor.header")}</button>
      <button className={`${b} text-red-600`} onClick={() => editor.chain().focus().deleteTable().run()}>{t("editor.deleteTable")}</button>
    </div>
  );
}
