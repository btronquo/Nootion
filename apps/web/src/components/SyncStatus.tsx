import { CloudOff, RefreshCw, TriangleAlert, X } from "lucide-react";
import { t } from "@nootion/shared";
import { useOnline } from "../lib/api";
import { dismissFailures, useOfflineQueue } from "../lib/offline";

/**
 * Connection state of the app: offline, changes waiting to be sent, or changes the server refused.
 * Shows nothing while everything is saved.
 */
export function SyncStatus({ className = "" }: { className?: string }) {
  const online = useOnline();
  const { pending, failures } = useOfflineQueue();
  const pill = `flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ${className}`;
  if (failures.length) {
    return (
      <span role="status" className={`${pill} bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300`} title={failures.join("\n")}>
        <TriangleAlert size={13} /> {t("offline.failed", { count: failures.length })}
        <button onClick={dismissFailures} aria-label={t("common.close")} className="-mr-1 rounded-full p-0.5 hover:bg-red-100 dark:hover:bg-red-900">
          <X size={12} />
        </button>
      </span>
    );
  }
  if (!online) {
    return (
      <span role="status" className={`${pill} bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300`} title={t("offline.help")}>
        <CloudOff size={13} /> {pending ? t("offline.pending", { count: pending }) : t("offline.label")}
      </span>
    );
  }
  if (pending) {
    return (
      <span role="status" className={`${pill} bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300`}>
        <RefreshCw size={13} className="animate-spin" /> {t("offline.syncing")}
      </span>
    );
  }
  return null;
}
