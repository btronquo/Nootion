import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, Trash2, Users, X } from "lucide-react";
import { t, type GroupDetail, type PublicUser } from "@nootion/shared";
import { api } from "../lib/api";
import { keys } from "../lib/queries";
import { pageRoleLabel, workspaceRoleLabel } from "../lib/labels";
import { pageTitle } from "../lib/tree";
import { Avatar } from "../components/Avatar";
import { Button, ErrorText, Field, Select } from "../components/ui";

const groupsKey = ["admin", "groups"];

/**
 * Groups of people: an administrator makes them and chooses who is in them; owners of spaces and pages then share
 * with a whole group at once. Groups made by the company's directory (SCIM) are listed too, marked as such.
 */
export function GroupsAdmin() {
  const qc = useQueryClient();
  const groups = useQuery({ queryKey: groupsKey, queryFn: async () => (await api<{ groups: GroupDetail[] }>("/admin/groups")).groups });
  const users = useQuery({ queryKey: ["admin", "users"], queryFn: () => api<{ users: PublicUser[] }>("/admin/users") });
  const [name, setName] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: groupsKey }), qc.invalidateQueries({ queryKey: keys.groups })]);
  const create = useMutation({
    mutationFn: () => api<{ group: GroupDetail }>("/admin/groups", { method: "POST", body: { name } }),
    onSuccess: async (res) => {
      setName("");
      setOpen(res.group.id);
      await refresh();
    },
  });

  return (
    <section data-groups-admin>
      <h2 className="mb-1 text-lg font-semibold">{t("group.adminTitle")}</h2>
      <p className="mb-3 text-sm text-neutral-500">{t("group.adminHelp")}</p>
      <form
        className="mb-4 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <div className="min-w-48 flex-1">
          <Field
            label={t("group.name")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("group.namePlaceholder")}
            maxLength={100}
            data-new-group
          />
        </div>
        <Button type="submit" disabled={!name.trim() || create.isPending}>
          {t("group.create")}
        </Button>
      </form>
      <ErrorText error={create.error} />
      {groups.data && !groups.data.length && <p className="text-sm text-neutral-500">{t("group.none")}</p>}
      {!!groups.data?.length && (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
          {groups.data.map((g) => (
            <GroupRow
              key={g.id}
              group={g}
              users={users.data?.users ?? []}
              open={open === g.id}
              onToggle={() => setOpen(open === g.id ? null : g.id)}
              onChanged={refresh}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function GroupRow({
  group: g,
  users,
  open,
  onToggle,
  onChanged,
}: {
  group: GroupDetail;
  users: PublicUser[];
  open: boolean;
  onToggle: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const [name, setName] = useState<string | null>(null);
  const [adding, setAdding] = useState("");
  const call = useMutation({ mutationFn: (req: { path: string; method: string; body?: unknown }) => api(req.path, req), onSuccess: onChanged });
  const base = `/admin/groups/${g.id}`;
  const inGroup = new Set(g.members.map((m) => m.id));
  // Guests are never in a group.
  const candidates = users.filter((u) => u.role !== "guest" && !u.disabled && !inGroup.has(u.id));
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <li data-group={g.name}>
      <button
        type="button"
        className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
        onClick={onToggle}
        aria-expanded={open}
      >
        <Chevron size={16} className="shrink-0 text-neutral-400" />
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
          <Users size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 font-medium">
            <span className="truncate">{g.name}</span>
            {g.scim && (
              <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                {t("group.scim")}
              </span>
            )}
          </span>
          <span className="block truncate text-xs text-neutral-500">
            {t("group.memberCount", { count: g.memberCount })}
            {g.members.length > 0 && <> · {g.members.map((m) => m.name).join(", ")}</>}
          </span>
        </span>
        <span className="flex shrink-0 -space-x-1.5">
          {g.members.slice(0, 4).map((m) => (
            <span key={m.id} className="rounded-full ring-2 ring-white dark:ring-neutral-900">
              <Avatar name={m.name} url={m.avatarUrl} size={22} />
            </span>
          ))}
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-neutral-100 px-3 pt-3 pb-4 sm:pl-14 dark:border-neutral-800" data-group-details>
          {g.scim && <p className="text-xs text-neutral-500">{t("group.scimHelp")}</p>}
          <ErrorText error={call.error} />

          <div>
            <ul className="mb-2 space-y-1">
              {g.members.map((m) => (
                <li key={m.id} className="flex items-center gap-2" data-group-member={m.email}>
                  <Avatar name={m.name} url={m.avatarUrl} size={22} />
                  <span className="min-w-0 flex-1 truncate">
                    {m.name} <span className="text-neutral-500">{m.email}</span>
                  </span>
                  <Button
                    variant="ghost"
                    className="!p-1.5"
                    onClick={() => call.mutate({ path: `${base}/members/${m.id}`, method: "DELETE" })}
                    title={t("group.removeMember")}
                    aria-label={t("group.removeMember")}
                  >
                    <X size={14} />
                  </Button>
                </li>
              ))}
              {!g.members.length && <li className="text-neutral-500">{t("group.noMembers")}</li>}
            </ul>
            <Select
              className="w-full sm:w-72"
              value={adding}
              aria-label={t("group.addMember")}
              onChange={(e) => {
                const userId = e.target.value;
                setAdding("");
                if (userId) call.mutate({ path: `${base}/members`, method: "PUT", body: { userId } });
              }}
              data-add-member
            >
              <option value="">{t("group.addMember")}</option>
              {candidates.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </option>
              ))}
            </Select>
          </div>

          <div className="text-xs text-neutral-500">
            <span className="font-medium text-neutral-700 dark:text-neutral-300">{t("group.opens")}</span>{" "}
            {g.spaces.length || g.pages.length
              ? [
                  ...g.spaces.map((s) => ({ key: s.id, label: <span>{s.name}</span>, role: workspaceRoleLabel(s.role) })),
                  ...g.pages.map((p) => ({
                    key: p.id,
                    label: (
                      <Link
                        to={`/page/${p.id}`}
                        className="underline decoration-neutral-300 underline-offset-2 hover:text-neutral-800 dark:hover:text-neutral-200"
                      >
                        {pageTitle(p.title)}
                      </Link>
                    ),
                    role: pageRoleLabel(p.role),
                  })),
                ].map((item, i) => (
                  <span key={item.key}>
                    {i > 0 && ", "}
                    {item.label} ({item.role.toLowerCase()})
                  </span>
                ))
              : t("group.opensNothing")}
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <form
              className="flex flex-1 flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (name?.trim() && name !== g.name) call.mutate({ path: base, method: "PATCH", body: { name } }, { onSuccess: () => setName(null) });
              }}
            >
              <div className="min-w-40 flex-1 sm:max-w-72">
                <Field label={t("group.name")} value={name ?? g.name} onChange={(e) => setName(e.target.value)} maxLength={100} />
              </div>
              <Button type="submit" variant="ghost" disabled={!name?.trim() || name === g.name}>
                {t("group.rename")}
              </Button>
            </form>
            <Button
              variant="danger"
              onClick={() => confirm(t("group.confirmDelete", { name: g.name })) && call.mutate({ path: base, method: "DELETE" })}
              data-delete-group
            >
              <Trash2 size={15} /> {t("group.delete")}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
