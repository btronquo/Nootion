import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Repeat } from "lucide-react";
import { intlLocale, t, type PageDetail, type Recurrence, type RecurrenceRule } from "@nootion/shared";
import { api } from "../lib/api";
import { useDatabase } from "../database/hooks";
import { PagePicker } from "../buttons/ButtonEditor";
import { Button, CancelButton, Modal, Select } from "./ui";

export const recurrenceKey = (templateId: string) => ["recurrence", templateId] as const;

export function useRecurrence(templateId: string) {
  return useQuery({
    queryKey: recurrenceKey(templateId),
    queryFn: async () => (await api<{ recurrence: Recurrence | null }>(`/pages/${templateId}/recurrence`)).recurrence,
  });
}

/** Weekday names, 0 = Sunday, in the interface language. */
function weekdayName(day: number, width: "long" | "short") {
  // 2023-01-01 was a Sunday.
  return new Date(Date.UTC(2023, 0, 1 + day)).toLocaleDateString(intlLocale(), { weekday: width, timeZone: "UTC" });
}

/** "Every week on Monday and Thursday at 08:00". */
export function recurrenceText(rule: RecurrenceRule): string {
  const every = t(`recurrence.every.${rule.frequency}`, { count: rule.interval });
  if (rule.frequency === "daily") return t("recurrence.summary.daily", { every, time: rule.time });
  if (rule.frequency === "monthly") return t("recurrence.summary.monthly", { every, day: rule.monthDay, time: rule.time });
  // Monday first.
  const days = [...rule.weekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => weekdayName(d, "long"));
  return t("recurrence.summary.weekly", { every, days: new Intl.ListFormat(intlLocale(), { type: "conjunction" }).format(days), time: rule.time });
}

