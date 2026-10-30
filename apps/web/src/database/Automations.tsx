import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Pencil, Plus, Trash2, Zap } from "lucide-react";
import { COMPUTED_TYPES, intlLocale, t, type Automation, type AutomationTrigger, type DatabaseData, type DatabaseProperty } from "@nootion/shared";
import { api } from "../lib/api";
import { Button, CancelButton, Modal, Select } from "../components/ui";
import { ButtonEditor } from "../buttons/ButtonEditor";

const automationsKey = (databaseId: string) => ["automations", databaseId] as const;

/** Columns whose change can set an automation off: the ones people (or steps) fill in. */
const watchable = (p: DatabaseProperty) => !COMPUTED_TYPES.includes(p.type);

/** "When a row is added", "When Status becomes Paid"… */
function triggerText(trigger: AutomationTrigger, properties: DatabaseProperty[]): string {
  if (trigger.type === "row_added") return t("automation.when.row_added");
  const name = properties.find((p) => p.id === trigger.propertyId)?.name ?? "?";
  if (trigger.type === "date_reached") return t("automation.when.date_reached", { column: name });
  return trigger.to ? t("automation.when.becomes", { column: name, value: trigger.to }) : t("automation.when.changes", { column: name });
}

/** The database's automations: what they watch, whether they are on, how their last run went. */
export function AutomationsDialog({ data, onClose }: { data: DatabaseData; onClose: () => void }) {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: automationsKey(data.id),
    queryFn: async () => (await api<{ automations: Automation[] }>(`/databases/${data.id}/automations`)).automations,
  });
  const [editing, setEditing] = useState<Automation | "new" | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: automationsKey(data.id) });

  if (editing) return <AutomationEditor data={data} automation={editing === "new" ? null : editing} onDone={() => (setEditing(null), void refresh())} />;

  return (
    <Modal title={t("automation.title")} onClose={onClose} wide>
      <p className="mb-3 text-sm text-neutral-500">{t("automation.help")}</p>
      <ul className="space-y-2" data-automations>
        {(list.data ?? []).map((a) => {
          const last = a.runs[0];
          return (
            <li key={a.id} className="rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800" data-automation={a.id}>
              <div className="flex items-center gap-2">
                <Zap size={15} className={a.enabled ? "text-amber-500" : "text-neutral-300 dark:text-neutral-600"} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{a.name || triggerText(a.trigger, data.properties)}</span>
                  {a.name && <span className="block truncate text-xs text-neutral-500">{triggerText(a.trigger, data.properties)}</span>}
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  className="h-4 w-4 accent-blue-600"
                  checked={a.enabled}
                  aria-label={t("automation.enabled")}
                  onChange={async (e) => {
                    await api(`/automations/${a.id}/enabled`, { method: "POST", body: { enabled: e.target.checked } });
                    await refresh();
                  }}
                />
                <Button variant="ghost" className="px-2 py-1" onClick={() => setEditing(a)} aria-label={t("automation.edit")} title={t("automation.edit")}>
                  <Pencil size={14} />
                </Button>
                <Button
                  variant="ghost"
                  className="px-2 py-1"
                  aria-label={t("automation.delete")}
                  title={t("automation.delete")}
                  onClick={async () => {
                    if (!confirm(t("automation.confirmDelete"))) return;
                    await api(`/automations/${a.id}`, { method: "DELETE" });
                    await refresh();
                  }}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
              {last && (
                <p
                  className={`mt-1 flex items-start gap-1 pl-6 text-xs ${last.error ? "text-red-600 dark:text-red-400" : "text-neutral-500"}`}
                  data-automation-run
                >
                  {last.error && <AlertCircle size={12} className="mt-0.5 shrink-0" />}
                  <span>
                    {t(last.error ? "automation.lastRunFailed" : "automation.lastRun", {
                      when: new Date(last.at).toLocaleString(intlLocale(), { dateStyle: "medium", timeStyle: "short" }),
                      row: last.rowTitle || t("common.untitled"),
                    })}
                    {last.error && ` ${last.error}`}
                  </span>
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {list.isSuccess && !list.data.length && <p className="py-4 text-center text-sm text-neutral-500">{t("automation.empty")}</p>}
      <div className="mt-4 flex justify-between gap-2">
        <Button variant="ghost" onClick={() => setEditing("new")}>
          <Plus size={14} /> {t("automation.new")}
        </Button>
        <CancelButton onClose={onClose} label={t("common.close")} />
      </div>
    </Modal>
  );
}

function AutomationEditor({ data, automation, onDone }: { data: DatabaseData; automation: Automation | null; onDone: () => void }) {
  const [name, setName] = useState(automation?.name ?? "");
  const [trigger, setTrigger] = useState<AutomationTrigger>(automation?.trigger ?? { type: "row_added" });
  const properties = data.properties.filter((p) => (trigger.type === "date_reached" ? p.type === "date" : watchable(p)));
  const prop = "propertyId" in trigger ? data.properties.find((p) => p.id === trigger.propertyId) : undefined;
  const input =
    "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-900";

  const setType = (type: AutomationTrigger["type"]) => {
    if (type === "row_added") return setTrigger({ type });
    const first = data.properties.find((p) => (type === "date_reached" ? p.type === "date" : watchable(p)));
    setTrigger(type === "date_reached" ? { type, propertyId: first?.id ?? "" } : { type, propertyId: first?.id ?? "", to: null });
  };

  const head = (
    <div className="space-y-3" data-automation-head>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">{t("automation.name")}</span>
        <input className={input} value={name} maxLength={100} placeholder={triggerText(trigger, data.properties)} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="text-sm">
        <span className="mb-1 block font-medium">{t("automation.trigger")}</span>
        <div className="flex flex-wrap gap-2">
          <Select
            className="py-2"
            value={trigger.type}
            onChange={(e) => setType(e.target.value as AutomationTrigger["type"])}
            aria-label={t("automation.trigger")}
          >
            <option value="row_added">{t("automation.trigger.row_added")}</option>
            <option value="property_changed">{t("automation.trigger.property_changed")}</option>
            <option value="date_reached">{t("automation.trigger.date_reached")}</option>
          </Select>
          {trigger.type !== "row_added" && (
            <Select
              className="py-2"
              value={trigger.propertyId}
              aria-label={t("automation.column")}
              onChange={(e) =>
                setTrigger(trigger.type === "date_reached" ? { ...trigger, propertyId: e.target.value } : { ...trigger, propertyId: e.target.value, to: null })
              }
            >
              {!properties.length && <option value="">{t("automation.noColumn")}</option>}
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
          {trigger.type === "property_changed" && prop && (
            <TargetValue prop={prop} value={trigger.to} onChange={(to) => setTrigger({ ...trigger, to })} className={input} />
          )}
        </div>
        {trigger.type === "date_reached" && <p className="mt-1 text-xs text-neutral-500">{t("automation.dateHelp")}</p>}
      </div>
      <p className="text-xs text-neutral-500">{t("automation.stepsHelp")}</p>
    </div>
  );

  return (
    <ButtonEditor
      initial={{ label: name, color: "default", steps: automation?.steps ?? [{ type: "update_row", values: {} }], form: null }}
      rowDatabaseId={data.id}
      pageId={null}
      defaultLabel=""
      automation={{ title: automation ? t("automation.edit") : t("automation.new"), head }}
      onClose={onDone}
      onSave={async (config) => {
        const body = { name, enabled: automation?.enabled ?? true, trigger, steps: config.steps };
        try {
          await api(automation ? `/automations/${automation.id}` : `/databases/${data.id}/automations`, { method: automation ? "PUT" : "POST", body });
          onDone();
        } catch (e) {
          alert(e instanceof Error ? e.message : String(e));
        }
      }}
    />
  );
}

/** The value a column must take; empty for any change. */
function TargetValue({
  prop,
  value,
  onChange,
  className,
}: {
  prop: DatabaseProperty;
  value: string | null;
  onChange: (v: string | null) => void;
  className: string;
}) {
  const options = prop.config.options ?? [];
  if (prop.type === "checkbox")
    return (
      <Select className="py-2" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} aria-label={t("automation.to")}>
        <option value="">{t("automation.anyValue")}</option>
        <option value="true">{t("automation.checked")}</option>
        <option value="false">{t("automation.unchecked")}</option>
      </Select>
    );
  if (options.length)
    return (
      <Select className="py-2" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} aria-label={t("automation.to")}>
        <option value="">{t("automation.anyValue")}</option>
        {options.map((o) => (
          <option key={o.id} value={o.name}>
            {t("automation.becomes", { value: o.name })}
          </option>
        ))}
      </Select>
    );
  return (
    <input
      className={`${className} w-auto min-w-40 flex-1`}
      value={value ?? ""}
      placeholder={t("automation.anyValue")}
      aria-label={t("automation.to")}
      onChange={(e) => onChange(e.target.value.trim() ? e.target.value : null)}
    />
  );
}
