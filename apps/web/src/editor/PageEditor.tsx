import { useEffect, useMemo, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import { useQueryClient } from "@tanstack/react-query";
import { Bold, Code, Italic, Link as LinkIcon, Strikethrough, Underline } from "lucide-react";
import type { PageDetail, PageSummary } from "@nootion/shared";
import { useSession } from "../lib/session";
import { useRefreshPages } from "../lib/queries";
import { baseExtensions } from "./extensions";
import { createSuggestionExtension } from "./suggestion";
import { mentionItems, slashItems, type CommandContext } from "./commands";
import { insertFiles } from "./upload";

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

/** Collaborative editor of a page body. Creates one Yjs document and connection per page. */
export function PageEditor({ page, canEdit }: { page: PageDetail; canEdit: boolean }) {
  const [collab, setCollab] = useState<{ doc: Y.Doc; provider: HocuspocusProvider } | null>(null);
  useEffect(() => {
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({ url: collabUrl(), name: page.id, document: doc, token: "session" });
    setCollab({ doc, provider });
    return () => {
      provider.destroy();
      doc.destroy();
    };
  }, [page.id]);
  if (!collab) return null;
  return <CollabEditor key={page.id} page={page} canEdit={canEdit} doc={collab.doc} provider={collab.provider} />;
}

function CollabEditor({ page, canEdit, doc, provider }: { page: PageDetail; canEdit: boolean; doc: Y.Doc; provider: HocuspocusProvider }) {
  const { user } = useSession();
  const qc = useQueryClient();
  const refreshPages = useRefreshPages();
  const [synced, setSynced] = useState(provider.isSynced);
  const [connected, setConnected] = useState(true);
  const [peers, setPeers] = useState<Peer[]>([]);

  useEffect(() => {
    const onSynced = () => setSynced(true);
    const onStatus = ({ status }: { status: string }) => setConnected(status === "connected");
    const onAwareness = ({ states }: { states: { clientId: number; user?: { name: string; color: string } }[] }) =>
      setPeers(states.filter((s) => s.clientId !== doc.clientID && s.user).map((s) => ({ clientId: s.clientId, name: s.user!.name, color: s.user!.color })));
    provider.on("synced", onSynced);
    provider.on("status", onStatus);
    provider.on("awarenessChange", onAwareness);
    return () => {
      provider.off("synced", onSynced);
      provider.off("status", onStatus);
      provider.off("awarenessChange", onAwareness);
    };
  }, [provider, doc]);

  const ctx: CommandContext = useMemo(
    () => ({
      pageId: page.id,
      workspaceId: page.workspaceId,
      onPageCreated: () => void refreshPages(),
      linkablePages: () => {
        const seen = new Map<string, PageSummary>();
        for (const [, data] of qc.getQueriesData<PageSummary[]>({ queryKey: ["pages"] })) data?.forEach((p) => seen.set(p.id, p));
        qc.getQueryData<PageSummary[]>(["shared"])?.forEach((p) => seen.set(p.id, p));
        return [...seen.values()];
      },
    }),
    [page.id, page.workspaceId, qc, refreshPages],
  );

  const editor = useEditor(
    {
      editable: canEdit,
      extensions: [
        ...baseExtensions({ collaborative: true }),
        Collaboration.configure({ document: doc }),
        CollaborationCaret.configure({ provider, user: { name: user?.name ?? "?", color: colorFor(user?.id ?? "") } }),
        createSuggestionExtension("slashCommands", "/", slashItems(ctx), "Aucune commande"),
        createSuggestionExtension("pageMentions", "@", mentionItems(ctx), "Aucune page trouvée"),
      ],
      editorProps: {
        attributes: { class: "nootion-content", "aria-label": "Contenu de la page" },
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

  useEffect(() => {
    editor?.setEditable(canEdit);
  }, [editor, canEdit]);

  return (
    <div>
      <div className="mb-2 flex h-6 items-center justify-end gap-2 text-xs text-neutral-400">
        {peers.map((p) => (
          <span key={p.clientId} className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold text-white" style={{ background: p.color }} title={`${p.name} est sur la page`}>
            {p.name.slice(0, 1).toUpperCase()}
          </span>
        ))}
        {!connected ? <span className="text-amber-600">Hors ligne, reconnexion…</span> : !synced ? <span>Chargement…</span> : null}
      </div>
      {editor && canEdit && <FormatMenu editor={editor} />}
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
      shouldShow={({ editor: e, from, to }) => from !== to && !e.isActive("image") && !e.isActive("fileAttachment") && !e.isActive("pageLink")}
      className="flex items-center gap-0.5 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
    >
      <button className={btn(state.bold)} onClick={() => editor.chain().focus().toggleBold().run()} title="Gras (Ctrl+B)">
        <Bold size={15} />
      </button>
      <button className={btn(state.italic)} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italique (Ctrl+I)">
        <Italic size={15} />
      </button>
      <button className={btn(state.underline)} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Souligné (Ctrl+U)">
        <Underline size={15} />
      </button>
      <button className={btn(state.strike)} onClick={() => editor.chain().focus().toggleStrike().run()} title="Barré">
        <Strikethrough size={15} />
      </button>
      <button className={btn(state.code)} onClick={() => editor.chain().focus().toggleCode().run()} title="Code">
        <Code size={15} />
      </button>
      <button
        className={btn(state.link)}
        title="Lien"
        onClick={() => {
          if (state.link) return editor.chain().focus().unsetLink().run();
          const url = prompt("Adresse du lien");
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
    <div className="sticky top-0 z-10 mb-2 flex flex-wrap gap-1 rounded-lg border border-neutral-200 bg-white p-1 text-xs shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
      <button className={b} onClick={() => editor.chain().focus().addRowAfter().run()}>+ Ligne</button>
      <button className={b} onClick={() => editor.chain().focus().addColumnAfter().run()}>+ Colonne</button>
      <button className={b} onClick={() => editor.chain().focus().deleteRow().run()}>− Ligne</button>
      <button className={b} onClick={() => editor.chain().focus().deleteColumn().run()}>− Colonne</button>
      <button className={b} onClick={() => editor.chain().focus().toggleHeaderRow().run()}>En-tête</button>
      <button className={`${b} text-red-600`} onClick={() => editor.chain().focus().deleteTable().run()}>Supprimer le tableau</button>
    </div>
  );
}
