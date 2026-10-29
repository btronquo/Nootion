import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Trash2 } from "lucide-react";
import type { InvitationInfo, PublicUser, UserRole } from "@nootion/shared";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { Button, ErrorText, Field } from "../components/ui";
import { PluginsAdmin } from "./PluginsAdmin";

const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" });

export function AdminPage() {
  const { user: me } = useSession();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ["admin", "users"], queryFn: () => api<{ users: PublicUser[] }>("/admin/users") });
  const invitations = useQuery({ queryKey: ["admin", "invitations"], queryFn: () => api<{ invitations: InvitationInfo[] }>("/admin/invitations") });
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
    <div className="mx-auto max-w-4xl space-y-10 px-8 py-12">
      <h1 className="text-2xl font-bold">Administration</h1>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Utilisateurs</h2>
        <ErrorText error={updateUser.error} />
        <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-neutral-500 dark:bg-neutral-950">
              <tr>
                <th className="px-3 py-2 font-medium">Nom</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Rôle</th>
                <th className="px-3 py-2 font-medium">Statut</th>
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
                      <option value="member">Membre</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    {u.id === me?.id ? (
                      <span className="text-neutral-400">Vous</span>
                    ) : (
                      <Button variant={u.disabled ? "ghost" : "danger"} onClick={() => updateUser.mutate({ id: u.id, patch: { disabled: !u.disabled } })}>
                        {u.disabled ? "Réactiver" : "Désactiver"}
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
        <h2 className="mb-1 text-lg font-semibold">Inviter quelqu'un</h2>
        <p className="mb-3 text-sm text-neutral-500">Créez un lien d'invitation valable 7 jours et envoyez-le à la personne.</p>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            createInvite.mutate();
          }}
        >
          <div className="min-w-64 flex-1">
            <Field label="Email (optionnel, réserve le lien à cette adresse)" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
          </div>
          <select className="rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as UserRole)}>
            <option value="member">Membre</option>
            <option value="admin">Admin</option>
          </select>
          <Button type="submit" disabled={createInvite.isPending}>
            Créer le lien
          </Button>
        </form>
        <ErrorText error={createInvite.error} />
        {lastLink && (
          <div className="mt-3 flex items-center gap-2 rounded-md bg-green-50 p-3 text-sm dark:bg-green-950">
            <code className="flex-1 break-all">{lastLink}</code>
            <Button variant="ghost" onClick={() => navigator.clipboard.writeText(lastLink)} title="Copier">
              <Copy size={16} />
            </Button>
          </div>
        )}
        {!!invitations.data?.invitations.length && (
          <ul className="mt-4 divide-y divide-neutral-200 rounded-lg border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
            {invitations.data.invitations.map((i) => (
              <li key={i.id} className="flex items-center justify-between px-3 py-2">
                <span>
                  {i.email ?? "Lien ouvert"} · {i.role === "admin" ? "Admin" : "Membre"} · expire le {dateFmt.format(new Date(i.expiresAt))}
                </span>
                <Button variant="danger" onClick={() => revokeInvite.mutate(i.id)} title="Révoquer">
                  <Trash2 size={16} />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold">Sauvegarde</h2>
        <p className="mb-3 text-sm text-neutral-500">
          Télécharge tout Nootion dans un fichier .zip : la base (comptes, pages, databases), les fichiers joints, les photos de profil et les
          plugins. Pour restaurer, décompressez-le dans le dossier <code>/data</code> à la place de l'ancien, conteneur arrêté.
        </p>
        <a
          href="/api/admin/backup"
          download
          className="inline-flex items-center gap-2 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          Télécharger une sauvegarde
        </a>
      </section>

      <PluginsAdmin />
    </div>
  );
}
