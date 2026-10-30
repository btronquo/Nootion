import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import {
  BUTTON_COLORS,
  BUTTON_VARIABLES,
  COMPUTED_TYPES,
  FORM_FIELD_TYPES,
  t,
  type ButtonConfig,
  type ButtonStep,
  type ButtonStepType,
  type DatabaseData,
  type DatabaseProperty,
  type DatabaseSummary,
  type FormField,
  type MessageKey,
  type PageSummary,
  type SearchResult,
} from "@nootion/shared";
import { api } from "../lib/api";
import { Button, ErrorText, Select, useClosing } from "../components/ui";
import { PropertyIcon } from "../database/icons";
import { BUTTON_STYLES } from "./ButtonAction";
import { copyText, randomId } from "../lib/browser";

const inputClass =
  "w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-900";

// The text field last focused, so that clicking a variable inserts it there.
const InsertContext = createContext<{ focus: (insert: (text: string) => void) => void; insert: (text: string) => void }>({
  focus: () => undefined,
  insert: () => undefined,
});

/** A text that may hold variables: clicking a variable below inserts it where the cursor is. */
function TemplateInput({
  value,
  onChange,
  multiline,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
  label: string;
}) {
  const { focus } = useContext(InsertContext);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  // Variables are inserted later, after other changes: always into the latest text, through the latest callback.
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  const onFocus = () =>
    focus((text) => {
      const el = ref.current;
      const current = latest.current.value;
      const start = el?.selectionStart ?? current.length;
      const end = el?.selectionEnd ?? current.length;
      latest.current.onChange(current.slice(0, start) + text + current.slice(end));
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(start + text.length, start + text.length);
      });
    });
  const props = {
    ref,
    value,
    placeholder,
    "aria-label": label,
    className: inputClass,
    onFocus,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
  };
  return multiline ? <textarea rows={3} {...props} /> : <input {...props} />;
}

const STEP_TYPES: ButtonStepType[] = ["add_row", "update_row", "create_page", "open", "webhook"];

function newStep(type: ButtonStepType): ButtonStep {
  switch (type) {
    case "add_row":
      return { type, databaseId: "", values: {}, open: false };
    case "update_row":
      return { type, values: {} };
    case "create_page":
      return { type, parentId: null, templateId: null, title: "", open: true };
    case "open":
      return { type, url: "" };
    case "webhook":
      return { type, url: "" };
  }
}

const newId = () => randomId().slice(0, 8);

/**
 * Settings of a button: its label and color, an optional form, and its steps. `rowDatabaseId` is the database of
 * the current row, when the button has one (a button column, or a button in a row's page).
 */
