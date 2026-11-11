import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { intlLocale, t } from "@nootion/shared";
import { CheckCircle2, CloudOff, Link2, RefreshCw, Unlink } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useRefreshPages } from "../lib/queries";
import { Button, ErrorText, Field } from "../components/ui";
import { useIsDesktopLocal } from "../components/UpdateNotice";

/** A space of the desktop app kept in sync with a Nootion server (server: desktop-sync.ts). */
export interface SyncLink {
  workspaceId: string;
  name: string;
  serverUrl: string;
  lastSyncAt: string | null;
  lastError: string | null;
  pending: number;
  syncing: boolean;
}

const SYNC_KEY = ["desktop-sync"];

/** The spaces in sync, or undefined outside the desktop app's local mode (the routes don't exist there). */
export function useDesktopSync(poll = false) {
  const desktop = useIsDesktopLocal();
  return useQuery({
    queryKey: SYNC_KEY,
    enabled: desktop,
    queryFn: async () => (await api<{ links: SyncLink[] }>("/desktop/sync")).links,
    retry: false,
    staleTime: poll ? 0 : 60_000,
    refetchInterval: (q) => (q.state.status === "error" ? false : poll ? 3_000 : 30_000),
  });
}

const ERROR_CODES = ["invalid_url", "unreachable", "not_nootion", "link_expired", "server_refused", "no_space", "access_denied", "cancelled"] as const;

/** A sync error code from the server, in words. Unexpected errors keep their message. */
export function syncErrorText(code: string): string {
  return (ERROR_CODES as readonly string[]).includes(code)
    ? t(`sync.error.${code as (typeof ERROR_CODES)[number]}`)
    : t("sync.error.failed", { message: code });
}

/** An error from the sync routes, in words when its code is known. */
const inWords = (err: unknown) => (err instanceof ApiError && (ERROR_CODES as readonly string[]).includes(err.code) ? new Error(syncErrorText(err.code)) : err);

function ago(iso: string): string {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const fmt = new Intl.RelativeTimeFormat(intlLocale(), { numeric: "auto" });
  if (seconds > -60) return fmt.format(0, "second");
  if (seconds > -3600) return fmt.format(Math.round(seconds / 60), "minute");
  if (seconds > -86_400) return fmt.format(Math.round(seconds / 3600), "hour");
  return fmt.format(Math.round(seconds / 86_400), "day");
}

export function SyncPage() {
  const links = useDesktopSync(true);
  const client = useQueryClient();
  const refreshPages = useRefreshPages();
  const [params, setParams] = useSearchParams();
  const [serverUrl, setServerUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const returned = params.get("error");
  const linked = params.has("linked");

  async function link(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy("link");
    try {
      const { authorizeUrl } = await api<{ authorizeUrl: string }>("/desktop/sync/link", { method: "POST", body: { serverUrl } });
      // The server asks to sign in there and to allow the computer, then comes back to /api/desktop/sync/callback.
      window.location.href = authorizeUrl;
    } catch (err) {
      setError(inWords(err));
      setBusy(null);
    }
  }

  async function act(workspaceId: string, method: "POST" | "DELETE") {
    if (method === "DELETE" && !confirm(t("sync.confirmUnlink"))) return;
    setBusy(workspaceId);
    setError(null);
    try {
      const res = await api<{ links: SyncLink[] }>(method === "POST" ? `/desktop/sync/${workspaceId}/now` : `/desktop/sync/${workspaceId}`, { method });
      client.setQueryData(SYNC_KEY, res.links);
      await refreshPages();
    } catch (err) {
      setError(inWords(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8 sm:py-12">
      <h1 className="mb-2 text-2xl font-bold">{t("sync.title")}</h1>
      <p className="mb-6 text-sm text-neutral-500">{t("sync.intro")}</p>

      {(linked || returned) && (
        <div
          className={`mb-6 flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${linked ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300" : "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"}`}
          role="status"
        >
          <span>{linked ? t("sync.linked") : syncErrorText(returned!)}</span>
          <button className="shrink-0 opacity-60 hover:opacity-100" onClick={() => setParams({}, { replace: true })} aria-label={t("common.close")}>
            ×
          </button>
        </div>
      )}

      {links.data && links.data.length > 0 && (
        <ul className="mb-8 divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {links.data.map((l) => (
            <li key={l.workspaceId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 text-sm" data-sync-link={l.workspaceId}>
              <div className="min-w-0">
                <div className="font-medium">{l.name}</div>
                <div className="truncate text-neutral-500">{l.serverUrl}</div>
                <div className={`mt-1 flex items-center gap-1 text-xs ${l.lastError ? "text-red-600" : "text-neutral-500"}`}>
                  {l.syncing ? (
                    <>
                      <RefreshCw size={12} className="animate-spin" /> {t("sync.syncing")}
                    </>
                  ) : l.lastError ? (
                    <>
                      <CloudOff size={12} /> {syncErrorText(l.lastError)}
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={12} className="text-green-600" /> {l.lastSyncAt ? t("sync.lastSync", { when: ago(l.lastSyncAt) }) : t("sync.never")}
                    </>
                  )}
                  {l.pending > 0 && <span className="text-neutral-500"> · {t("sync.pending", { count: l.pending })}</span>}
                </div>
              </div>
              <span className="flex shrink-0 gap-1">
                <Button variant="ghost" disabled={busy !== null || l.syncing} onClick={() => act(l.workspaceId, "POST")}>
                  <RefreshCw size={14} /> {t("sync.now")}
                </Button>
                <Button variant="danger" disabled={busy !== null} onClick={() => act(l.workspaceId, "DELETE")} title={t("sync.unlink")}>
                  <Unlink size={14} />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={link} className="space-y-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="font-medium">{t("sync.linkTitle")}</h2>
        <p className="text-sm text-neutral-500">{t("sync.linkHelp")}</p>
        <Field
          label={t("sync.serverUrl")}
          autoComplete="url"
          inputMode="url"
          placeholder="https://nootion.example.com"
          required
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
        />
        <ErrorText error={error} />
        <Button type="submit" disabled={busy !== null || !serverUrl.trim()}>
          <Link2 size={14} /> {t("sync.link")}
        </Button>
      </form>
    </div>
  );
}
