import { useId, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, CircleAlert, CircleCheck, Search, X } from "lucide-react";
import { t, type AdminPluginInfo, type PluginSetting } from "@nootion/shared";
import { api } from "../lib/api";
import { Button, ErrorText, Rich } from "../components/ui";

type Values = Record<string, string | number | boolean | null>;

/** Lowercase, without accents, so that "integration" finds "Intégrations". */
function fold(text: string) {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function matches(p: AdminPluginInfo, query: string) {
  const q = fold(query.trim());
  return !q || fold([p.name, p.id, p.description, p.author ?? ""].join(" ")).includes(q);
}

/** Administration section: turn plugins on or off and fill in their settings. */
export function PluginsAdmin() {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const list = useQuery({
    queryKey: ["admin", "plugins"],
    queryFn: () => api<{ plugins: AdminPluginInfo[]; broken: { dir: string; error: string }[] }>("/admin/plugins"),
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; enabled?: boolean; values?: Values }) => api(`/admin/plugins/${id}`, { method: "PATCH", body }),
    // Pages load the blocks and code of plugins: they need the new list.
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: ["admin", "plugins"] }), qc.invalidateQueries({ queryKey: ["plugins"] })]),
  });
  const plugins = list.data?.plugins ?? [];
  const shown = useMemo(() => plugins.filter((p) => matches(p, query)), [plugins, query]);

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">{t("admin.plugins")}</h2>
      <p className="mb-3 text-sm text-neutral-500">
        <Rich text={t("plugins.help")} />
      </p>
      <ErrorText error={update.error} />
      {plugins.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="relative min-w-0 flex-1 basis-56">
            <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-neutral-400" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
              placeholder={t("plugins.search")}
              aria-label={t("plugins.search")}
              className="w-full rounded-md border border-neutral-300 bg-white py-2 pr-8 pl-9 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label={t("plugins.clearSearch")}
                title={t("plugins.clearSearch")}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-700"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <span className="shrink-0 text-sm text-neutral-500">
            {t("plugins.count", { enabled: plugins.filter((p) => p.enabled).length, count: plugins.length })}
          </span>
        </div>
      )}
      {shown.length > 0 && (
        <ul className="divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {shown.map((p) => (
            <PluginRow key={p.id} plugin={p} pending={update.isPending} onUpdate={(body) => update.mutateAsync({ id: p.id, ...body })} />
          ))}
        </ul>
      )}
      {list.data && !plugins.length && <p className="text-sm text-neutral-500">{t("plugins.none")}</p>}
      {plugins.length > 0 && !shown.length && <p className="py-2 text-sm text-neutral-500">{t("plugins.noMatch", { query: query.trim() })}</p>}
      {list.data?.broken.map((b) => (
        <p key={b.dir} className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {t("plugins.broken", { dir: b.dir, error: b.error })}
        </p>
      ))}
    </section>
  );
}

/** Round mark in front of a plugin: green check when on, grey dot when off, red when it failed. */
function StatusMark({ plugin: p }: { plugin: AdminPluginInfo }) {
  if (p.error) return <CircleAlert size={18} className="shrink-0 text-red-500" aria-label={t("plugins.error", { error: p.error })} />;
  if (p.enabled) return <CircleCheck size={18} className="shrink-0 text-green-600 dark:text-green-500" aria-label={t("plugins.enabled")} />;
  return (
    <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center" aria-label={t("plugins.disabled")} role="img">
      <span className="h-2.5 w-2.5 rounded-full bg-neutral-300 dark:bg-neutral-600" />
    </span>
  );
}