export function ButtonEditor({
  initial,
  rowDatabaseId,
  pageId,
  onSave,
  onClose,
  defaultLabel,
  publicSource,
}: {
  initial: ButtonConfig;
  rowDatabaseId: string | null;
  pageId: string | null;
  onSave: (config: ButtonConfig) => void;
  onClose: () => void;
  defaultLabel: string;
  /** For a button in a page: its form may get a public link. */
  publicSource?: { pageId: string; blockId: string };
}) {
  const [config, setConfig] = useState<ButtonConfig>(initial);
  const [adding, setAdding] = useState(false);
  const target = useRef<((text: string) => void) | null>(null);
  const insertCtx = { focus: (f: (text: string) => void) => (target.current = f), insert: (text: string) => target.current?.(text) };
  const rowDb = useQuery({
    queryKey: ["database", rowDatabaseId],
    queryFn: async () => (await api<{ database: DatabaseData }>(`/databases/${rowDatabaseId}`)).database,
    enabled: !!rowDatabaseId,
  });

  const setStep = (i: number, step: ButtonStep) => setConfig((c) => ({ ...c, steps: c.steps.map((s, k) => (k === i ? step : s)) }));
  const moveStep = (i: number, by: number) =>
    setConfig((c) => {
      const steps = [...c.steps];
      const [s] = steps.splice(i, 1);
      steps.splice(i + by, 0, s!);
      return { ...c, steps };
    });
  const fields = config.form?.fields ?? [];
  const setFields = (f: FormField[]) => setConfig((c) => ({ ...c, form: f.length ? { title: c.form?.title ?? "", fields: f } : null }));

  const { closing, close } = useClosing(onClose);
  const variables = [
    ...BUTTON_VARIABLES.filter((v) => rowDatabaseId || !v.startsWith("row.")),
    ...(rowDb.data?.properties ?? []).filter((p) => p.type !== "button").map((p) => `row.${p.name}`),
    ...fields.map((f) => `form.${f.label}`),
  ];

  return (
    <div
      className="nt-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-2 sm:p-4 sm:pt-[6vh]"
      data-closing={closing || undefined}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        role="dialog"
        aria-label={t("button.settings")}
        className="nt-dialog flex max-h-[calc(100dvh-16px)] w-full max-w-2xl flex-col rounded-xl border border-neutral-200 bg-white shadow-xl sm:max-h-[88vh] dark:border-neutral-800 dark:bg-neutral-900"
        onKeyDown={(e) => e.key === "Escape" && close()}
        data-button-editor
      >
        <InsertContext.Provider value={insertCtx}>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-5">
            <h2 className="text-lg font-semibold">{t("button.settings")}</h2>
            <div className="flex flex-wrap items-end gap-3">
              <label className="block min-w-48 flex-1 text-sm">
                <span className="mb-1 block font-medium">{t("button.label")}</span>
                <input
                  className={inputClass}
                  value={config.label}
                  placeholder={defaultLabel}
                  maxLength={100}
                  onChange={(e) => setConfig({ ...config, label: e.target.value })}
                />
              </label>
              <div className="flex gap-1" role="radiogroup" aria-label={t("button.color")}>
                {BUTTON_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={config.color === c}
                    aria-label={t(`button.color.${c}` as MessageKey)}
                    onClick={() => setConfig({ ...config, color: c })}
                    className={`h-7 w-7 rounded-full border-2 ${BUTTON_STYLES[c]} ${config.color === c ? "ring-2 ring-blue-400 ring-offset-1 dark:ring-offset-neutral-900" : ""}`}
                  />
                ))}
              </div>
            </div>

            <section>
              <h3 className="mb-2 text-sm font-semibold">{t("button.form")}</h3>
              {fields.length === 0 && <p className="mb-2 text-xs text-neutral-500">{t("button.formHint")}</p>}
              {config.form && (
                <TemplateFree>
                  <input
                    className={`${inputClass} mb-2`}
                    value={config.form.title}
                    placeholder={t("button.formTitle")}
                    aria-label={t("button.formTitle")}
                    onChange={(e) => setConfig({ ...config, form: { ...config.form!, title: e.target.value } })}
                  />
                </TemplateFree>
              )}
              <div className="space-y-2">
                {fields.map((f, i) => (
                  <FieldEditor
                    key={f.id}
                    field={f}
                    onChange={(nf) => setFields(fields.map((x, k) => (k === i ? nf : x)))}
                    onRemove={() => setFields(fields.filter((_, k) => k !== i))}
                  />
                ))}
              </div>
              <Button
                type="button"
                variant="ghost"
                className="mt-1"
                onClick={() =>
                  setFields([...fields, { id: newId(), label: t("button.newField", { number: fields.length + 1 }), type: "text", required: false }])
                }
              >
                <Plus size={14} /> {t("button.addField")}
              </Button>
              {publicSource && fields.length > 0 && <PublicLink source={publicSource} saved={!!initial.form} />}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold">{t("button.steps")}</h3>
              {config.steps.length === 0 && <p className="mb-2 text-xs text-neutral-500">{t("button.stepsHint")}</p>}
              <ol className="space-y-2">
                {config.steps.map((s, i) => (
                  <li key={i} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-700" data-step={s.type}>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {i + 1}. {t(`button.step.${s.type}` as MessageKey)}
                      </span>
                      <span className="flex-1" />
                      <IconButton label={t("button.moveUp")} disabled={i === 0} onClick={() => moveStep(i, -1)}>
                        <ArrowUp size={14} />
                      </IconButton>
                      <IconButton label={t("button.moveDown")} disabled={i === config.steps.length - 1} onClick={() => moveStep(i, 1)}>
                        <ArrowDown size={14} />
                      </IconButton>
                      <IconButton label={t("button.removeStep")} onClick={() => setConfig({ ...config, steps: config.steps.filter((_, k) => k !== i) })}>
                        <Trash2 size={14} />
                      </IconButton>
                    </div>
                    <StepEditor step={s} onChange={(ns) => setStep(i, ns)} rowDb={rowDb.data ?? null} pageId={pageId} />
                  </li>
                ))}
              </ol>
              {adding ? (
                <div className="mt-2 flex flex-wrap gap-1" data-add-step>
                  {STEP_TYPES.filter((type) => type !== "update_row" || rowDatabaseId).map((type) => (
                    <Button
                      key={type}
                      type="button"
                      variant="ghost"
                      className="border border-neutral-200 dark:border-neutral-700"
                      onClick={() => {
                        setConfig({ ...config, steps: [...config.steps, newStep(type)] });
                        setAdding(false);
                      }}
                    >
                      {t(`button.step.${type}` as MessageKey)}
                    </Button>
                  ))}
                </div>
              ) : (
                config.steps.length < 20 && (
                  <Button type="button" variant="ghost" className="mt-1" onClick={() => setAdding(true)}>
                    <Plus size={14} /> {t("button.addStep")}
                  </Button>
                )
              )}
            </section>
          </div>
          <div className="border-t border-neutral-200 px-4 py-2 sm:px-5 dark:border-neutral-800">
            <div className="mb-2 text-xs text-neutral-500">{t("button.variablesHint")}</div>
            <div className="mb-3 flex max-h-20 flex-wrap gap-1 overflow-y-auto" data-variables>
              {variables.map((v) => (
                <button
                  key={v}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertCtx.insert(`{{${v}}}`);
                  }}
                  className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs text-neutral-700 hover:bg-blue-100 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-blue-950"
                >
                  {v}
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={close}>
                {t("common.cancel")}
              </Button>
              <Button type="button" onClick={() => onSave(config)}>
                {t("common.save")}
              </Button>
            </div>
          </div>
        </InsertContext.Provider>
      </div>
    </div>
  );
}

