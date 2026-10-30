import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check } from "lucide-react";
import { intlLocale, t, type BackupSchedule, type BackupScheduleInput } from "@nootion/shared";
import { api } from "../lib/api";
import { Button, Select } from "../components/ui";
import { formatSize } from "../editor/nodes";

const key = ["admin", "backup-schedule"];
const input =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-900";
const when = (iso: string) => new Date(iso).toLocaleString(intlLocale(), { dateStyle: "medium", timeStyle: "short" });
const weekdayName = (d: number) => new Date(Date.UTC(2023, 0, 1 + d)).toLocaleDateString(intlLocale(), { weekday: "long", timeZone: "UTC" });

type Form = Omit<BackupScheduleInput, "destination"> & { type: "folder" | "webdav"; path: string; url: string; username: string; password: string };

function toForm(s: BackupSchedule | null): Form {
  const d = s?.destination;
  return {
    enabled: s?.enabled ?? true,
    frequency: s?.frequency ?? "daily",
    weekday: s?.weekday ?? 1,
    time: s?.time ?? "03:00",
    timeZone: s?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    keep: s?.keep ?? 7,
    type: d?.type ?? "folder",
    path: d?.type === "folder" ? d.path : "",
    url: d?.type === "webdav" ? d.url : "",
    username: d?.type === "webdav" ? d.username : "",
    password: "",
  };
}

/** Where and when the full backup is made by itself, and how the last one went. */
export function BackupsAdmin() {
  const qc = useQueryClient();
  const schedule = useQuery({ queryKey: key, queryFn: async () => (await api<{ schedule: BackupSchedule | null }>("/admin/backups/schedule")).schedule });
  const s = schedule.data ?? null;
  const [form, setForm] = useState<Form>(() => toForm(null));
  const [busy, setBusy] = useState<"save" | "run" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (schedule.isSuccess) setForm(toForm(schedule.data));
  }, [schedule.isSuccess, schedule.data]);
  const set = (patch: Partial<Form>) => (setForm((f) => ({ ...f, ...patch })), setSaved(false));

  async function act(kind: "save" | "run" | "stop") {
    setBusy(kind === "stop" ? "save" : kind);
    setError(null);
    try {
      if (kind === "stop") await api("/admin/backups/schedule", { method: "DELETE" });
      else if (kind === "run") await api("/admin/backups/run", { method: "POST" });
      else {
        const { type, path, url, username, password, ...rest } = form;
        const destination = type === "folder" ? { type, path } : { type, url, username, ...(password ? { password } : {}) };
        await api("/admin/backups/schedule", { method: "PUT", body: { ...rest, destination } });
        setSaved(true);
      }
      await qc.invalidateQueries({ queryKey: key });
      if (kind === "stop") setForm(toForm(null));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const field = (label: string, control: React.ReactNode, help?: string) => (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {control}
      {help && <span className="mt-1 block text-xs text-neutral-500">{help}</span>}
    </label>
  );

  return (
    <section data-backup-schedule>
      <h2 className="mb-1 text-lg font-semibold">{t("backup.title")}</h2>
      <p className="mb-3 text-sm text-neutral-500">{t("backup.help")}</p>
      {s && (
        <div className="mb-4 space-y-1 rounded-lg bg-neutral-50 px-3 py-2 text-sm dark:bg-neutral-900" data-backup-status>
          <p>{s.nextRunAt ? t("backup.next", { when: when(s.nextRunAt) }) : t("backup.paused")}</p>
          {s.lastRunAt && s.lastError && (
            <p className="flex items-start gap-1 text-red-600 dark:text-red-400">
              <AlertCircle size={14} className="mt-0.5 shrink-0" /> {t("backup.lastFailed", { when: when(s.lastRunAt), error: s.lastError })}
            </p>
          )}
          {s.lastRunAt && !s.lastError && s.lastName && (
            <p className="flex items-start gap-1 text-neutral-600 dark:text-neutral-300">
              <Check size={14} className="mt-0.5 shrink-0 text-green-600" />
              {t("backup.last", { name: s.lastName, size: formatSize(s.lastSize ?? 0), when: when(s.lastRunAt) })}
            </p>
          )}
        </div>
      )}
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void act("save");
        }}
      >
        <div className="flex flex-wrap gap-4">
          {field(
            t("backup.frequency"),
            <Select className="py-2" value={form.frequency} onChange={(e) => set({ frequency: e.target.value as Form["frequency"] })}>
              <option value="daily">{t("backup.daily")}</option>
              <option value="weekly">{t("backup.weekly")}</option>
            </Select>,
          )}
          {form.frequency === "weekly" &&
            field(
              t("backup.weekday"),
              <Select className="py-2 capitalize" value={form.weekday} onChange={(e) => set({ weekday: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                  <option key={d} value={d}>
                    {weekdayName(d)}
                  </option>
                ))}
              </Select>,
            )}
          {field(t("backup.time"), <input type="time" required className={input} value={form.time} onChange={(e) => set({ time: e.target.value })} />)}
          {field(
            t("backup.keep"),
            <input
              type="number"
              min={1}
              max={365}
              className={`${input} w-24`}
              value={form.keep}
              onChange={(e) => set({ keep: Math.min(365, Math.max(1, Number(e.target.value) || 1)) })}
            />,
          )}
        </div>
        <fieldset className="text-sm">
          <legend className="mb-1 font-medium">{t("backup.destination")}</legend>
          <div className="flex flex-wrap gap-4">
            {(["folder", "webdav"] as const).map((type) => (
              <label key={type} className="flex items-center gap-2">
                <input type="radio" name="backup-destination" checked={form.type === type} onChange={() => set({ type })} />
                {t(type === "folder" ? "backup.folder" : "backup.webdav")}
              </label>
            ))}
          </div>
        </fieldset>
        {form.type === "folder" ? (
          field(
            t("backup.path"),
            <input className={input} required value={form.path} placeholder="/backups" onChange={(e) => set({ path: e.target.value })} />,
            t("backup.pathHelp"),
          )
        ) : (
          <div className="space-y-3">
            {field(
              t("backup.url"),
              <input
                className={input}
                required
                type="url"
                value={form.url}
                placeholder="https://cloud.example.com/remote.php/dav/files/…/Nootion"
                onChange={(e) => set({ url: e.target.value })}
              />,
              t("backup.urlHelp"),
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {field(t("backup.username"), <input className={input} required value={form.username} onChange={(e) => set({ username: e.target.value })} />)}
              {field(
                t("backup.password"),
                <input
                  className={input}
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  placeholder={s?.destination.type === "webdav" && s.destination.hasPassword ? t("backup.passwordKept") : ""}
                  onChange={(e) => set({ password: e.target.value })}
                />,
              )}
            </div>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-blue-600" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          {t("backup.enabled")}
        </label>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={!!busy}>
            {t("common.save")}
          </Button>
          {s && (
            <Button type="button" variant="ghost" disabled={!!busy} onClick={() => void act("run")} data-backup-run>
              {busy === "run" ? t("backup.running") : t("backup.runNow")}
            </Button>
          )}
          {saved && <span className="text-sm text-neutral-500">{t("backup.saved")}</span>}
          {s && (
            <Button type="button" variant="danger" className="ml-auto" disabled={!!busy} onClick={() => void act("stop")}>
              {t("backup.stop")}
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}
