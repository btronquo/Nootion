import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { intlLocale, t } from "@nootion/shared";
import { useLastSaved } from "../lib/saved";

const time = (d: Date) => new Intl.DateTimeFormat(intlLocale(), { hour: "2-digit", minute: "2-digit" }).format(d);
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

function label(d: Date) {
  const now = new Date();
  if (sameDay(d, now)) return t("page.editedToday", { time: time(d) });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return t("page.editedYesterday", { time: time(d) });
  const day = new Intl.DateTimeFormat(intlLocale(), {
    day: "numeric",
    month: "short",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  }).format(d);
  return t("page.editedOn", { date: day, time: time(d) });
}

/** "Saved" for a moment after your own edit is on the server, then "Edited at 14:32". */
export function EditedAt({ pageId, updatedAt }: { pageId: string; updatedAt: string }) {
  const local = useLastSaved(pageId);
  const at = new Date(Math.max(Date.parse(updatedAt) || 0, local?.at ?? 0));
  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => {
    if (!local?.own) return;
    setJustSaved(true);
    const timer = window.setTimeout(() => setJustSaved(false), 2000);
    return () => window.clearTimeout(timer);
  }, [local]);
  // Ticks once a minute, so "today" becomes "yesterday" after midnight.
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  if (!at.getTime()) return null;
  const full = new Intl.DateTimeFormat(intlLocale(), { dateStyle: "full", timeStyle: "short" }).format(at);
  return (
    <span
      className="hidden items-center gap-1 px-2 text-xs whitespace-nowrap text-neutral-400 md:flex"
      title={t("page.editedFull", { date: full })}
      data-edited-at
    >
      {justSaved ? (
        <span className="flex items-center gap-1 animate-[nt-fade-in_200ms_ease-out]">
          <Check size={12} /> {t("page.saved")}
        </span>
      ) : (
        <span className="animate-[nt-fade-in_200ms_ease-out]">{label(at)}</span>
      )}
    </span>
  );
}
