import { useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Bell, X } from "lucide-react";
import { DAY_REMINDERS, TIME_REMINDERS, reminderTime, t } from "@nootion/shared";
import { Popover } from "../database/Popover";
import { useSession } from "../lib/session";
import { formatMentionDate, reminderLabel } from "../lib/reminders";

type Attrs = { id: string | null; date: string | null; reminder: number | null; remindAt: string | null; remindUser: string | null };

/** A date in the text. Clicked in an editable page, it opens its date, time and reminder. */
export function DateMentionView({ node, editor, updateAttributes }: NodeViewProps) {
  const attrs = node.attrs as Attrs;
  const { user } = useSession();
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  if (!attrs.date) return <NodeViewWrapper as="span" />;
  const mine = !!user && attrs.remindUser === user.id;
  const reminded = attrs.reminder !== null && !!attrs.remindUser;
  const past = attrs.remindAt ? new Date(attrs.remindAt) < new Date() : false;

  return (
    <NodeViewWrapper as="span" contentEditable={false} data-date-mention={attrs.date}>
      <span
        ref={ref}
        role="button"
        tabIndex={-1}
        onClick={() => editor.isEditable && setOpen(true)}
        title={
          reminded ? (mine ? t("date.reminderSet", { when: reminderLabel(attrs.reminder!, attrs.date.includes("T")) }) : t("date.reminderOther")) : undefined
        }
        className={`date-mention ${reminded && mine ? (past ? "date-mention-past" : "date-mention-remind") : ""}`}
      >
        {reminded && <Bell size={12} className="mr-0.5 inline align-[-1px]" aria-hidden />}
        {formatMentionDate(attrs.date)}
      </span>
      {open && <DateEditor anchor={ref.current} attrs={attrs} userId={user?.id ?? null} onChange={updateAttributes} onClose={() => setOpen(false)} />}
    </NodeViewWrapper>
  );
}

function DateEditor({
  anchor,
  attrs,
  userId,
  onChange,
  onClose,
}: {
  anchor: HTMLElement | null;
  attrs: Attrs;
  userId: string | null;
  onChange: (a: Partial<Attrs>) => void;
  onClose: () => void;
}) {
  const date = attrs.date!;
  const [day, time = ""] = date.split("T");
  // Someone else's reminder stays theirs until changed here.
  const theirs = attrs.reminder !== null && attrs.remindUser !== userId;

  /** A new date keeps the reminder and whose it is; a reminder chosen here becomes the user's. */
  function set(nextDate: string, reminder: number | null, owner = attrs.remindUser) {
    const withTime = nextDate.includes("T");
    // A reminder that doesn't exist for the new kind of date goes back to "at the time".
    const allowed: readonly number[] = withTime ? TIME_REMINDERS : DAY_REMINDERS;
    const r = reminder === null || !owner ? null : allowed.includes(reminder) ? reminder : 0;
    onChange({
      date: nextDate,
      reminder: r,
      remindAt: r === null ? null : reminderTime(nextDate, r).toISOString(),
      remindUser: r === null ? null : owner,
    });
  }

  const field = "w-full rounded border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700";
  return (
    <Popover anchor={anchor} onClose={onClose} width={260}>
      <div className="space-y-2 p-2" data-date-editor>
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500">{t("date.day")}</span>
          <input
            type="date"
            className={field}
            value={day}
            onChange={(e) => e.target.value && set(time ? `${e.target.value}T${time}` : e.target.value, attrs.reminder)}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500">{t("date.time")}</span>
          <span className="flex items-center gap-1">
            <input type="time" className={field} value={time} onChange={(e) => set(e.target.value ? `${day}T${e.target.value}` : day!, attrs.reminder)} />
            {time && (
              <button
                onClick={() => set(day!, attrs.reminder)}
                title={t("date.clearTime")}
                aria-label={t("date.clearTime")}
                className="rounded p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <X size={14} />
              </button>
            )}
          </span>
        </label>
        {userId && (
          <label className="block">
            <span className="mb-1 flex items-center gap-1 text-xs text-neutral-500">
              <Bell size={12} /> {t("date.reminder")}
            </span>
            <select
              className={field}
              value={theirs || attrs.reminder === null ? "" : String(attrs.reminder)}
              onChange={(e) => set(date, e.target.value === "" ? null : Number(e.target.value), userId)}
            >
              <option value="">{theirs ? t("date.reminderOther") : t("date.reminderNone")}</option>
              {(time ? TIME_REMINDERS : DAY_REMINDERS).map((m) => (
                <option key={m} value={m}>
                  {reminderLabel(m, !!time)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </Popover>
  );
}
