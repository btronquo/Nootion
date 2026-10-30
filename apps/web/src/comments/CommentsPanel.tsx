import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, MessageSquare, MoreHorizontal, RotateCcw, X } from "lucide-react";
import { intlLocale, t, type CommentInfo, type CommentThread, type UserDirectoryEntry } from "@nootion/shared";
import { api } from "../lib/api";
import { useUserDirectory } from "../lib/queries";
import { useSession } from "../lib/session";
import { Avatar } from "../components/Avatar";
import { Popover } from "../database/Popover";
import { Button } from "../components/ui";
import { useComments, useThreadUpdate } from "./queries";

/** A passage picked in the page, waiting for its first comment. */
export interface DraftAnchor {
  anchor: { start: string; end: string };
  quote: string;
}

/**
 * The page's discussions, in a panel beside the page: the open threads (and the resolved ones on demand), a new
 * comment on the whole page, and the draft of a comment on the passage just picked.
 */
export function CommentsPanel({
  pageId,
  canComment,
  active,
  onActive,
  draft,
  onDraftDone,
  onClose,
}: {
  pageId: string;
  canComment: boolean;
  active: string | null;
  onActive: (threadId: string | null) => void;
  draft: DraftAnchor | null;
  onDraftDone: () => void;
  onClose: () => void;
}) {
  const threads = useComments(pageId);
  const update = useThreadUpdate(pageId);
  const [showResolved, setShowResolved] = useState(false);
  const list = (threads.data ?? []).filter((th) => showResolved || !th.resolvedAt || th.id === active);
  const resolvedCount = (threads.data ?? []).filter((th) => th.resolvedAt).length;

  useEffect(() => {
    if (active) document.querySelector(`[data-thread="${active}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active, threads.data]);

  return (
    <aside
      aria-label={t("comments.title")}
      className="nt-pop fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-neutral-200 bg-white shadow-xl sm:w-96 dark:border-neutral-800 dark:bg-neutral-900"
      data-comments-panel
    >
      <header className="flex items-center gap-2 border-b border-neutral-200 px-4 py-2.5 dark:border-neutral-800">
        <MessageSquare size={16} className="text-neutral-500" />
        <h2 className="flex-1 font-semibold">{t("comments.title")}</h2>
        {resolvedCount > 0 && (
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-500">
            <input type="checkbox" className="h-3.5 w-3.5 accent-blue-600" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
            {t("comments.showResolved", { count: resolvedCount })}
          </label>
        )}
        <button onClick={onClose} className="rounded p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label={t("common.close")}>
          <X size={16} />
        </button>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {draft && canComment && (
          <div className="nt-pop rounded-lg border border-blue-300 p-3 dark:border-blue-800" data-comment-draft>
            <Quote text={draft.quote} />
            <Composer
              autoFocus
              placeholder={t("comments.addPlaceholder")}
              onCancel={onDraftDone}
              onSubmit={async (body) => {
                const thread = await update(() => api<{ thread: CommentThread }>(`/pages/${pageId}/comments`, { method: "POST", body: { body, ...draft } }));
                onDraftDone();
                if (thread) onActive(thread.id);
              }}
            />
          </div>
        )}
        {list.map((th) => (
          <Thread key={th.id} thread={th} pageId={pageId} canComment={canComment} active={th.id === active} onActive={onActive} />
        ))}
        {threads.isSuccess && !list.length && !draft && <p className="px-1 py-6 text-center text-sm text-neutral-500">{t("comments.empty")}</p>}
      </div>
      {canComment && (
        <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
          <Composer
            placeholder={t("comments.pagePlaceholder")}
            onSubmit={async (body) => {
              const thread = await update(() => api<{ thread: CommentThread }>(`/pages/${pageId}/comments`, { method: "POST", body: { body } }));
              if (thread) onActive(thread.id);
            }}
          />
        </div>
      )}
    </aside>
  );
}

function Quote({ text }: { text: string }) {
  if (!text) return null;
  return <p className="mb-2 line-clamp-3 border-l-2 border-amber-400 pl-2 text-sm text-neutral-500">{text}</p>;
}

function Thread({ thread, pageId, canComment, active, onActive }: { thread: CommentThread; pageId: string; canComment: boolean; active: boolean; onActive: (id: string | null) => void }) {
  const update = useThreadUpdate(pageId);
  const resolved = !!thread.resolvedAt;
  const resolve = (value: boolean) =>
    update(() => api<{ thread: CommentThread }>(`/comments/threads/${thread.id}/resolve`, { method: "POST", body: { resolved: value } }));
  return (
    <div
      className={`rounded-lg border p-3 transition-colors duration-150 ${active ? "border-amber-300 bg-amber-50/40 dark:border-amber-700 dark:bg-amber-950/20" : "border-neutral-200 dark:border-neutral-800"} ${resolved ? "opacity-70" : ""}`}
      onClick={() => !active && onActive(thread.id)}
      data-thread={thread.id}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">{thread.anchor ? <Quote text={thread.quote} /> : <p className="mb-2 text-xs text-neutral-400">{t("comments.onPage")}</p>}</div>
        {canComment && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              void resolve(!resolved);
            }}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            title={resolved ? t("comments.reopen") : t("comments.resolve")}
            aria-label={resolved ? t("comments.reopen") : t("comments.resolve")}
          >
            {resolved ? <RotateCcw size={14} /> : <Check size={14} />}
          </button>
        )}
      </div>
      <div className="space-y-3">
        {thread.comments.map((c) => (
          <Comment key={c.id} comment={c} pageId={pageId} threadId={thread.id} canComment={canComment} />
        ))}
      </div>
      {resolved && <p className="mt-2 text-xs text-neutral-500">{t("comments.resolvedBy", { name: thread.resolvedByName ?? "?" })}</p>}
      {canComment && active && (
        <div className="mt-3">
          <Composer
            autoFocus={false}
            placeholder={t("comments.replyPlaceholder")}
            onSubmit={(body) => update(() => api<{ thread: CommentThread }>(`/comments/threads/${thread.id}/replies`, { method: "POST", body: { body } }))}
          />
        </div>
      )}
    </div>
  );
}

const when = (iso: string) => {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString(intlLocale(), { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString(intlLocale(), { day: "numeric", month: "short" });
};

function Comment({ comment, pageId, threadId, canComment }: { comment: CommentInfo; pageId: string; threadId: string; canComment: boolean }) {
  const { user } = useSession();
  const update = useThreadUpdate(pageId);
  const users = useUserDirectory();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [editing, setEditing] = useState(false);
  const mine = canComment && comment.authorId === user?.id;
  return (
    <div className="group text-sm" data-comment={comment.id}>
      <div className="mb-0.5 flex items-center gap-2">
        <Avatar name={comment.authorName} url={comment.authorAvatarUrl} size={20} />
        <span className="font-medium">{comment.authorName}</span>
        <span className="text-xs text-neutral-400" title={new Date(comment.createdAt).toLocaleString(intlLocale())}>
          {when(comment.createdAt)}
          {comment.editedAt && ` · ${t("comments.edited")}`}
        </span>
        {mine && !editing && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenu(e.currentTarget);
            }}
            className="ml-auto rounded p-0.5 text-neutral-400 opacity-0 group-hover:opacity-100 hover:bg-neutral-100 focus:opacity-100 touch:opacity-100 dark:hover:bg-neutral-800"
            aria-label={t("comments.options")}
          >
            <MoreHorizontal size={14} />
          </button>
        )}
      </div>
      {editing ? (
        <Composer
          autoFocus
          initial={comment.body}
          submitLabel={t("common.save")}
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            await update(() => api<{ thread: CommentThread }>(`/comments/${comment.id}`, { method: "PATCH", body: { body } }));
            setEditing(false);
          }}
        />
      ) : (
        <p className="whitespace-pre-wrap break-words pl-7 text-neutral-800 dark:text-neutral-200">
          <CommentText body={comment.body} users={users.data ?? []} />
        </p>
      )}
      {menu && (
        <Popover anchor={menu} onClose={() => setMenu(null)} width={180}>
          <button
            className="w-full rounded px-2 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
            onClick={() => {
              setMenu(null);
              setEditing(true);
            }}
          >
            {t("comments.edit")}
          </button>
          <button
            className="w-full rounded px-2 py-1.5 text-left text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
            onClick={() => {
              setMenu(null);
              if (confirm(t("comments.confirmDelete"))) void update(() => api<{ thread: CommentThread | null }>(`/comments/${comment.id}`, { method: "DELETE" }), threadId);
            }}
          >
            {t("comments.delete")}
          </button>
        </Popover>
      )}
    </div>
  );
}

/** A comment's text, with mentions shown as names. */
function CommentText({ body, users }: { body: string; users: UserDirectoryEntry[] }) {
  return (
    <>
      {body.split(/(<@[A-Za-z0-9-]+>)/).map((part, i) => {
        const id = /^<@([A-Za-z0-9-]+)>$/.exec(part)?.[1];
        if (!id) return part;
        return (
          <span key={i} className="rounded bg-blue-50 px-0.5 font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
            @{users.find((u) => u.id === id)?.name ?? "?"}
          </span>
        );
      })}
    </>
  );
}

/**
 * Where a comment is written. Typing "@" offers the people of the instance; a picked person is written "@Name" and
 * sent as a mention.
 */
function Composer({
  onSubmit,
  onCancel,
  placeholder,
  initial = "",
  submitLabel = t("comments.send"),
  autoFocus,
}: {
  onSubmit: (body: string) => Promise<unknown>;
  onCancel?: () => void;
  placeholder?: string;
  initial?: string;
  submitLabel?: string;
  autoFocus?: boolean;
}) {
  const users = useUserDirectory();
  const { user } = useSession();
  const people = users.data ?? [];
  const [mentioned, setMentioned] = useState<Map<string, string>>(() => new Map());
  const [text, setText] = useState(() => initial.replace(/<@([A-Za-z0-9-]+)>/g, (_, id: string) => `@${people.find((u) => u.id === id)?.name ?? "?"}`));
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState<{ at: number; text: string } | null>(null);
  const [selected, setSelected] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  // Where the caret goes once a picked name is in the text, before anything else is typed.
  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    ref.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [text]);

  // People mentioned in a comment being edited stay mentions.
  useEffect(() => {
    if (!initial) return;
    const ids = [...initial.matchAll(/<@([A-Za-z0-9-]+)>/g)].map((m) => m[1]!);
    setMentioned(new Map(people.filter((u) => ids.includes(u.id)).map((u) => [u.name, u.id])));
  }, [initial, people]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const matches = useMemo(() => {
    if (!query) return [];
    const q = query.text.toLowerCase();
    return people.filter((u) => u.id !== user?.id && (u.name.toLowerCase().includes(q) || u.email.toLowerCase().startsWith(q))).slice(0, 6);
  }, [query, people, user?.id]);

  function onChange(value: string, caret: number) {
    setText(value);
    const before = value.slice(0, caret);
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(before);
    setQuery(m ? { at: caret - m[2]!.length - 1, text: m[2]! } : null);
    setSelected(0);
  }

  function pick(person: UserDirectoryEntry) {
    if (!query) return;
    const caret = query.at + 1 + query.text.length;
    const next = `${text.slice(0, query.at)}@${person.name} ${text.slice(caret)}`;
    setText(next);
    setMentioned((m) => new Map(m).set(person.name, person.id));
    setQuery(null);
    pendingCaret.current = query.at + person.name.length + 2;
  }

  async function submit() {
    let body = text.trim();
    if (!body || busy) return;
    // Longest names first, so "@Ada Lovelace" wins over "@Ada".
    for (const [name, id] of [...mentioned].sort((a, b) => b[0].length - a[0].length)) body = body.split(`@${name}`).join(`<@${id}>`);
    setBusy(true);
    try {
      await onSubmit(body);
      setText("");
      setMentioned(new Map());
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (query && matches.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((i) => (i + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(matches[selected]!);
        return;
      }
    }
    if (e.key === "Escape") {
      if (query) setQuery(null);
      else onCancel?.();
      e.stopPropagation();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <textarea
        ref={ref}
        rows={Math.min(6, Math.max(1, text.split("\n").length))}
        value={text}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
        onKeyDown={onKeyDown}
        aria-label={placeholder}
        className="w-full resize-none rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-800"
        data-comment-input
      />
      {query && matches.length > 0 && (
        <ul className="nt-pop absolute bottom-full left-0 z-10 mb-1 w-64 rounded-lg border border-neutral-200 bg-white p-1 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900" data-mention-list>
          {matches.map((u, i) => (
            <li key={u.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(u);
                }}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left ${i === selected ? "bg-neutral-100 dark:bg-neutral-800" : ""}`}
              >
                <Avatar name={u.name} url={u.avatarUrl} size={20} />
                <span className="truncate">{u.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {(text.trim() || onCancel) && (
        <div className="mt-1.5 flex justify-end gap-1.5">
          {onCancel && (
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
          )}
          <Button className="px-2.5 py-1 text-xs" disabled={busy || !text.trim()} onClick={() => void submit()}>
            {submitLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
