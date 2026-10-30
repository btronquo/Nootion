import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { dateFromString, intlLocale, t, type Reminder } from "@nootion/shared";
import { api } from "./api";

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "Tomorrow at 9:00 AM", "Fri, Nov 6", "Jan 5, 2027": a date written in a page. */
export function formatMentionDate(date: string, now = new Date()): string {
  const d = dateFromString(date);
  const days = Math.round((startOfDay(d) - startOfDay(now)) / 86_400_000);
  let day: string;
  if (Math.abs(days) <= 1) {
    const rel = new Intl.RelativeTimeFormat(intlLocale(), { numeric: "auto" }).format(days, "day");
    day = rel.charAt(0).toUpperCase() + rel.slice(1);
  } else {
    const sameYear = d.getFullYear() === now.getFullYear();
    day = d.toLocaleDateString(
      intlLocale(),
      sameYear ? { weekday: "short", day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" },
    );
  }
  if (!date.includes("T")) return day;
  return t("date.atTime", { day, time: d.toLocaleTimeString(intlLocale(), { hour: "2-digit", minute: "2-digit" }) });
}

/** How a reminder is set, in words: "15 minutes before", "On the day (9:00)". */
export function reminderLabel(minutes: number, withTime: boolean): string {
  if (minutes === 0) return withTime ? t("date.reminderAtTime") : t("date.reminderDayOf");
  if (!withTime) return minutes === 10080 ? t("date.reminderWeekAt9") : t("date.reminderDaysAt9", { count: minutes / 1440 });
  if (minutes < 60) return t("date.reminderMinutes", { count: minutes });
  if (minutes < 1440) return t("date.reminderHours", { count: minutes / 60 });
  return t("date.reminderDays", { count: minutes / 1440 });
}

export const remindersKey = ["reminders"] as const;

/** The user's reminders, checked every minute. */
export function useReminders() {
  return useQuery({
    queryKey: remindersKey,
    queryFn: async () => (await api<{ reminders: Reminder[] }>("/reminders")).reminders,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });
}

const SHOWN = "nootion-reminders-shown";

/**
 * Shows reminders as notifications when they fall due while the app is open. Devices that receive Web Push get the
 * same notification from the server: both carry the reminder's id as tag, so only one stays.
 */
export function useReminderNotifications() {
  const { data } = useReminders();
  useEffect(() => {
    if (!data || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    let shown: string[] = [];
    try {
      shown = JSON.parse(localStorage.getItem(SHOWN) ?? "[]");
    } catch {
      // Private browsing: shown again after a reload at worst.
    }
    const fresh = data.filter((r) => r.due && !shown.includes(r.id) && Date.now() - new Date(r.remindAt).getTime() < 24 * 3600_000);
    if (!fresh.length) return;
    void (async () => {
      const reg = await navigator.serviceWorker?.getRegistration();
      for (const r of fresh) {
        const title = `${r.pageIcon ? `${r.pageIcon} ` : ""}${r.pageTitle || "Nootion"}`;
        const options = { body: r.text || formatMentionDate(r.date), tag: r.id, data: { url: `/page/${r.pageId}` } };
        if (reg) await reg.showNotification(title, options);
        else new Notification(title, options).onclick = () => window.open(`/page/${r.pageId}`, "_self");
      }
    })();
    try {
      // Only the ones still listed are kept.
      const ids = new Set(data.map((r) => r.id));
      localStorage.setItem(SHOWN, JSON.stringify([...shown.filter((id) => ids.has(id)), ...fresh.map((r) => r.id)]));
    } catch {
      // Not kept.
    }
  }, [data]);
}

export type PushState = "unsupported" | "insecure" | "denied" | "off" | "on";

const urlKey = (base64: string) => {
  const raw = atob((base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** Whether this device receives reminders from the server (Web Push), even with the app closed. */
export async function pushState(): Promise<PushState> {
  if (!window.isSecureContext) return "insecure";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ? "on" : "off";
}

export async function enablePush(): Promise<PushState> {
  if ((await Notification.requestPermission()) !== "granted") return Notification.permission === "denied" ? "denied" : "off";
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;
  const { publicKey } = await api<{ publicKey: string }>("/reminders/push-key");
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlKey(publicKey) });
  await api("/reminders/push-subscriptions", { method: "POST", body: sub.toJSON() });
  return "on";
}

export async function disablePush(): Promise<PushState> {
  const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
  if (sub) {
    await api("/reminders/push-subscriptions", { method: "DELETE", body: { endpoint: sub.endpoint } });
    await sub.unsubscribe();
  }
  return "off";
}
