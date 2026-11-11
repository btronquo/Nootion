import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";
import { intlLocale, t, type UpdateStatus } from "@nootion/shared";
import { api } from "../lib/api";
import { Button } from "./ui";

const key = ["admin", "update"];

/** Whether a newer Nootion is out (administrators only; null for others). */
export function useUpdateStatus(admin: boolean) {
  return useQuery({
    queryKey: key,
    queryFn: () => api<UpdateStatus>("/admin/update"),
    enabled: admin,
    staleTime: 3600_000,
  });
}

/** The running version, for everyone. */
const useHealth = () =>
  useQuery({
    queryKey: ["health"],
    queryFn: () => api<{ version: string; desktop?: boolean }>("/health"),
    staleTime: Infinity,
  });

export function useVersion(): string | null {
  return useHealth().data?.version ?? null;
}

/** Whether this is the desktop app's own Nootion, on the computer. */
export function useIsDesktopLocal(): boolean {
  return useHealth().data?.desktop === true;
}

/** "Update available" warning at the top of the administration page, which can be hidden for that version. */
export function UpdateBanner() {
  const status = useUpdateStatus(true).data;
  const qc = useQueryClient();
  if (!status?.available || status.dismissed || !status.latest) return null;
  const { latest } = status;
  const dismiss = async () =>
    qc.setQueryData(
      key,
      await api<UpdateStatus>("/admin/update/dismiss", {
        method: "POST",
        body: { version: latest.version },
      }),
    );
  return (
    <div
      className="flex flex-wrap items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/60"
      data-update-banner
      role="status"
    >
      <AlertTriangle
        size={18}
        className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {t("update.available", { version: latest.version })}
        </p>
        <p className="mt-0.5 text-neutral-600 dark:text-neutral-300">
          {t("update.current", { version: status.current })}
        </p>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {latest.url && (
            <a
              href={latest.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-amber-800 underline dark:text-amber-300"
            >
              {t("update.whatsNew")} <ExternalLink size={12} />
            </a>
          )}
          <a
            href="https://github.com/btronquo/Nootion/blob/main/docs/DEPLOYMENT.md#updating"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-amber-800 underline dark:text-amber-300"
          >
            {t("update.how")} <ExternalLink size={12} />
          </a>
        </p>
      </div>
      <Button
        variant="ghost"
        onClick={() => void dismiss()}
        data-update-dismiss
      >
        {t("update.dismiss")}
      </Button>
    </div>
  );
}

/** The version line at the bottom of the administration page, with "Check now". */
export function VersionLine() {
  const status = useUpdateStatus(true);
  const version = useVersion();
  const qc = useQueryClient();
  const [checking, setChecking] = useState(false);
  const s = status.data;
  const check = async () => {
    setChecking(true);
    try {
      qc.setQueryData(
        key,
        await api<UpdateStatus>("/admin/update/check", {
          method: "POST",
          body: {},
        }),
      );
    } finally {
      setChecking(false);
    }
  };
  const when = s?.checkedAt
    ? new Intl.DateTimeFormat(intlLocale(), {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(s.checkedAt))
    : null;
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500"
      data-version-line
    >
      <span>
        {t("admin.version", { version: s?.current ?? version ?? "…" })}
      </span>
      {s?.checking && (
        <>
          <span>
            {s.available && s.latest ? (
              <a
                href={s.latest.url}
                target="_blank"
                rel="noreferrer"
                className="text-amber-700 underline dark:text-amber-400"
              >
                {t("update.available", { version: s.latest.version })}
              </a>
            ) : s.latest ? (
              t("update.upToDate")
            ) : null}
            {when && <> · {t("update.checkedAt", { date: when })}</>}
          </span>
          <button
            type="button"
            onClick={() => void check()}
            disabled={checking}
            className="inline-flex items-center gap-1 hover:underline"
          >
            <RefreshCw size={11} className={checking ? "animate-spin" : ""} />{" "}
            {t("update.checkNow")}
          </button>
          {s.dismissed && (
            <button
              type="button"
              className="hover:underline"
              onClick={() =>
                void api<UpdateStatus>("/admin/update/dismiss", {
                  method: "POST",
                  body: { version: null },
                }).then((d) => qc.setQueryData(key, d))
              }
            >
              {t("update.showAgain")}
            </button>
          )}
        </>
      )}
      {s && !s.checking && <span>{t("update.off")}</span>}
    </div>
  );
}
