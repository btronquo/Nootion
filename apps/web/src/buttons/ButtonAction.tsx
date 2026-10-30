import { useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { t, type ButtonColor, type ButtonConfig, type FormField, type RunButtonInput, type RunButtonResult } from "@nootion/shared";
import { api } from "../lib/api";
import { useUserDirectory } from "../lib/queries";
import { Button, ErrorText, Modal, Select } from "../components/ui";
import { Popover } from "../database/Popover";

export const BUTTON_STYLES: Record<ButtonColor, string> = {
  default:
    "border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700",
  blue: "border-blue-600 bg-blue-600 text-white hover:bg-blue-700",
  green: "border-green-600 bg-green-600 text-white hover:bg-green-700",
  orange: "border-orange-500 bg-orange-500 text-white hover:bg-orange-600",
  red: "border-red-600 bg-red-600 text-white hover:bg-red-700",
  purple: "border-violet-600 bg-violet-600 text-white hover:bg-violet-700",
};

const pad = (n: number) => String(n).padStart(2, "0");
/** Now, in the clicker's time zone: "2026-11-02T08:30". */
export function localNow(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A button that runs its steps on the server, after its form if it has one, then opens what they asked for. */
export function ButtonAction({
  config,
  source,
  label,
  compact,
}: {
  config: ButtonConfig;
  source: RunButtonInput["source"] | null;
  /** Shown when the button has no label of its own. */
  label: string;
  compact?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const runnable = !!source && config.steps.length > 0;

  async function run(answers: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await api<RunButtonResult>("/buttons/run", { method: "POST", body: { source, form: answers, now: localNow() } });
      setForm(false);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
      void qc.invalidateQueries();
      if (res.open?.startsWith("/")) navigate(res.open);
      else if (res.open) window.open(res.open, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        ref={ref}
        type="button"
        disabled={!runnable || busy}
        title={runnable ? undefined : t("button.nothingToDo")}
        onClick={(e) => {
          e.stopPropagation();
          if (config.form) setForm(true);
          else void run({}).catch(() => undefined);
        }}
        className={`inline-flex max-w-full items-center gap-1.5 rounded-md border font-medium shadow-sm transition disabled:cursor-default disabled:opacity-60 ${
          compact ? "px-2 py-0.5 text-xs" : "px-3 py-1.5 text-sm"
        } ${BUTTON_STYLES[config.color]}`}
        data-button-run
      >
        {busy && <Loader2 size={compact ? 12 : 14} className="animate-spin" />}
        {done && <Check size={compact ? 12 : 14} />}
        <span className="truncate">{config.label || label}</span>
      </button>
      {error && !form && (
        <Popover anchor={ref.current} onClose={() => setError(null)} width={300}>
          <div className="p-2" data-button-error>
            <ErrorText error={error} />
          </div>
        </Popover>
      )}
      {form &&
        config.form &&
        createPortal(
          <ButtonForm
            title={config.form.title || config.label || label}
            fields={config.form.fields}
            busy={busy}
            error={error}
            onSubmit={(answers) => run(answers).catch(() => undefined)}
            onClose={() => {
              setForm(false);
              setError(null);
            }}
          />,
          document.body,
        )}
    </>
  );
}

/** The form a button asks to fill in before its steps run. */
export function ButtonForm({
  title,
  fields,
  busy,
  error,
  onSubmit,
  onClose,
  submitLabel = t("button.submit"),
}: {
  title: string;
  fields: FormField[];
  busy: boolean;
  error: unknown;
  onSubmit: (answers: Record<string, unknown>) => void;
  onClose?: () => void;
  submitLabel?: string;
}) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const set = (id: string, value: unknown) => setAnswers((a) => ({ ...a, [id]: value }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(answers);
  };
  const body = (
    <form onSubmit={submit} className="space-y-3" data-button-form>
      {fields.map((f) => (
        <FormFieldInput key={f.id} field={f} value={answers[f.id]} onChange={(v) => set(f.id, v)} />
      ))}
      <ErrorText error={error} />
      <div className="flex justify-end gap-2 pt-1">
        {onClose && (
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        )}
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 size={14} className="animate-spin" />} {submitLabel}
        </Button>
      </div>
    </form>
  );
  if (!onClose) return body;
  return (
    <Modal title={title} onClose={onClose}>
      {body}
    </Modal>
  );
}

const inputClass =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-900";

function FormFieldInput({ field, value, onChange }: { field: FormField; value: unknown; onChange: (v: unknown) => void }) {
  const users = useUserDirectory();
  const label = (
    <span className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
      {field.label}
      {field.required && <span className="text-red-500"> *</span>}
    </span>
  );
  const text = typeof value === "string" ? value : "";
  switch (field.type) {
    case "checkbox":
      return (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-blue-600" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          {field.label}
        </label>
      );
    case "long_text":
      return (
        <label className="block">
          {label}
          <textarea className={inputClass} rows={4} value={text} required={field.required} onChange={(e) => onChange(e.target.value)} />
        </label>
      );
    case "select":
      return (
        <label className="block">
          {label}
          <Select className="w-full py-2" value={text} required={field.required} onChange={(e) => onChange(e.target.value)}>
            <option value="">—</option>
            {(field.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        </label>
      );
    case "person":
      return (
        <label className="block">
          {label}
          <Select className="w-full py-2" value={text} required={field.required} onChange={(e) => onChange(e.target.value)}>
            <option value="">—</option>
            {(users.data ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </label>
      );
    default:
      return (
        <label className="block">
          {label}
          <input
            className={inputClass}
            type={field.type === "date" ? "date" : "text"}
            inputMode={field.type === "number" ? "decimal" : undefined}
            value={text}
            required={field.required}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      );
  }
}
