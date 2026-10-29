import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Trash2 } from "lucide-react";
import { intlLocale, t, type InvitationInfo, type PublicUser, type UserRole } from "@nootion/shared";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { Button, ErrorText, Field, Rich } from "../components/ui";
import { PluginsAdmin } from "./PluginsAdmin";

const dateFmt = () => new Intl.DateTimeFormat(intlLocale(), { dateStyle: "medium" });

export function AdminPage() {
  const { user: me } = useSession();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ["admin", "users"], queryFn: () => api<{ users: PublicUser[] }>("/admin/users") });
  const invitations = useQuery({ queryKey: ["admin", "invitations"], queryFn: () => api<{ invitations: InvitationInfo[] }>("/admin/invitations") });
  const health = useQuery({ queryKey: ["health"], queryFn: () => api<{ version: string }>("/health") });
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("member");
  const [lastLink, setLastLink] = useState<string | null>(null);

  const updateUser = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { role?: UserRole; disabled?: boolean } }) =>
      api(`/admin/users/${id}`, { method: "PATCH", body: patch }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
  const createInvite = useMutation({
    mutationFn: () => api<{ url: string }>("/admin/invitations", { method: "POST", body: { email: inviteEmail || undefined, role: inviteRole } }),
    onSuccess: (data) => {
      setLastLink(data.url);
      setInviteEmail("");
      qc.invalidateQueries({ queryKey: ["admin", "invitations"] });
    },
  });
  const revokeInvite = useMutation({
    mutationFn: (id: string) => api(`/admin/invitations/${id}`, { method: "DELETE" }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["admin", "invitations"] }),
  });

  return (
    <div className="mx-auto max-w-4xl space-y-10 px-5 py-8 sm:px-8 sm:py-12">
      <h1 className="text-2xl font-bold">{t("admin.title")}</h1>

      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("admin.users")}</h2>
        <ErrorText error={updateUser.error} />
        <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-neutral-500 dark:bg-neutral-950">
              <tr>
                <th className="px-3 py-2 font-medium">{t("auth.name")}</th>
                <th className="px-3 py-2 font-medium">{t("auth.email")}</th>
                <th className="px-3 py-2 font-medium">{t("admin.role")}</th>
                <th className="px-3 py-2 font-medium">{t("admin.status")}</th>
              </tr>
            </thead>
            <tbody>
              {users.data?.users.map((u) => (
                <tr key={u.id} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className="px-3 py-2">{u.name}</td>
                  <td className="px-3 py-2 text-neutral-500">{u.email}</td>
                  <td className="px-3 py-2">
                    <select
                      className="rounded border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700"
                      value={u.role}
                      onChange={(e) => updateUser.mutate({ id: u.id, patch: { role: e.target.value as UserRole } })}
                    >
                      <option value="member">{t("admin.member")}</option>
                      <option value="admin">{t("admin.admin")}</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    {u.id === me?.id ? (
                      <span className="text-neutral-400">{t("common.you")}</span>
                    ) : (
                      <Button variant={u.disabled ? "ghost" : "danger"} onClick={() => updateUser.mutate({ id: u.id, patch: { disabled: !u.disabled } })}>
                        {u.disabled ? t("admin.enable") : t("admin.disable")}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold">{t("admin.invite")}</h2>
        <p className="mb-3 text-sm text-neutral-500">{t("admin.inviteHelp")}</p>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            createInvite.mutate();
          }}
        >
          <div className="min-w-64 flex-1">
            <Field label={t("admin.inviteEmail")} type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
          </div>
          <select className="rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as UserRole)}>
            <option value="member">{t("admin.member")}</option>
            <option value="admin">{t("admin.admin")}</option>
          </select>
          <Button type="submit" disabled={createInvite.isPending}>
            {t("admin.createLink")}
          </Button>
        </form>
        <ErrorText error={createInvite.error} />
        {lastLink && (
          <div className="mt-3 flex items-center gap-2 rounded-md bg-green-50 p-3 text-sm dark:bg-green-950">
            <code className="flex-1 break-all">{lastLink}</code>
            <Button variant="ghost" onClick={() => navigator.clipboard.writeText(lastLink)} title={t("common.copy")}>
              <Copy size={16} />
            </Button>
          </div>
        )}
        {!!invitations.data?.invitations.length && (
          <ul className="mt-4 divide-y divide-neutral-200 rounded-lg border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
            {invitations.data.invitations.map((i) => (
              <li key={i.id} className="flex items-center justify-between px-3 py-2">
                <span>
                  {i.email ?? t("admin.openLink")} · {i.role === "admin" ? t("admin.admin") : t("admin.member")} · {t("admin.expiresOn", { date: dateFmt().format(new Date(i.expiresAt)) })}
                </span>
                <Button variant="danger" onClick={() => revokeInvite.mutate(i.id)} title={t("admin.revoke")}>
                  <Trash2 size={16} />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold">{t("admin.backup")}</h2>
        <p className="mb-3 text-sm text-neutral-500">
          <Rich text={t("admin.backupHelp")} />
        </p>
        <a
          href="/api/admin/backup"
          download
          className="inline-flex items-center gap-2 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {t("admin.downloadBackup")}
        </a>
      </section>

      <PluginsAdmin />

      {health.data && <p className="text-xs text-neutral-500">{t("admin.version", { version: health.data.version })}</p>}
    </div>
  );
}
