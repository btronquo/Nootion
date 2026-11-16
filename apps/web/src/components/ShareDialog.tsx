import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Globe, UserPlus, Users, X } from "lucide-react";
import {
  GUEST_PAGE_ROLES,
  intlLocale,
  PAGE_ROLES,
  type GuestPageRole,
  type PageDetail,
  type PageGroupShare,
  type PageRole,
  type PageShare,
  type PendingGuest,
  type PublicLinkInfo,
  type PublicLinkProtectionInput,
} from "@nootion/shared";
import { LinkProtection } from "./LinkProtection";
import { PersonChooser, pickedGroup } from "./PersonChooser";
import { api } from "../lib/api";
import { useGroups, useUserDirectory } from "../lib/queries";
import { useSession } from "../lib/session";
import { pageRoleLabel } from "../lib/labels";
import { Button, CancelButton, ErrorText, Field, Modal, Select } from "./ui";
import { t } from "@nootion/shared";
import { copyText } from "../lib/browser";

const ROLES_DESC = [...PAGE_ROLES].reverse();
/** A guest can't manage a page: no "Full access" for them. */
const GUEST_ROLES_DESC = [...GUEST_PAGE_ROLES].reverse();

interface SharesResponse {
  shares: PageShare[];
  groupShares: PageGroupShare[];
  pendingGuests: PendingGuest[];
  guestsAllowed: boolean;
}

