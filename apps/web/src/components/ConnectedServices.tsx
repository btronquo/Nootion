import { useQuery, useQueryClient } from "@tanstack/react-query";
import { t, type ConnectedAccount } from "@nootion/shared";
import { api } from "../lib/api";
import { Button } from "./ui";

/** Accounts on other services that plugins keep for the user, each with a way to disconnect it. */
export function useConnectedServices() {
  return useQuery({ queryKey: ["plugin-accounts"], queryFn: () => api<{ accounts: ConnectedAccount[] }>("/plugins/accounts").then((r) => r.accounts) });
}

export function ConnectedServices({ accounts }: { accounts: ConnectedAccount[] }) {
  const qc = useQueryClient();
  const disconnect = async (a: ConnectedAccount) => {
    if (!confirm(t("services.confirmDisconnect", { service: a.name }))) return;
    await api(`/plugins/accounts/${a.pluginId}`, { method: "DELETE" });
    await qc.invalidateQueries({ queryKey: ["plugin-accounts"] });
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-neutral-500">{t("services.help")}</p>
      <ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {accounts.map((a) => (
          <li key={a.pluginId} className="flex items-center gap-3 px-3 py-2.5" data-service={a.pluginId}>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{a.name}</div>
              <div className="truncate text-xs text-neutral-500">{a.account ?? t("services.notConnected")}</div>
            </div>
            {a.account && (
              <Button variant="ghost" onClick={() => void disconnect(a)}>
                {t("services.disconnect")}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