function PluginRow({
  plugin: p,
  pending,
  onUpdate,
}: {
  plugin: AdminPluginInfo;
  pending: boolean;
  onUpdate: (body: { enabled?: boolean; values?: Values }) => Promise<unknown>;
}) {
  const panelId = useId();
  // A plugin that failed opens by itself, so the error is not missed.
  const [open, setOpen] = useState(!!p.error);
  const [values, setValues] = useState<Values>({});
  const [saved, setSaved] = useState(false);
  const dirty = Object.keys(values).length > 0;
  return (
    <li aria-label={`Plugin ${p.name}`} data-plugin={p.id}>
      <div className="flex items-center gap-2 pr-3 sm:pr-4">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-3 text-left hover:bg-neutral-50 sm:pl-4 dark:hover:bg-neutral-900"
        >
          <ChevronRight size={16} className={`shrink-0 text-neutral-400 transition-transform duration-150 ${open ? "rotate-90" : ""}`} aria-hidden />
          <StatusMark plugin={p} />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2">
              <span className="truncate font-medium">{p.name}</span>
              <span className="hidden shrink-0 text-xs text-neutral-400 sm:inline">
                v{p.version}
                {p.builtin && ` · ${t("plugins.builtin")}`}
              </span>
            </span>
            {!open && <span className="block truncate text-sm text-neutral-500">{p.description}</span>}
          </span>
          {p.settings.length > 0 && (
            <span className="hidden shrink-0 text-xs text-neutral-400 md:inline">{t("plugins.settingsCount", { count: p.settings.length })}</span>
          )}
        </button>
        <Toggle label={`Activer ${p.name}`} checked={p.enabled} disabled={pending} onChange={(enabled) => onUpdate({ enabled })} />
      </div>
      <div id={panelId} hidden={!open} className="px-4 pb-4 sm:pl-[74px]">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{p.description}</p>
        {p.author && <p className="mt-1 text-xs text-neutral-400">{p.author}</p>}
        {p.homepage && (
          <a href={p.homepage} target="_blank" rel="noopener noreferrer" className="text-xs break-all text-blue-600 hover:underline">
            {p.homepage}
          </a>
        )}
        {p.error && <p className="mt-2 text-sm text-red-600">{t("plugins.error", { error: p.error })}</p>}
        {p.settings.length > 0 && (
          <form
            className="mt-3 space-y-3 rounded-md bg-neutral-50 p-3 dark:bg-neutral-900"
            onSubmit={async (e) => {
              e.preventDefault();
              // An empty password field keeps the saved password.
              const sent = Object.fromEntries(
                Object.entries(values).filter(([k, v]) => !(v === "" && p.settings.find((s) => s.key === k)?.type === "password")),
              );
              await onUpdate({ values: sent });
              setValues({});
              setSaved(true);
            }}
          >
            {p.settings.map((s) => (
              <SettingField
                key={s.key}
                setting={s}
                current={p.values[s.key]}
                value={values[s.key]}
                onChange={(v) => {
                  setSaved(false);
                  setValues((x) => ({ ...x, [s.key]: v }));
                }}
              />
            ))}
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={!dirty || pending}>
                {t("plugins.saveSettings")}
              </Button>
              {saved && !dirty && <span className="text-sm text-green-600">{t("common.saved")}</span>}
            </div>
          </form>
        )}
      </div>
    </li>
  );
}

/** On/off switch, a real checkbox underneath so that keyboards and screen readers know it. */
function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="relative inline-flex shrink-0 cursor-pointer items-center" title={checked ? t("plugins.enabled") : t("plugins.disabled")}>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="h-5 w-9 rounded-full bg-neutral-300 transition-colors peer-checked:bg-green-600 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500 peer-focus-visible:ring-offset-2 peer-disabled:opacity-60 dark:bg-neutral-700 dark:peer-checked:bg-green-600 dark:peer-focus-visible:ring-offset-neutral-950" />
      <span className="pointer-events-none absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
    </label>
  );
}

const input =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-800";

function SettingField({
  setting: s,
  current,
  value,
  onChange,
}: {
  setting: PluginSetting;
  current: AdminPluginInfo["values"][string] | undefined;
  value: string | number | boolean | null | undefined;
  onChange: (v: string | number | boolean | null) => void;
}) {
  const help = s.help && <span className="mt-1 block text-xs text-neutral-500">{s.help}</span>;
  if (s.type === "boolean") {
    const checked = (value ?? current) === true;
    return (
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-blue-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span>
          <span className="font-medium">{s.label}</span>
          {help}
        </span>
      </label>
    );
  }
  const shown = value ?? (typeof current === "object" ? "" : (current ?? ""));
  const passwordSet = s.type === "password" && typeof current === "object" && current?.set;
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{s.label}</span>
      {s.type === "select" ? (
        <select className={input} value={String(shown)} onChange={(e) => onChange(e.target.value)}>
          {s.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          className={input}
          type={s.type === "password" ? "password" : s.type === "number" ? "number" : "text"}
          value={String(shown)}
          placeholder={passwordSet ? `•••••••• (${t("plugins.passwordKept")})` : undefined}
          autoComplete={s.type === "password" ? "new-password" : undefined}
          onChange={(e) => onChange(s.type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)}
        />
      )}
      {help}
    </label>
  );
}
