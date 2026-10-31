import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AtSign, Bell, BellOff, Check, MessageSquare } from "lucide-react";
import { intlLocale, t, type CommentNotification, type Reminder } from "@nootion/shared";
import { commentNotificationsKey, useCommentNotifications } from "../comments/queries";
import { api } from "../lib/api";
import { pageTitle } from "../lib/tree";
import { disablePush, enablePush, formatMentionDate, pushState, remindersKey, useReminders, type PushState } from "../lib/reminders";
import { Button } from "../components/ui";

/** Mentions and replies in comments; they count as read once seen here. */
function CommentNotifications() {
  const notifications = useCommentNotifications();
  const qc = useQueryClient();
  const list = notifications.data ?? [];
  const unread = list
    .filter((n) => !n.read)
    .map((n) => n.id)
    .join(",");
  useEffect(() => {
    if (!unread) return;
    const timer = setTimeout(async () => {
      await api("/comments/notifications/read", { method: "POST", body: { ids: unread.split(",") } });
      // Still shown as new until the next visit, but no longer counted.
      qc.setQueryData<CommentNotification[]>(commentNotificationsKey, (old) =>
        old?.map((n) => (unread.includes(n.id) ? { ...n, read: true, wasUnread: true } : n)),
      );
    }, 1500);
    return () => clearTimeout(timer);
  }, [unread, qc]);
  if (!list.length) return null;
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-neutral-500">{t("comments.notifications")}</h2>
      <ul
        className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800"
        data-comment-notifications
      >
        {list.slice(0, 20).map((n) => {
          const fresh = !n.read || (n as { wasUnread?: boolean }).wasUnread;
          return (
            <li key={n.id} className={`text-sm transition-colors ${fresh ? "bg-blue-50/50 dark:bg-blue-950/20" : ""}`} data-comment-notification={n.id}>
              <Link
                to={n.threadId ? `/page/${n.pageId}?comment=${n.threadId}` : `/page/${n.pageId}`}
                onClick={() => {
                  if (n.read) return;
                  qc.setQueryData<CommentNotification[]>(commentNotificationsKey, (old) => old?.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
                  void api("/comments/notifications/read", { method: "POST", body: { ids: [n.id] } });
                }}
                className="flex items-start gap-3 px-3 py-2"
              >
                {n.kind !== "reply" ? (
                  <AtSign size={16} className="mt-0.5 shrink-0 text-blue-600" />
                ) : (
                  <MessageSquare size={16} className="mt-0.5 shrink-0 text-neutral-400" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block">{t(n.kind === "page_mention" ? "mentions.mentionedYou" : n.kind === "mention" ? "comments.mentionedYou" : "comments.repliedToYou", {
                      name: n.actorName,
                    })}</span>
                  <span className="block truncate text-neutral-600 dark:text-neutral-300">{n.excerpt}</span>
                  <span className="block truncate text-xs text-neutral-500">
                    {n.pageIcon ?? "📄"} {pageTitle(n.pageTitle)} ·{" "}
                    {new Date(n.createdAt).toLocaleString(intlLocale(), { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The user's reminders: the ones due now, then the ones to come. */
export function RemindersPage() {
  const reminders = useReminders();
  const qc = useQueryClient();
  const list = reminders.data ?? [];
  const due = list.filter((r) => r.due);
  const upcoming = list.filter((r) => !r.due);

  async function dismiss(r: Reminder) {
    qc.setQueryData<Reminder[]>(remindersKey, (old) => old?.filter((x) => x.id !== r.id));
    await api(`/reminders/${r.id}/dismiss`, { method: "POST" });
    await qc.invalidateQueries({ queryKey: remindersKey });
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8 sm:py-12">
      <h1 className="mb-4 text-2xl font-bold">{t("reminders.title")}</h1>
      <PushSwitch />
      <CommentNotifications />
      {reminders.isSuccess && list.length === 0 && <p className="text-neutral-500">{t("reminders.empty")}</p>}
      {[
        { title: t("reminders.due"), items: due },
        { title: t("reminders.upcoming"), items: upcoming },
      ]
        .filter((s) => s.items.length)
        .map((s) => (
          <section key={s.title} className="mb-8">
            <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-neutral-500">{s.title}</h2>
            <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800" data-reminders>
              {s.items.map((r) => (
                <li key={r.id} className="flex items-start gap-3 px-3 py-2 text-sm" data-reminder={r.id}>
                  <Bell size={16} className={`mt-0.5 shrink-0 ${r.due ? "text-red-600 dark:text-red-400" : "text-neutral-400"}`} />
                  <Link to={`/page/${r.pageId}`} className="min-w-0 flex-1">
                    <span className="block font-medium">{formatMentionDate(r.date)}</span>
                    {r.text && <span className="block truncate text-neutral-600 dark:text-neutral-300">{r.text}</span>}
                    <span className="block truncate text-xs text-neutral-500">
                      {r.pageIcon ?? "📄"} {pageTitle(r.pageTitle)} ·{" "}
                      {t("reminders.at", { when: new Date(r.remindAt).toLocaleString(intlLocale(), { dateStyle: "medium", timeStyle: "short" }) })}
                    </span>
                  </Link>
                  <Button variant="ghost" onClick={() => dismiss(r)} title={t("reminders.done")}>
                    <Check size={14} /> <span className="hidden sm:inline">{t("reminders.done")}</span>
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}

/** Notifications on this device, even with the app closed. */
function PushSwitch() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void pushState().then(setState);
  }, []);
  if (!state) return null;

  async function run(action: () => Promise<PushState>) {
    setBusy(true);
    try {
      setState(await action());
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const box =
    "mb-6 flex flex-wrap items-center gap-2 rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-600 dark:bg-neutral-800/60 dark:text-neutral-300";
  if (state === "on")
    return (
      <div className={box} data-push="on">
        <Bell size={14} /> {t("reminders.notifyActive")}
        <Button variant="ghost" className="ml-auto" disabled={busy} onClick={() => run(disablePush)}>
          <BellOff size={14} /> {t("reminders.notifyOff")}
        </Button>
      </div>
    );
  if (state === "off")
    return (
      <div className="mb-6" data-push="off">
        <Button disabled={busy} onClick={() => run(enablePush)}>
          <Bell size={14} /> {t("reminders.notifyOn")}
        </Button>
      </div>
    );
  return (
    <p className={box} data-push={state}>
      <BellOff size={14} />{" "}
      {state === "denied" ? t("reminders.notifyDenied") : state === "insecure" ? t("reminders.notifyInsecure") : t("reminders.notifyUnsupported")}
    </p>
  );
}
