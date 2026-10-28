import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { WORKSPACE_ROLES, type WorkspaceMember, type WorkspaceRole } from "@nootion/shared";
import { api } from "../lib/api";
import { keys, useUserDirectory, useWorkspaces } from "../lib/queries";
import { useSession } from "../lib/session";
import { WORKSPACE_ROLE_LABELS } from "../lib/labels";
import { Button, ErrorText, Field, Select } from "../components/ui";

export function WorkspacePage() {
  const { id = "" } = useParams();
  const { user: me } = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const workspaces = useWorkspaces();
  const ws = workspaces.data?.find((w) => w.id === id);
  const members = useQuery({
    queryKey: ["members", id],
    queryFn: async () => (await api<{ members: WorkspaceMember[] }>(`/workspaces/${id}/members`)).members,
    enabled: !!ws,
  });
  const directory = useUserDirectory();
  const [name, setName] = useState<string | null>(null);
  const [newUser, setNewUser] = useState("");
  const [newRole, setNewRole] = useState<WorkspaceRole>("editor");

  const refreshAll = () => Promise.all([qc.invalidateQueries({ queryKey: ["members", id] }), qc.invalidateQueries({ queryKey: keys.workspaces }), qc.invalidateQueries({ queryKey: ["pages"] })]);

  const rename = useMutation({ mutationFn: (n: string) => api(`/workspaces/${id}`, { method: "PATCH", body: { name: n } }), onSuccess: refreshAll });
  const setMember = useMutation({
    mutationFn: (v: { userId: string; role: WorkspaceRole }) => api(`/workspaces/${id}/members`, { method: "PUT", body: v }),
    onSuccess: () => {
      setNewUser("");
      return refreshAll();
    },
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) => api(`/workspaces/${id}/members/${userId}`, { method: "DELETE" }),
    onSuccess: async (_d, userId) => {
      if (userId === me?.id) {
        await refreshAll();
        navigate("/");
      } else await refreshAll();
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/workspaces/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await refreshAll();
      navigate("/");
    },
  });

  if (workspaces.isLoading) return null;
  if (!ws || ws.kind !== "shared") return <div className="p-16 text-neutral-500">Espace introuvable.</div>;
  const isOwner = ws.role === "owner";
  const memberIds = new Set(members.data?.map((m) => m.userId));
  const candidates = directory.data?.filter((u) => !memberIds.has(u.id)) ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-10 px-8 py-12">
      <div>
        <p className="text-sm text-neutral-500">Espace partagé</p>
        <h1 className="text-2xl font-bold">{ws.name}</h1>
      </div>

      {isOwner && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Nom</h2>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name) rename.mutate(name);
            }}
          >
            <div className="flex-1">
              <Field label="Nom de l'espace" value={name ?? ws.name} onChange={(e) => setName(e.target.value)} />
            </div>
            <Button type="submit" disabled={!name || name === ws.name}>
              Renommer
            </Button>
          </form>
          <ErrorText error={rename.error} />
        </section>
      )}

      <section>
        <h2 className="mb-1 text-lg font-semibold">Membres</h2>
        <p className="mb-3 text-sm text-neutral-500">
          Les membres voient toutes les pages de l'espace. Éditeur : peut tout modifier et partager. Commentateur et lecteur : lecture seule pour l'instant.
        </p>
        {isOwner && (
          <form
            className="mb-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (newUser) setMember.mutate({ userId: newUser, role: newRole });
            }}
          >
            <Select className="min-w-0 flex-1" value={newUser} onChange={(e) => setNewUser(e.target.value)} aria-label="Personne">
              <option value="">Ajouter une personne…</option>
              {candidates.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </option>
              ))}
            </Select>
            <Select value={newRole} onChange={(e) => setNewRole(e.target.value as WorkspaceRole)} aria-label="Rôle">
              {WORKSPACE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {WORKSPACE_ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
            <Button type="submit" disabled={!newUser}>
              Ajouter
            </Button>
          </form>
        )}
        <ErrorText error={setMember.error ?? removeMember.error} />
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {members.data?.map((m) => (
            <li key={m.userId} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {m.name} {m.userId === me?.id && <span className="text-neutral-400">(vous)</span>}
                </div>
                <div className="truncate text-xs text-neutral-500">{m.email}</div>
              </div>
              {isOwner ? (
                <div className="flex items-center gap-1">
                  <Select value={m.role} onChange={(e) => setMember.mutate({ userId: m.userId, role: e.target.value as WorkspaceRole })} aria-label={`Rôle de ${m.name}`}>
                    {WORKSPACE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {WORKSPACE_ROLE_LABELS[r]}
                      </option>
                    ))}
                  </Select>
                  {m.userId !== me?.id && (
                    <Button variant="ghost" onClick={() => removeMember.mutate(m.userId)} title="Retirer de l'espace">
                      <X size={16} />
                    </Button>
                  )}
                </div>
              ) : (
                <span className="text-neutral-500">{WORKSPACE_ROLE_LABELS[m.role]}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2 border-t border-neutral-200 pt-6 dark:border-neutral-800">
        <Button variant="danger" onClick={() => confirm("Quitter cet espace ?") && removeMember.mutate(me!.id)}>
          Quitter l'espace
        </Button>
        {isOwner && (
          <Button
            variant="danger"
            onClick={() => confirm(`Supprimer définitivement « ${ws.name} » et toutes ses pages ?`) && remove.mutate()}
          >
            Supprimer l'espace et ses pages
          </Button>
        )}
        <ErrorText error={remove.error} />
      </section>
    </div>
  );
}
