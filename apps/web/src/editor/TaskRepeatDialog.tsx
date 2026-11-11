import { useRef, useState } from "react";
import { Repeat } from "lucide-react";
import { parseTaskRepeat, t, taskRepeatString, type TaskRepeat, type TaskRepeatUnit } from "@nootion/shared";
import { Button, CancelButton, Modal, Select } from "../components/ui";
import { taskRepeatLabel, weekdayName } from "./taskRepeat";

const UNITS: TaskRepeatUnit[] = ["d", "w", "m", "y"];

/** Sets how a to-do repeats: every N days, weeks (on some days) or months (on a day), or years. */
export function TaskRepeatDialog({ initial, onSave, onClose }: { initial: string | null; onSave: (repeat: string) => void; onClose: () => void }) {
  const [rule, setRule] = useState<TaskRepeat>(() => parseTaskRepeat(initial) ?? { every: 1, unit: "w", weekdays: [], monthDay: null });
  const closeRef = useRef<(() => void) | null>(null);
  const set = (patch: Partial<TaskRepeat>) => setRule((r) => ({ ...r, ...patch }));
  const input =
    "rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-900";
  const field = (label: string, control: React.ReactNode, help?: string) => (
    <div className="text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {control}
      {help && <p className="mt-1 text-xs text-neutral-500">{help}</p>}
    </div>
  );

  return (
    <Modal title={t("task.repeatTitle")} onClose={onClose} closeRef={closeRef}>
      <form
        className="space-y-4"
        data-task-repeat-form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(taskRepeatString(rule));
          closeRef.current?.();
        }}
      >
        <p className="text-sm text-neutral-500">{t("task.repeatHelp")}</p>
        {field(
          t("task.repeatEvery"),
          <span className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={99}
              name="every"
              className={`${input} w-16`}
              value={rule.every}
              onChange={(e) => set({ every: Math.min(99, Math.max(1, Number(e.target.value) || 1)) })}
            />
            <Select className="py-2" name="unit" value={rule.unit} onChange={(e) => set({ unit: e.target.value as TaskRepeatUnit })}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {t(`task.unit.${u}`, { count: rule.every })}
                </option>
              ))}
            </Select>
          </span>,
        )}
        {rule.unit === "w" &&
          field(
            t("task.repeatWeekdays"),
            <div className="flex flex-wrap gap-1" data-weekdays>
              {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                const on = rule.weekdays.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    title={weekdayName(d)}
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
            rule.weekdays.length ? undefined : t("task.repeatWeekdaysHelp"),
          )}
        {rule.unit === "m" &&
          field(
            t("task.repeatMonthDay"),
            <input
              type="number"
              min={1}
              max={31}
              name="monthDay"
              className={`${input} w-20`}
              value={rule.monthDay ?? ""}
              onChange={(e) => set({ monthDay: e.target.value ? Math.min(31, Math.max(1, Number(e.target.value) || 1)) : null })}
            />,
            t("task.repeatMonthDayHelp"),
          )}
        <p className="flex items-center gap-1.5 text-sm font-medium" data-task-repeat-summary>
          <Repeat size={14} className="text-neutral-500" /> {taskRepeatLabel(rule)}
        </p>
        <div className="flex justify-end gap-2">
          <CancelButton onClose={onClose} />
          <Button type="submit">{t("common.save")}</Button>
        </div>
      </form>
    </Modal>
  );
}
