import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { intlLocale, t, type NotionImportJob, type NotionImportStatus, type MessageKey } from "@nootion/shared";
import { api } from "../lib/api";
import { useRefreshPages, useWorkspaces } from "../lib/queries";
import { workspaceName } from "../lib/labels";
import { Button, ErrorText, Field, Rich, Select } from "../components/ui";

const COUNTS = ["pages", "databases", "rows", "files", "updated", "unchanged"] as const;

export function NotionImportPage() {
  const workspaces = useWorkspaces();
  const editable = (workspaces.data ?? []).filter((w) => w.role === "owner" || w.role === "editor");
  const [chosen, setChosen] = useState("");
  const workspaceId = chosen || editable[0]?.id || "";
  const [token, setToken] = useState("");
  const [newToken, setNewToken] = useState(false);
  const qc = useQueryClient();
  const refreshPages = useRefreshPages();

  const status = useQuery({
    queryKey: ["notion-import", workspaceId],
    queryFn: () => api<NotionImportStatus>(`/import/notion?workspaceId=${workspaceId}`),
    enabled: !!workspaceId,
    // Follows the job while it runs.
    refetchInterval: (q) => (q.state.data?.job?.status === "running" ? 1000 : false),
  });
  const job = status.data?.job ?? null;
  const running = job?.status === "running";

  // The sidebar shows the imported pages once the job is over.
  useEffect(() => {
    if (job && job.status !== "running") void refreshPages();
  }, [job?.status, job?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = useMutation({
    mutationFn: (withToken: boolean) =>
      api<{ job: NotionImportJob }>(`/import/notion`, { method: "POST", body: { workspaceId, ...(withToken ? { token: token.trim() } : {}) } }),
    onSuccess: ({ job }) => {
      setToken("");
      setNewToken(false);
      // The new job shows at once, in place of the last one.
      qc.setQueryData<NotionImportStatus>(["notion-import", workspaceId], (old) => ({ connected: true, lastImportAt: old?.lastImportAt ?? null, job }));
      return qc.invalidateQueries({ queryKey: ["notion-import", workspaceId] });
    },
  });
  const forget = useMutation({
    mutationFn: () => api(`/import/notion/connection?workspaceId=${workspaceId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notion-import", workspaceId] }),
  });

  if (workspaces.isLoading) return null;
  const askToken = !status.data?.connected || newToken;

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-5 py-8 sm:px-8 sm:py-12">
      <div>
        <h1 className="mb-2 text-2xl font-bold">{t("notion.title")}</h1>
        <p className="text-neutral-600 dark:text-neutral-400">{t("notion.intro")}</p>
      </div>

      {editable.length === 0 ? (
        <p className="text-neutral-500">{t("notion.noSpace")}</p>
      ) : (
        <>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t("notion.space")}</span>
            <Select value={workspaceId} onChange={(e) => setChosen(e.target.value)} disabled={running}>
              {editable.map((w) => (
                <option key={w.id} value={w.id}>
                  {workspaceName(w)}
                </option>
              ))}
            </Select>
          </label>

          {askToken && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">{t("notion.howTo")}</h2>
              <ol className="list-decimal space-y-1.5 pl-5 text-sm text-neutral-700 dark:text-neutral-300">
                {(["notion.step1", "notion.step2", "notion.step3", "notion.step4"] as const).map((k) => (
                  <li key={k}>
                    <Rich text={t(k)} />
                  </li>
                ))}
              </ol>
              <a
                href="https://www.notion.so/profile/integrations"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline dark:text-blue-400"
              >
                {t("notion.openIntegrations")} <ExternalLink size={13} />
              </a>
            </section>
          )}

          <section className="space-y-3">
            {askToken ? (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (token.trim()) start.mutate(true);
                }}
              >
                <Field
                  label={t("notion.token")}
                  type="password"
                  autoComplete="off"
                  placeholder="ntn_…"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
                <p className="text-xs text-neutral-500">{t("notion.tokenHelp")}</p>
                <div className="flex gap-2">
                  <Button type="submit" disabled={running || start.isPending || token.trim().length < 10}>
                    {t("notion.start")}
                  </Button>
                  {newToken && (
                    <Button type="button" variant="ghost" onClick={() => setNewToken(false)}>
                      {t("common.cancel")}
                    </Button>
                  )}
                </div>
              </form>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                  {t("notion.connected")}{" "}
                  {status.data?.lastImportAt &&
                    t("notion.lastImport", {
                      date: new Intl.DateTimeFormat(intlLocale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(status.data.lastImportAt)),
                    })}
                </p>
                <p className="text-sm text-neutral-500">{t("notion.againHelp")}</p>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => start.mutate(false)} disabled={running || start.isPending}>
                    {t("notion.again")}
                  </Button>
                  <Button variant="ghost" onClick={() => setNewToken(true)} disabled={running}>
                    {t("notion.changeToken")}
                  </Button>
                  <Button variant="ghost" onClick={() => confirm(t("notion.confirmForget")) && forget.mutate()} disabled={running}>
                    {t("notion.forget")}
                  </Button>
                </div>
              </div>
            )}
            <ErrorText error={start.error ?? forget.error ?? status.error} />
          </section>

          {job && !start.isPending && <JobView job={job} />}

          <p className="border-t border-neutral-200 pt-6 text-sm text-neutral-500 dark:border-neutral-800">{t("notion.limits")}</p>
        </>
      )}
    </div>
  );
}

function JobView({ job }: { job: NotionImportJob }) {
  const r = job.report;
  const counts = COUNTS.filter((k) => r[k] > 0 || k === "pages");
  const notes = Object.entries(r.notes);
  return (
    <section className="space-y-4 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800" aria-live="polite">
      {job.status === "running" ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t(`notion.phase.${job.phase}` as MessageKey)}</p>
          <div className="h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
            <div
              className="h-full rounded-full bg-blue-500 transition-all"
              style={{ width: job.total ? `${Math.round((job.done / job.total) * 100)}%` : "5%" }}
            />
          </div>
          <p className="text-xs text-neutral-500">{t("notion.running")}</p>
        </div>
      ) : job.status === "failed" ? (
        <p className="text-sm text-red-600 dark:text-red-400">{t("notion.failed", { error: job.error ?? "" })}</p>
      ) : (
        <p className="text-sm font-medium">{r.pages + r.databases + r.unchanged === 0 ? t("notion.nothing") : t("notion.done")}</p>
      )}
      <p className="text-sm text-neutral-600 dark:text-neutral-400">{counts.map((k) => t(`notion.count.${k}`, { count: r[k] })).join(" · ")}</p>
      {notes.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold">{t("notion.notesTitle")}</h3>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-neutral-600 dark:text-neutral-400">
            {notes.map(([kind, n]) => (
              <li key={kind}>
                {t(`notion.note.${kind}` as MessageKey)} ({n})
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.formulas.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold">{t("notion.formulasTitle")}</h3>
          <p className="mb-1 text-xs text-neutral-500">{t("notion.formulasHelp")}</p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-neutral-600 dark:text-neutral-400">
            {r.formulas.map((f) => (
              <li key={`${f.database}/${f.name}`}>
                {f.database} › {f.name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
