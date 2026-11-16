import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, X } from "lucide-react";
import { GROUP_WORKSPACE_ROLES, WORKSPACE_ROLES, type GroupWorkspaceRole, type WorkspaceGroupMember, type WorkspaceMember, type WorkspaceRole } from "@nootion/shared";
import { PersonChooser, pickedGroup } from "../components/PersonChooser";
import { api } from "../lib/api";
import { keys, useGroups, useUserDirectory, useWorkspaces } from "../lib/queries";
import { useSession } from "../lib/session";
import { workspaceRoleLabel } from "../lib/labels";
import { Button, ErrorText, Field, Select } from "../components/ui";
import { t } from "@nootion/shared";

export function WorkspacePage() {
  const { id = "" } = useParams();
  const { user: me } = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const workspaces = useWorkspaces();
  const ws = workspaces.data?.find((w) => w.id === id);
  const membership = useQuery({
    queryKey: ["members", id],
    queryFn: () => api<{ members: WorkspaceMember[]; groups: WorkspaceGroupMember[] }>(`/workspaces/${id}/members`),
    enabled: !!ws,
  });
  const members = { data: membership.data?.members };
  const spaceGroups = membership.data?.groups ?? [];
  const directory = useUserDirectory();
  const groups = useGroups(ws?.role === "owner");
  const [name, setName] = useState<string | null>(null);
  const [newUser, setNewUser] = useState("");
  const [newRole, setNewRole] = useState<WorkspaceRole>("editor");

  const refreshAll = () => Promise.all([qc.invalidateQueries({ queryKey: ["members", id] }), qc.invalidateQueries({ queryKey: keys.workspaces }), qc.invalidateQueries({ queryKey: ["pages"] })]);

  const rename = useMutation({ mutationFn: (n: string) => api(`/workspaces/${id}`, { method: "PATCH", body: { name: n } }), onSuccess: refreshAll });
  const setMember = useMutation({
    // "group:<id>" picked: the space is opened to the group (never as owner).
    mutationFn: (v: { userId: string; role: WorkspaceRole }) => {
      const groupId = pickedGroup(v.userId);
      return groupId
        ? api(`/workspaces/${id}/groups`, { method: "PUT", body: { groupId, role: v.role === "owner" ? "editor" : v.role } })
        : api(`/workspaces/${id}/members`, { method: "PUT", body: v });
    },
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
  const setGroup = useMutation({
    mutationFn: (v: { groupId: string; role: GroupWorkspaceRole }) => api(`/workspaces/${id}/groups`, { method: "PUT", body: v }),
    onSuccess: refreshAll,
  });
  const removeGroup = useMutation({
    mutationFn: (groupId: string) => api(`/workspaces/${id}/groups/${groupId}`, { method: "DELETE" }),
    onSuccess: refreshAll,
  });
  const remove = useMutation({
    mutationFn: () => api(`/workspaces/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await refreshAll();
      navigate("/");
    },
  });

  if (workspaces.isLoading) return null;
  if (!ws || ws.kind !== "shared") return <div className="p-16 text-neutral-500">{t("workspace.notFound")}</div>;
  const isOwner = ws.role === "owner";
  const memberIds = new Set(members.data?.map((m) => m.userId));
  const candidates = directory.data?.filter((u) => !memberIds.has(u.id)) ?? [];
  const groupIds = new Set(spaceGroups.map((g) => g.groupId));
  const groupCandidates = groups.data?.filter((g) => !groupIds.has(g.id)) ?? [];
  // A group is never owner: the roles offered follow what is picked.
  const roles = pickedGroup(newUser) ? GROUP_WORKSPACE_ROLES : WORKSPACE_ROLES;

  return (
    <div className="mx-auto max-w-3xl space-y-10 px-5 py-8 sm:px-8 sm:py-12">
      <div>
        <p className="text-sm text-neutral-500">{t("workspace.shared")}</p>
        <h1 className="text-2xl font-bold">{ws.name}</h1>
      </div>

      {isOwner && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">{t("auth.name")}</h2>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name) rename.mutate(name);
            }}
          >
            <div className="flex-1">
              <Field label={t("workspace.name")} value={name ?? ws.name} onChange={(e) => setName(e.target.value)} />
            </div>
            <Button type="submit" disabled={!name || name === ws.name}>
              {t("common.rename")}
            </Button>
          </form>
          <ErrorText error={rename.error} />
        </section>
      )}

      <section>
        <h2 className="mb-1 text-lg font-semibold">{t("workspace.members")}</h2>
        <p className="mb-3 text-sm text-neutral-500">
          {t("workspace.membersHelp")}
        </p>
        {isOwner && (
          <form
            className="mb-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (newUser) setMember.mutate({ userId: newUser, role: newRole });
            }}
          >
            <PersonChooser
              candidates={candidates}
              groups={groupCandidates}
              value={newUser}
              onChange={(v) => {
                setNewUser(v);
                if (pickedGroup(v) && newRole === "owner") setNewRole("editor");
              }}
              placeholder={t("workspace.addPerson")}
            />
            <Select value={newRole} onChange={(e) => setNewRole(e.target.value as WorkspaceRole)} aria-label={t("admin.role")}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {workspaceRoleLabel(r)}
                </option>
              ))}
            </Select>
            <Button type="submit" disabled={!newUser}>
              {t("common.add")}
            </Button>
          </form>
        )}
        <ErrorText error={setMember.error ?? removeMember.error ?? setGroup.error ?? removeGroup.error} />
        {spaceGroups.length > 0 && (
          <div className="mb-4" data-space-groups>
            <h3 className="mb-1 text-sm font-semibold">{t("workspace.groupsTitle")}</h3>
            <p className="mb-2 text-xs text-neutral-500">{t("workspace.groupsHelp")}</p>
            <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
              {spaceGroups.map((g) => (
                <li key={g.groupId} className="flex items-center justify-between gap-2 px-3 py-2 text-sm" data-space-group={g.name}>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                      <Users size={15} />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{g.name}</div>
                      <div className="truncate text-xs text-neutral-500">{t("group.memberCount", { count: g.memberCount })}</div>
                    </div>
                  </div>
                  {isOwner ? (
                    <div className="flex items-center gap-1">
                      <Select
                        value={g.role}
                        onChange={(e) => setGroup.mutate({ groupId: g.groupId, role: e.target.value as GroupWorkspaceRole })}
                        aria-label={t("workspace.groupRoleOf", { name: g.name })}
                      >
                        {GROUP_WORKSPACE_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {workspaceRoleLabel(r)}
                          </option>
                        ))}
                      </Select>
                      <Button variant="ghost" onClick={() => removeGroup.mutate(g.groupId)} title={t("workspace.removeGroup")}>
                        <X size={16} />
                      </Button>
                    </div>
                  ) : (
                    <span className="text-neutral-500">{workspaceRoleLabel(g.role)}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {members.data?.map((m) => (
            <li key={m.userId} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {m.name} {m.userId === me?.id && <span className="text-neutral-400">({t("common.youLower")})</span>}
                </div>
                <div className="truncate text-xs text-neutral-500">{m.email}</div>
              </div>
              {isOwner ? (
                <div className="flex items-center gap-1">
                  <Select value={m.role} onChange={(e) => setMember.mutate({ userId: m.userId, role: e.target.value as WorkspaceRole })} aria-label={t("workspace.roleOf", { name: m.name })}>
                    {WORKSPACE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {workspaceRoleLabel(r)}
                      </option>
                    ))}
                  </Select>
                  {m.userId !== me?.id && (
                    <Button variant="ghost" onClick={() => removeMember.mutate(m.userId)} title={t("workspace.removeMember")}>
                      <X size={16} />
                    </Button>
                  )}
                </div>
              ) : (
                <span className="text-neutral-500">{workspaceRoleLabel(m.role)}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2 border-t border-neutral-200 pt-6 dark:border-neutral-800">
        <Button variant="danger" onClick={() => confirm(t("workspace.confirmLeave")) && removeMember.mutate(me!.id)}>
          {t("workspace.leave")}
        </Button>
        {isOwner && (
          <Button
            variant="danger"
            onClick={() => confirm(t("workspace.confirmDelete", { name: ws.name })) && remove.mutate()}
          >
            {t("workspace.delete")}
          </Button>
        )}
        <ErrorText error={remove.error} />
      </section>
    </div>
  );
}