/** Fields where variables make no sense: focusing them forgets the last text field. */
function TemplateFree({ children }: { children: ReactNode }) {
  const { focus } = useContext(InsertContext);
  return <div onFocus={() => focus(() => undefined)}>{children}</div>;
}

function IconButton({ label, children, ...props }: { label: string; children: ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className="rounded p-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-30 dark:hover:bg-neutral-800"
      {...props}
    >
      {children}
    </button>
  );
}

function FieldEditor({ field, onChange, onRemove }: { field: FormField; onChange: (f: FormField) => void; onRemove: () => void }) {
  return (
    <TemplateFree>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 p-2 dark:border-neutral-700" data-form-field>
        <input
          className={`${inputClass} min-w-32 flex-1`}
          value={field.label}
          aria-label={t("button.fieldLabel")}
          maxLength={100}
          onChange={(e) => onChange({ ...field, label: e.target.value })}
        />
        <Select value={field.type} aria-label={t("button.fieldType")} onChange={(e) => onChange({ ...field, type: e.target.value as FormField["type"] })}>
          {FORM_FIELD_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`button.fieldType.${type}` as MessageKey)}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" className="accent-blue-600" checked={field.required} onChange={(e) => onChange({ ...field, required: e.target.checked })} />
          {t("button.required")}
        </label>
        <IconButton label={t("button.removeField")} onClick={onRemove}>
          <Trash2 size={14} />
        </IconButton>
        {field.type === "select" && (
          <input
            className={`${inputClass} basis-full`}
            defaultValue={(field.options ?? []).join(", ")}
            placeholder={t("button.optionsPlaceholder")}
            aria-label={t("button.options")}
            onChange={(e) =>
              onChange({
                ...field,
                options: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        )}
      </div>
    </TemplateFree>
  );
}

function useDatabases() {
  return useQuery({ queryKey: ["databases"], queryFn: async () => (await api<{ databases: DatabaseSummary[] }>("/databases")).databases });
}

function StepEditor({
  step,
  onChange,
  rowDb,
  pageId,
}: {
  step: ButtonStep;
  onChange: (s: ButtonStep) => void;
  rowDb: DatabaseData | null;
  pageId: string | null;
}) {
  const databases = useDatabases();
  const templates = useQuery({ queryKey: ["page-templates"], queryFn: async () => (await api<{ pages: PageSummary[] }>("/pages/templates")).pages });
  const target = useQuery({
    queryKey: ["database", step.type === "add_row" ? step.databaseId : null],
    queryFn: async () => (await api<{ database: DatabaseData }>(`/databases/${(step as { databaseId: string }).databaseId}`)).database,
    enabled: step.type === "add_row" && !!step.databaseId,
  });
  const field = (label: string, input: ReactNode) => (
    <label className="block text-sm">
      <span className="mb-0.5 block text-xs text-neutral-500">{label}</span>
      {input}
    </label>
  );
  const openBox = (checked: boolean, set: (v: boolean) => void) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" className="accent-blue-600" checked={checked} onChange={(e) => set(e.target.checked)} />
      {t("button.openAfter")}
    </label>
  );

  switch (step.type) {
    case "add_row":
      return (
        <div className="space-y-2">
          <TemplateFree>
            {field(
              t("button.database"),
              <Select className="w-full" value={step.databaseId} onChange={(e) => onChange({ ...step, databaseId: e.target.value, values: {} })}>
                <option value="">—</option>
                {(databases.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.icon ? `${d.icon} ` : ""}
                    {d.title || t("common.untitled")}
                  </option>
                ))}
              </Select>,
            )}
          </TemplateFree>
          {target.data && <ColumnValues properties={target.data.properties} values={step.values} onChange={(values) => onChange({ ...step, values })} />}
          {field(
            t("button.content"),
            <TemplateInput multiline label={t("button.content")} value={step.content ?? ""} onChange={(content) => onChange({ ...step, content })} />,
          )}
          {openBox(step.open, (open) => onChange({ ...step, open }))}
        </div>
      );
    case "update_row":
      return rowDb ? (
        <ColumnValues properties={rowDb.properties} values={step.values} onChange={(values) => onChange({ ...step, values })} />
      ) : (
        <p className="text-xs text-amber-700 dark:text-amber-400">{t("button.noRowHint")}</p>
      );
    case "create_page":
      return (
        <div className="space-y-2">
          <TemplateFree>
            {field(
              t("button.parent"),
              <PagePicker value={step.parentId} emptyLabel={pageId ? t("button.thisPage") : "—"} onChange={(parentId) => onChange({ ...step, parentId })} />,
            )}
            {field(
              t("button.template"),
              <Select className="w-full" value={step.templateId ?? ""} onChange={(e) => onChange({ ...step, templateId: e.target.value || null })}>
                <option value="">{t("button.noTemplate")}</option>
                {(templates.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.icon ? `${p.icon} ` : ""}
                    {p.title || t("common.untitled")}
                  </option>
                ))}
              </Select>,
            )}
          </TemplateFree>
          {field(t("button.pageTitle"), <TemplateInput label={t("button.pageTitle")} value={step.title} onChange={(title) => onChange({ ...step, title })} />)}
          {field(
            t("button.content"),
            <TemplateInput multiline label={t("button.content")} value={step.content ?? ""} onChange={(content) => onChange({ ...step, content })} />,
          )}
          {openBox(step.open, (open) => onChange({ ...step, open }))}
        </div>
      );
    case "open": {
      const pagePath = /^\/page\/([\w-]+)$/.exec(step.url)?.[1] ?? null;
      return (
        <div className="space-y-2">
          <TemplateFree>
            {field(t("button.openPage"), <PagePicker value={pagePath} emptyLabel="—" onChange={(id) => onChange({ ...step, url: id ? `/page/${id}` : "" })} />)}
          </TemplateFree>
          {field(
            t("button.orLink"),
            <TemplateInput
              label={t("button.orLink")}
              placeholder="https://… {{created.url}}"
              value={pagePath ? "" : step.url}
              onChange={(url) => onChange({ ...step, url })}
            />,
          )}
        </div>
      );
    }
    case "webhook":
      return (
        <div className="space-y-2">
          {field(
            t("button.webhookUrl"),
            <TemplateInput label={t("button.webhookUrl")} placeholder="https://" value={step.url} onChange={(url) => onChange({ ...step, url })} />,
          )}
          {field(
            t("button.webhookBody"),
            <TemplateInput
              multiline
              label={t("button.webhookBody")}
              placeholder={t("button.webhookBodyPlaceholder")}
              value={step.body ?? ""}
              onChange={(body) => onChange({ ...step, body })}
            />,
          )}
        </div>
      );
  }
}

