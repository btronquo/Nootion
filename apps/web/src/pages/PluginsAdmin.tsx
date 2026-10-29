import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { t, type AdminPluginInfo, type PluginSetting } from "@nootion/shared";
import { api } from "../lib/api";
import { Button, ErrorText, Rich } from "../components/ui";

type Values = Record<string, string | number | boolean | null>;

/** Administration section: turn plugins on or off and fill in their settings. */
export function PluginsAdmin() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["admin", "plugins"],
    queryFn: () => api<{ plugins: AdminPluginInfo[]; broken: { dir: string; error: string }[] }>("/admin/plugins"),
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; enabled?: boolean; values?: Values }) => api(`/admin/plugins/${id}`, { method: "PATCH", body }),
    // Pages load the blocks and code of plugins: they need the new list.
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: ["admin", "plugins"] }), qc.invalidateQueries({ queryKey: ["plugins"] })]),
  });

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Plugins</h2>
      <p className="mb-3 text-sm text-neutral-500">
        <Rich text={t("plugins.help")} />
      </p>
      <ErrorText error={update.error} />
      <div className="space-y-3">
        {list.data?.plugins.map((p) => (
          <PluginCard key={p.id} plugin={p} pending={update.isPending} onUpdate={(body) => update.mutateAsync({ id: p.id, ...body })} />
        ))}
        {list.data && !list.data.plugins.length && <p className="text-sm text-neutral-500">{t("plugins.none")}</p>}
        {list.data?.broken.map((b) => (
          <p key={b.dir} className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {t("plugins.broken", { dir: b.dir, error: b.error })}
          </p>
        ))}
      </div>
    </section>
  );
}

function PluginCard({
  plugin: p,
  pending,
  onUpdate,
}: {
  plugin: AdminPluginInfo;
  pending: boolean;
  onUpdate: (body: { enabled?: boolean; values?: Values }) => Promise<unknown>;
}) {
  const [values, setValues] = useState<Values>({});
  const [saved, setSaved] = useState(false);
  const dirty = Object.keys(values).length > 0;
  return (
    <article aria-label={`Plugin ${p.name}`} className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="font-semibold">{p.name}</h3>
            <span className="text-xs text-neutral-400">
              v{p.version}
              {p.author && ` · ${p.author}`}
              {p.builtin && ` · ${t("plugins.builtin")}`}
            </span>
          </div>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{p.description}</p>
          {p.homepage && (
            <a href={p.homepage} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
              {p.homepage}
            </a>
          )}
          {p.error && <p className="mt-2 text-sm text-red-600">{t("plugins.error", { error: p.error })}</p>}
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm">
          <span className="text-neutral-500">{p.enabled ? t("plugins.enabled") : t("plugins.disabled")}</span>
          <input
            type="checkbox"
            role="switch"
            aria-label={`Activer ${p.name}`}
            className="h-4 w-4 accent-blue-600"
            checked={p.enabled}
            disabled={pending}
            onChange={(e) => onUpdate({ enabled: e.target.checked })}
          />
        </label>
      </div>
      {p.settings.length > 0 && (
        <form
          className="mt-3 space-y-3 border-t border-neutral-200 pt-3 dark:border-neutral-800"
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
    </article>
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