export const nextRunText = (r: Recurrence) =>
  r.enabled && r.nextRunAt
    ? t("recurrence.next", { when: new Date(r.nextRunAt).toLocaleString(intlLocale(), { dateStyle: "medium", timeStyle: "short" }) })
    : t("recurrence.paused");

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Sets when a template makes a new page (or row) by itself, or stops it. */
export function RecurrenceDialog({ page, recurrence, onClose }: { page: PageDetail; recurrence: Recurrence | null; onClose: () => void }) {
  const row = page.kind === "row";
  const qc = useQueryClient();
  const database = useDatabase(row ? (page.parentId ?? "") : "");
  const dateColumns = (database.data?.properties ?? []).filter((p) => p.type === "date");
  const [rule, setRule] = useState<RecurrenceRule>(
    () =>
      recurrence ?? {
        frequency: "weekly",
        interval: 1,
        weekdays: [new Date().getDay()],
        monthDay: new Date().getDate(),
        time: "08:00",
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        startDate: today(),
        parentId: row ? null : page.parentId,
        dateProperty: null,
        enabled: true,
      },
  );
  // A row template fills the first date column unless told otherwise.
  const [dateChoice, setDateChoice] = useState<string | null | undefined>(recurrence ? recurrence.dateProperty : undefined);
  const dateProperty = dateChoice === undefined ? (dateColumns[0]?.id ?? null) : dateChoice;
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const closeRef = useRef<(() => void) | null>(null);
  const set = (patch: Partial<RecurrenceRule>) => setRule((r) => ({ ...r, ...patch }));
  const input =
    "rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-900";
  const field = (label: string, control: React.ReactNode, help?: string) => (
    <div className="text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {control}
      {help && <p className="mt-1 text-xs text-neutral-500">{help}</p>}
    </div>
  );

  async function done(request: Promise<unknown>) {
    setSaving(true);
    setError(null);
    try {
      await request;
      await qc.invalidateQueries({ queryKey: recurrenceKey(page.id) });
      closeRef.current?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={t("recurrence.title")} onClose={onClose} closeRef={closeRef}>
      <form
        className="space-y-4"
        data-recurrence-form
        onSubmit={(e) => {
          e.preventDefault();
          void done(api(`/pages/${page.id}/recurrence`, { method: "PUT", body: { ...rule, dateProperty: row ? dateProperty : null } }));
        }}
      >
        <p className="text-sm text-neutral-500">{t(row ? "recurrence.helpRow" : "recurrence.help")}</p>
        <div className="flex flex-wrap gap-4">
          {field(
            t("recurrence.frequency"),
            <Select
              className="py-2"
              value={rule.frequency}
              onChange={(e) => set({ frequency: e.target.value as RecurrenceRule["frequency"] })}
              name="frequency"
            >
              <option value="daily">{t("recurrence.daily")}</option>
              <option value="weekly">{t("recurrence.weekly")}</option>
              <option value="monthly">{t("recurrence.monthly")}</option>
            </Select>,
          )}
          {field(
            t("recurrence.interval"),
            <span className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={52}
                name="interval"
                className={`${input} w-16`}
                value={rule.interval}
                onChange={(e) => set({ interval: Math.min(52, Math.max(1, Number(e.target.value) || 1)) })}
              />
              {t(`recurrence.unit.${rule.frequency}`, { count: rule.interval })}
            </span>,
          )}
          {field(
            t("recurrence.time"),
            <input type="time" required name="time" className={input} value={rule.time} onChange={(e) => set({ time: e.target.value })} />,
          )}
        </div>
        {rule.frequency === "weekly" &&
          field(
            t("recurrence.weekdays"),
            <div className="flex flex-wrap gap-1" data-weekdays>
              {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                const on = rule.weekdays.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    title={weekdayName(d, "long")}
                    onClick={() => set({ weekdays: on ? rule.weekdays.filter((x) => x !== d) : [...rule.weekdays, d] })}
                    className={`min-w-11 rounded-md border px-2 py-1.5 text-sm capitalize transition ${
                      on
                        ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                        : "border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                    }`}
                  >
                    {weekdayName(d, "short")}
                  </button>
                );
              })}
            </div>,
          )}
        {rule.frequency === "monthly" &&
          field(
            t("recurrence.monthDay"),
            <input
              type="number"
              min={1}
              max={31}
              name="monthDay"
              className={`${input} w-20`}
              value={rule.monthDay}
              onChange={(e) => set({ monthDay: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })}
            />,
            rule.monthDay > 28 ? t("recurrence.monthDayHelp") : undefined,
          )}
        {field(
          t("recurrence.startDate"),
          <input type="date" required name="startDate" className={input} value={rule.startDate} onChange={(e) => set({ startDate: e.target.value })} />,
          t("recurrence.timeZone", { zone: rule.timeZone }),
        )}
        {row
          ? field(
              t("recurrence.dateProperty"),
              <Select className="py-2" value={dateProperty ?? ""} name="dateProperty" onChange={(e) => setDateChoice(e.target.value || null)}>
                <option value="">{t("recurrence.noDateProperty")}</option>
                {dateColumns.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>,
              t("recurrence.datePropertyHelp"),
            )
          : field(
              t("recurrence.parent"),
              <PagePicker value={rule.parentId} emptyLabel={t("recurrence.noParent")} onChange={(parentId) => set({ parentId })} />,
            )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-blue-600" checked={rule.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          {t("recurrence.enabled")}
        </label>
        {recurrence?.lastError && (
          <p className="flex items-start gap-1 text-xs text-red-600 dark:text-red-400">
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            {t("recurrence.lastError", { error: recurrence.lastError })}
          </p>
        )}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            {recurrence && (
              <Button type="button" variant="danger" disabled={saving} onClick={() => void done(api(`/pages/${page.id}/recurrence`, { method: "DELETE" }))}>
                {t("recurrence.stop")}
              </Button>
            )}
          </span>
          <span className="flex gap-2">
            <CancelButton onClose={onClose} />
            <Button type="submit" disabled={saving || (!row && !rule.parentId)}>
              <Repeat size={14} /> {t("common.save")}
            </Button>
          </span>
        </div>
      </form>
    </Modal>
  );
}