export function ShareDialog({ page, onClose }: { page: PageDetail; onClose: () => void }) {
  const { user: me } = useSession();
  const qc = useQueryClient();
  const directory = useUserDirectory();
  const groups = useGroups(me?.role !== "guest");
  const sharing = useQuery({ queryKey: ["shares", page.id], queryFn: () => api<SharesResponse>(`/pages/${page.id}/shares`) });
  const shares = { data: sharing.data?.shares };
  const link = useQuery({ queryKey: ["public-link", page.id], queryFn: async () => (await api<{ link: PublicLinkInfo | null }>(`/pages/${page.id}/public-link`)).link });
  const [newUser, setNewUser] = useState("");
  const [newRole, setNewRole] = useState<PageRole>("viewer");
  const [copied, setCopied] = useState(false);

  const invalidate = () => Promise.all([qc.invalidateQueries({ queryKey: ["shares", page.id] }), qc.invalidateQueries({ queryKey: ["public-link", page.id] })]);

  const setShare = useMutation({
    // "group:<id>" picked: the page is shared with the group.
    mutationFn: (v: { userId: string; role: PageRole }) => {
      const groupId = pickedGroup(v.userId);
      return groupId
        ? api(`/pages/${page.id}/group-shares`, { method: "PUT", body: { groupId, role: v.role } })
        : api(`/pages/${page.id}/shares`, { method: "PUT", body: v });
    },
    onSuccess: () => {
      setNewUser("");
      return invalidate();
    },
  });
  const removeShare = useMutation({
    mutationFn: (userId: string) => api(`/pages/${page.id}/shares/${userId}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
  const setGroupShare = useMutation({
    mutationFn: (v: { groupId: string; role: PageRole }) => api(`/pages/${page.id}/group-shares`, { method: "PUT", body: v }),
    onSuccess: invalidate,
  });
  const removeGroupShare = useMutation({
    mutationFn: (groupId: string) => api(`/pages/${page.id}/group-shares/${groupId}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
  const setLink = useMutation({
    mutationFn: (includeSubpages: boolean) => api(`/pages/${page.id}/public-link`, { method: "PUT", body: { includeSubpages } }),
    onSuccess: invalidate,
  });
  const protect = async (input: PublicLinkProtectionInput) => {
    const res = await api<{ link: PublicLinkInfo }>(`/pages/${page.id}/public-link`, { method: "PUT", body: input });
    qc.setQueryData(["public-link", page.id], res.link);
  };
  const removeGuest = useMutation({
    mutationFn: (invitationId: string) => api(`/pages/${page.id}/guests/${invitationId}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
  const removeLink = useMutation({ mutationFn: () => api(`/pages/${page.id}/public-link`, { method: "DELETE" }), onSuccess: invalidate });

  const sharedIds = new Set(shares.data?.filter((s) => !s.inheritedFrom).map((s) => s.userId));
  const candidates = directory.data?.filter((u) => u.id !== me?.id && !sharedIds.has(u.id)) ?? [];
  const sharedGroups = new Set(sharing.data?.groupShares.filter((g) => !g.inheritedFrom).map((g) => g.groupId));
  const groupCandidates = groups.data?.filter((g) => !sharedGroups.has(g.id)) ?? [];
  const groupShares = sharing.data?.groupShares ?? [];

  return (
    <Modal title={t("share.title")} onClose={onClose} wide>
      <section className="space-y-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newUser) setShare.mutate({ userId: newUser, role: newRole });
          }}
        >
          <PersonChooser candidates={candidates} groups={groupCandidates} value={newUser} onChange={setNewUser} placeholder={t("share.choosePerson")} />
          <Select value={newRole} onChange={(e) => setNewRole(e.target.value as PageRole)} aria-label={t("share.access")}>
            {ROLES_DESC.map((r) => (
              <option key={r} value={r}>
                {pageRoleLabel(r)}
              </option>
            ))}
          </Select>
          <Button type="submit" disabled={!newUser}>
            {t("share.invite")}
          </Button>
        </form>
        <ErrorText error={setShare.error ?? removeShare.error ?? setGroupShare.error ?? removeGroupShare.error} />

        <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {groupShares.map((g) => (
            <li key={`group:${g.groupId}`} className="flex items-center justify-between gap-2 py-2 text-sm" data-group-share={g.name}>
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                  <Users size={15} />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 truncate font-medium">
                    {g.name}
                    <GroupBadge />
                  </div>
                  <div className="truncate text-xs text-neutral-500">
                    {t("group.memberCount", { count: g.memberCount })}
                    {g.inheritedFrom && <> · {t("share.inheritedFrom", { title: g.inheritedFrom.title || t("common.untitled") })}</>}
                  </div>
                </div>
              </div>
              {g.inheritedFrom ? (
                <span className="text-neutral-500">{pageRoleLabel(g.role)}</span>
              ) : (
                <div className="flex items-center gap-1">
                  <Select
                    value={g.role}
                    onChange={(e) => setGroupShare.mutate({ groupId: g.groupId, role: e.target.value as PageRole })}
                    aria-label={t("share.groupAccessOf", { name: g.name })}
                  >
                    {ROLES_DESC.map((r) => (
                      <option key={r} value={r}>
                        {pageRoleLabel(r)}
                      </option>
                    ))}
                  </Select>
                  <Button variant="ghost" onClick={() => removeGroupShare.mutate(g.groupId)} title={t("share.removeAccess")}>
                    <X size={16} />
                  </Button>
                </div>
              )}
            </li>
          ))}
          {shares.data?.map((s) => (
            <li key={s.userId} className="flex items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 truncate font-medium">
                  {s.name}
                  {s.guest && <GuestBadge />}
                </div>
                <div className="truncate text-xs text-neutral-500">
                  {s.email}
                  {s.inheritedFrom && <> · {t("share.inheritedFrom", { title: s.inheritedFrom.title || t("common.untitled") })}</>}
                </div>
              </div>
              {s.inheritedFrom ? (
                <span className="text-neutral-500">{pageRoleLabel(s.role)}</span>
              ) : (
                <div className="flex items-center gap-1">
                  <Select value={s.role} onChange={(e) => setShare.mutate({ userId: s.userId, role: e.target.value as PageRole })} aria-label={t("share.accessOf", { name: s.name })}>
                    {(s.guest ? GUEST_ROLES_DESC : ROLES_DESC).map((r) => (
                      <option key={r} value={r}>
                        {pageRoleLabel(r)}
                      </option>
                    ))}
                  </Select>
                  <Button variant="ghost" onClick={() => removeShare.mutate(s.userId)} title={t("share.removeAccess")}>
                    <X size={16} />
                  </Button>
                </div>
              )}
            </li>
          ))}
          {sharing.data?.pendingGuests.map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-2 py-2 text-sm" data-pending-guest>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 truncate font-medium">
                  {g.email}
                  <GuestBadge />
                </div>
                <div className="truncate text-xs text-neutral-500">
                  {t("guest.pending", { date: new Intl.DateTimeFormat(intlLocale(), { dateStyle: "medium" }).format(new Date(g.expiresAt)) })}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-neutral-500">{pageRoleLabel(g.role)}</span>
                <Button variant="ghost" onClick={() => removeGuest.mutate(g.id)} title={t("guest.cancelInvitation")} aria-label={t("guest.cancelInvitation")}>
                  <X size={16} />
                </Button>
              </div>
            </li>
          ))}
          {shares.data?.length === 0 && !groupShares.length && !sharing.data?.pendingGuests.length && <li className="py-2 text-sm text-neutral-500">{t("share.nobody")}</li>}
        </ul>
        {page.role === "full" && me?.role !== "guest" && sharing.data?.guestsAllowed && <InviteGuest pageId={page.id} onInvited={invalidate} />}
      </section>

      <section className="mt-5 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Globe size={16} /> {t("share.publicLink")}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" aria-label={t("share.enableLink")} checked={!!link.data} onChange={(e) => (e.target.checked ? setLink.mutate(true) : removeLink.mutate())} />
            {link.data ? t("plugins.enabled") : t("plugins.disabled")}
          </label>
        </div>
        {link.data && (
          <div className="mt-3 space-y-2">
            <div
              className={`flex items-center gap-2 rounded-md bg-neutral-100 p-2 text-sm dark:bg-neutral-800 ${link.data.expired ? "opacity-50" : ""}`}
              data-public-link-url
            >
              <code className={`flex-1 break-all ${link.data.expired ? "line-through" : ""}`}>{link.data.url}</code>
              <Button
                variant="ghost"
                onClick={async () => {
                  setCopied(await copyText(link.data!.url));
                }}
                title={t("common.copy")}
              >
                <Copy size={16} /> {copied ? t("common.copied") : ""}
              </Button>
            </div>
            <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
              <input type="checkbox" checked={link.data.includeSubpages} onChange={(e) => setLink.mutate(e.target.checked)} />
              {t("share.includeSubpages")}
            </label>
            <LinkProtection value={link.data} onChange={protect} />
            <p className="text-xs text-neutral-500">{t("share.publicHelp")}</p>
          </div>
        )}
      </section>

      <div className="mt-5 flex justify-end">
        <CancelButton onClose={onClose} label={t("common.close")} />
      </div>
    </Modal>
  );
}

function GroupBadge() {
  return (
    <span className="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-[11px] font-medium text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" data-group-badge>
      {t("group.badge")}
    </span>
  );
}

function GuestBadge() {
  return (
    <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" data-guest-badge>
      {t("guest.badge")}
    </span>
  );
}

/** "Invite a guest": someone from outside, by e-mail, who will only see this page (and its subpages). */
function InviteGuest({ pageId, onInvited }: { pageId: string; onInvited: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<GuestPageRole>("viewer");
  const [result, setResult] = useState<{ email: string; shared: boolean; emailed: boolean; url?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const invite = useMutation({
    mutationFn: () => api<{ shared: boolean; emailed?: boolean; url?: string }>(`/pages/${pageId}/guests`, { method: "POST", body: { email, role } }),
    onSuccess: (res) => {
      setResult({ email, shared: res.shared, emailed: !!res.emailed, url: res.url });
      setEmail("");
      setCopied(false);
      return onInvited();
    },
  });

  if (!open) {
    return (
      <Button variant="ghost" onClick={() => setOpen(true)} data-invite-guest>
        <UserPlus size={16} /> {t("guest.invite")}
      </Button>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800" data-invite-guest-form>
      <div className="flex items-center gap-2 text-sm font-medium">
        <UserPlus size={16} /> {t("guest.invite")}
      </div>
      <p className="text-xs text-neutral-500">{t("guest.inviteHelp")}</p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          invite.mutate();
        }}
      >
        <div className="min-w-48 flex-1">
          <Field label={t("auth.email")} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("guest.emailPlaceholder")} required autoFocus />
        </div>
        <Select value={role} onChange={(e) => setRole(e.target.value as GuestPageRole)} aria-label={t("share.access")}>
          {GUEST_ROLES_DESC.map((r) => (
            <option key={r} value={r}>
              {pageRoleLabel(r)}
            </option>
          ))}
        </Select>
        <Button type="submit" disabled={invite.isPending || !email}>
          {t("guest.send")}
        </Button>
      </form>
      <ErrorText error={invite.error} />
      {result && (
        <div className="space-y-2 text-sm" data-guest-result>
          <p className="text-green-700 dark:text-green-400">
            ✓ {result.shared ? t("guest.alreadyMember", { email: result.email }) : result.emailed ? t("guest.emailed", { email: result.email }) : t("guest.linkReady")}
          </p>
          {result.url && (
            <div className="flex items-center gap-2 rounded-md bg-neutral-100 p-2 dark:bg-neutral-800">
              <code className="flex-1 break-all text-xs">{result.url}</code>
              <Button variant="ghost" onClick={async () => setCopied(await copyText(result.url!))} title={t("common.copy")}>
                <Copy size={16} /> {copied ? t("common.copied") : ""}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