const VALUE_HINTS: Partial<Record<DatabaseProperty["type"], MessageKey>> = {
  date: "button.hint.date",
  checkbox: "button.hint.checkbox",
  select: "button.hint.select",
  multi_select: "button.hint.multiSelect",
  person: "button.hint.person",
  relation: "button.hint.relation",
};

/** A text per column: what the step writes there (empty leaves the cell as it is). */
function ColumnValues({
  properties,
  values,
  onChange,
}: {
  properties: DatabaseProperty[];
  values: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  const editable = properties.filter((p) => !COMPUTED_TYPES.includes(p.type) && p.type !== "file");
  return (
    <div className="space-y-1.5" data-column-values>
      {editable.map((p) => {
        const hint = VALUE_HINTS[p.type];
        const options = p.config.options?.map((o) => o.name).join(", ");
        return (
          <div key={p.id} className="flex items-start gap-2">
            <span className="flex w-28 shrink-0 items-center gap-1 truncate pt-1.5 text-xs text-neutral-600 sm:w-36 dark:text-neutral-400">
              <PropertyIcon type={p.type} size={12} /> <span className="truncate">{p.name}</span>
            </span>
            <div className="min-w-0 flex-1">
              <TemplateInput
                label={p.name}
                value={values[p.id] ?? ""}
                placeholder={hint ? `${t(hint)}${options ? ` : ${options}` : ""}` : undefined}
                onChange={(v) => {
                  const next = { ...values };
                  if (v) next[p.id] = v;
                  else delete next[p.id];
                  onChange(next);
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Picks a page by searching for it. */
function PagePicker({ value, onChange, emptyLabel }: { value: string | null; onChange: (id: string | null) => void; emptyLabel: string }) {
  const [query, setQuery] = useState("");
  const current = useQuery({
    queryKey: ["page", value],
    queryFn: async () => (await api<{ page: { id: string; title: string; icon: string | null } }>(`/pages/${value}`)).page,
    enabled: !!value,
  });
  const results = useQuery({
    queryKey: ["page-picker", query],
    queryFn: async () => (await api<{ results: SearchResult[] }>(`/search?q=${encodeURIComponent(query)}&limit=8`)).results.filter((r) => r.kind !== "row"),
    enabled: query.trim().length > 0,
  });
  return (
    <div className="space-y-1" data-page-picker>
      <div className="flex items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 truncate">
          {value ? (
            `${current.data?.icon ? `${current.data.icon} ` : ""}${current.data?.title || t("common.untitled")}`
          ) : (
            <span className="text-neutral-500">{emptyLabel}</span>
          )}
        </span>
        {value && (
          <button type="button" className="text-xs text-neutral-500 hover:underline" onClick={() => onChange(null)}>
            {t("button.clear")}
          </button>
        )}
      </div>
      <input
        className={inputClass}
        value={query}
        placeholder={t("button.searchPage")}
        aria-label={t("button.searchPage")}
        onChange={(e) => setQuery(e.target.value)}
      />
      {query && (results.data ?? []).length > 0 && (
        <ul className="rounded-md border border-neutral-200 dark:border-neutral-700">
          {results.data!.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="block w-full truncate px-2 py-1 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                onClick={() => {
                  onChange(r.id);
                  setQuery("");
                }}
              >
                {r.icon ? `${r.icon} ` : ""}
                {r.title || t("common.untitled")}
                {r.path.length > 0 && <span className="ml-1 text-xs text-neutral-500">· {r.path.join(" / ")}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The public link of a button's form: made, copied and removed here. */
function PublicLink({ source, saved }: { source: { pageId: string; blockId: string }; saved: boolean }) {
  const key = ["button-public-link", source.pageId, source.blockId];
  const qc = useQueryClient();
  const link = useQuery({
    queryKey: key,
    queryFn: async () =>
      (await api<{ link: { token: string; url: string } | null }>(`/buttons/public-link?pageId=${source.pageId}&blockId=${encodeURIComponent(source.blockId)}`))
        .link,
    enabled: saved,
  });
  const [error, setError] = useState<unknown>(null);
  const change = async (method: "PUT" | "DELETE") => {
    setError(null);
    try {
      const res = await api<{ link?: { token: string; url: string } | null }>("/buttons/public-link", { method, body: source });
      qc.setQueryData(key, res.link ?? null);
    } catch (err) {
      setError(err);
    }
  };
  return (
    <TemplateFree>
      <div className="mt-2 space-y-1.5 rounded-lg bg-neutral-50 p-2 text-sm dark:bg-neutral-800/50" data-public-form>
        <div className="font-medium">{t("button.publicLink")}</div>
        <p className="text-xs text-neutral-500">{t("button.publicLinkHint")}</p>
        {!saved ? (
          <p className="text-xs text-amber-700 dark:text-amber-400">{t("button.publicSaveFirst")}</p>
        ) : link.data ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              readOnly
              value={link.data.url}
              onFocus={(e) => e.target.select()}
              className={`${inputClass} min-w-0 flex-1 font-mono text-xs`}
              data-public-form-url
            />
            <Button type="button" variant="ghost" onClick={() => void copyText(link.data!.url)}>
              {t("tokens.copy")}
            </Button>
            <Button type="button" variant="danger" onClick={() => void change("DELETE")}>
              {t("button.publicRemove")}
            </Button>
          </div>
        ) : (
          link.isSuccess && (
            <Button type="button" variant="ghost" className="border border-neutral-200 dark:border-neutral-700" onClick={() => void change("PUT")}>
              {t("button.publicCreate")}
            </Button>
          )
        )}
        <ErrorText error={error} />
      </div>
    </TemplateFree>
  );
}
