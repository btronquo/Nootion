import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Trash2 } from "lucide-react";
import { intlLocale, t, type InvitationInfo, type MemberRole } from "@nootion/shared";
import { api } from "../lib/api";
import { copyText } from "../lib/browser";
import { Button, ErrorText, Field } from "../components/ui";

const dateFmt = () => new Intl.DateTimeFormat(intlLocale(), { dateStyle: "medium" });

/** Invitations by link (optionally e-mailed): in Administration and in the setup assistant. */
export function InviteAdmin() {
  const qc = useQueryClient();
  const invitations = useQuery({
    queryKey: ["admin", "invitations"],
    queryFn: () => api<{ invitations: InvitationInfo[] }>("/admin/invitations"),
  });
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<MemberRole>("member");
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [emailedTo, setEmailedTo] = useState<string | null>(null);
  const createInvite = useMutation({
    mutationFn: () =>
      api<{ url: string; emailed: boolean }>("/admin/invitations", {
        method: "POST",
        body: { email: inviteEmail || undefined, role: inviteRole },
      }),
    onSuccess: (data) => {
      setLastLink(data.url);
      setEmailedTo(data.emailed ? inviteEmail : null);
      setInviteEmail("");
      qc.invalidateQueries({ queryKey: ["admin", "invitations"] });
    },
  });
  const revokeInvite = useMutation({
    mutationFn: (id: string) =>
      api(`/admin/invitations/${id}`, { method: "DELETE" }),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: ["admin", "invitations"] }),
  });

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">
        {t("admin.invite")}
      </h2>
      <p className="mb-3 text-sm text-neutral-500">
        {t("admin.inviteHelp")}
      </p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          createInvite.mutate();
        }}
      >
        <div className="min-w-64 flex-1">
          <Field
            label={t("admin.inviteEmail")}
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
          />
        </div>
        <select
          className="rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
          value={inviteRole}
          onChange={(e) => setInviteRole(e.target.value as MemberRole)}
        >
          <option value="member">{t("admin.member")}</option>
          <option value="admin">{t("admin.admin")}</option>
        </select>
        <Button type="submit" disabled={createInvite.isPending}>
          {t("admin.createLink")}
        </Button>
      </form>
      <ErrorText error={createInvite.error} />
      {lastLink && emailedTo && (
        <p className="mt-3 text-sm text-green-700 dark:text-green-400">
          ✓ {t("admin.inviteEmailed", { email: emailedTo })}
        </p>
      )}
      {lastLink && (
        <div className="mt-3 flex items-center gap-2 rounded-md bg-green-50 p-3 text-sm dark:bg-green-950">
          <code className="flex-1 break-all">{lastLink}</code>
          <Button
            variant="ghost"
            onClick={() => void copyText(lastLink)}
            title={t("common.copy")}
          >
            <Copy size={16} />
          </Button>
        </div>
      )}
      {!!invitations.data?.invitations.length && (
        <ul className="mt-4 divide-y divide-neutral-200 rounded-lg border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
          {invitations.data.invitations.map((i) => (
            <li
              key={i.id}
              className="flex items-center justify-between px-3 py-2"
            >
              <span>
                {i.email ?? t("admin.openLink")} ·{" "}
                {i.role === "admin"
                  ? t("admin.admin")
                  : i.role === "guest"
                    ? t("guest.invitedOn", { title: i.page?.title || t("common.untitled") })
                    : t("admin.member")}{" "}
                ·{" "}
                {t("admin.expiresOn", {
                  date: dateFmt().format(new Date(i.expiresAt)),
                })}
              </span>
              <Button
                variant="danger"
                onClick={() => revokeInvite.mutate(i.id)}
                title={t("admin.revoke")}
              >
                <Trash2 size={16} />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
