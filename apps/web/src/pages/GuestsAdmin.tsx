import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { t, type GuestInfo, type InstanceSettings } from "@nootion/shared";
import { api } from "../lib/api";
import { pageRoleLabel } from "../lib/labels";
import { pageTitle } from "../lib/tree";
import { Button, ErrorText } from "../components/ui";

const settingsKey = ["admin", "settings"];

/**
 * Guests, apart from the team: who they are and which pages they see. An administrator turns one into a member, or
 * forbids guests on the whole server.
 */
export function GuestsAdmin() {
  const qc = useQueryClient();
  const guests = useQuery({ queryKey: ["admin", "guests"], queryFn: async () => (await api<{ guests: GuestInfo[] }>("/admin/guests")).guests });
  const settings = useQuery({ queryKey: settingsKey, queryFn: async () => (await api<{ settings: InstanceSettings }>("/admin/settings")).settings });
  const [error, setError] = useState<unknown>(null);

  const refresh = () =>
    Promise.all([qc.invalidateQueries({ queryKey: ["admin", "guests"] }), qc.invalidateQueries({ queryKey: ["admin", "users"] })]);
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { role?: "member"; disabled?: boolean } }) => api(`/admin/users/${id}`, { method: "PATCH", body: patch }),
    onSettled: refresh,
  });

  async function setAllowed(allowGuests: boolean) {
    setError(null);
    try {
      const res = await api<{ settings: InstanceSettings }>("/admin/settings", { method: "PUT", body: { ...settings.data, allowGuests } });
      qc.setQueryData(settingsKey, res.settings);
    } catch (e) {
      setError(e);
    }
  }

  return (
    <section data-guests-admin>
      <h2 className="mb-1 text-lg font-semibold">{t("guest.adminTitle")}</h2>
      <p className="mb-3 text-sm text-neutral-500">{t("guest.adminHelp")}</p>
      {settings.data && (
        <label className="mb-4 flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={settings.data.allowGuests} onChange={(e) => void setAllowed(e.target.checked)} data-allow-guests />
          <span>
            <span className="block font-medium">{t("guest.allow")}</span>
            <span className="block text-neutral-500">{t("guest.allowHelp")}</span>
          </span>
        </label>
      )}
      <ErrorText error={error ?? update.error} />
      {guests.data && !guests.data.length && <p className="text-sm text-neutral-500">{t("guest.none")}</p>}
      {!!guests.data?.length && (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
          {guests.data.map((g) => (
            <li key={g.id} className="flex flex-wrap items-start justify-between gap-3 px-3 py-3" data-guest={g.email}>
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {g.name}
                  {g.disabled && <span className="ml-2 text-xs font-normal text-neutral-500">{t("guest.disabled")}</span>}
                </div>
                <div className="truncate text-neutral-500">{g.email}</div>
                <div className="mt-1 text-xs text-neutral-500">
                  {g.pages.length ? (
                    <>
                      {t("guest.sees")}{" "}
                      {g.pages.map((p, i) => (
                        <span key={p.id}>
                          {i > 0 && ", "}
                          <Link to={`/page/${p.id}`} className="underline decoration-neutral-300 underline-offset-2 hover:text-neutral-800 dark:hover:text-neutral-200">
                            {pageTitle(p.title)}
                          </Link>{" "}
                          ({pageRoleLabel(p.role).toLowerCase()})
                        </span>
                      ))}
                    </>
                  ) : (
                    t("guest.seesNothing")
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (confirm(t("guest.makeMemberConfirm", { name: g.name }))) update.mutate({ id: g.id, patch: { role: "member" } });
                  }}
                  data-make-member
                >
                  {t("guest.makeMember")}
                </Button>
                <Button variant={g.disabled ? "ghost" : "danger"} onClick={() => update.mutate({ id: g.id, patch: { disabled: !g.disabled } })}>
                  {g.disabled ? t("admin.enable") : t("admin.disable")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
