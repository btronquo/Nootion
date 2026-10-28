import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Globe, X } from "lucide-react";
import { PAGE_ROLES, type PageDetail, type PageRole, type PageShare, type PublicLinkInfo } from "@nootion/shared";
import { api } from "../lib/api";
import { useUserDirectory } from "../lib/queries";
import { useSession } from "../lib/session";
import { PAGE_ROLE_LABELS } from "../lib/labels";
import { Button, ErrorText, Modal, Select } from "./ui";

const ROLES_DESC = [...PAGE_ROLES].reverse();

export function ShareDialog({ page, onClose }: { page: PageDetail; onClose: () => void }) {
  const { user: me } = useSession();
  const qc = useQueryClient();
  const directory = useUserDirectory();
  const shares = useQuery({ queryKey: ["shares", page.id], queryFn: async () => (await api<{ shares: PageShare[] }>(`/pages/${page.id}/shares`)).shares });
  const link = useQuery({ queryKey: ["public-link", page.id], queryFn: async () => (await api<{ link: PublicLinkInfo | null }>(`/pages/${page.id}/public-link`)).link });
  const [newUser, setNewUser] = useState("");
  const [newRole, setNewRole] = useState<PageRole>("viewer");
  const [copied, setCopied] = useState(false);

  const invalidate = () => Promise.all([qc.invalidateQueries({ queryKey: ["shares", page.id] }), qc.invalidateQueries({ queryKey: ["public-link", page.id] })]);

  const setShare = useMutation({
    mutationFn: (v: { userId: string; role: PageRole }) => api(`/pages/${page.id}/shares`, { method: "PUT", body: v }),
    onSuccess: () => {
      setNewUser("");
      return invalidate();
    },
  });
  const removeShare = useMutation({
    mutationFn: (userId: string) => api(`/pages/${page.id}/shares/${userId}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
  const setLink = useMutation({
    mutationFn: (includeSubpages: boolean) => api(`/pages/${page.id}/public-link`, { method: "PUT", body: { includeSubpages } }),
    onSuccess: invalidate,
  });
  const removeLink = useMutation({ mutationFn: () => api(`/pages/${page.id}/public-link`, { method: "DELETE" }), onSuccess: invalidate });

  const sharedIds = new Set(shares.data?.filter((s) => !s.inheritedFrom).map((s) => s.userId));
  const candidates = directory.data?.filter((u) => u.id !== me?.id && !sharedIds.has(u.id)) ?? [];

  return (
    <Modal title="Partager la page" onClose={onClose} wide>
      <section className="space-y-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newUser) setShare.mutate({ userId: newUser, role: newRole });
          }}
        >
          <Select className="min-w-0 flex-1" value={newUser} onChange={(e) => setNewUser(e.target.value)} aria-label="Personne">
            <option value="">Choisir une personne…</option>
            {candidates.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.email})
              </option>
            ))}
          </Select>
          <Select value={newRole} onChange={(e) => setNewRole(e.target.value as PageRole)} aria-label="Droit">
            {ROLES_DESC.map((r) => (
              <option key={r} value={r}>
                {PAGE_ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
          <Button type="submit" disabled={!newUser}>
            Inviter
          </Button>
        </form>
        <ErrorText error={setShare.error ?? removeShare.error} />

        <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {shares.data?.map((s) => (
            <li key={s.userId} className="flex items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{s.name}</div>
                <div className="truncate text-xs text-neutral-500">
                  {s.email}
                  {s.inheritedFrom && <> · hérité de « {s.inheritedFrom.title || "Sans titre"} »</>}
                </div>
              </div>
              {s.inheritedFrom ? (
                <span className="text-neutral-500">{PAGE_ROLE_LABELS[s.role]}</span>
              ) : (
                <div className="flex items-center gap-1">
                  <Select value={s.role} onChange={(e) => setShare.mutate({ userId: s.userId, role: e.target.value as PageRole })} aria-label={`Droit de ${s.name}`}>
                    {ROLES_DESC.map((r) => (
                      <option key={r} value={r}>
                        {PAGE_ROLE_LABELS[r]}
                      </option>
                    ))}
                  </Select>
                  <Button variant="ghost" onClick={() => removeShare.mutate(s.userId)} title="Retirer l'accès">
                    <X size={16} />
                  </Button>
                </div>
              )}
            </li>
          ))}
          {shares.data?.length === 0 && <li className="py-2 text-sm text-neutral-500">Cette page n'est partagée avec personne. Les sous-pages héritent des partages.</li>}
        </ul>
      </section>

      <section className="mt-5 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Globe size={16} /> Lien public (lecture seule)
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!link.data} onChange={(e) => (e.target.checked ? setLink.mutate(true) : removeLink.mutate())} />
            {link.data ? "Activé" : "Désactivé"}
          </label>
        </div>
        {link.data && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2 rounded-md bg-neutral-100 p-2 text-sm dark:bg-neutral-800">
              <code className="flex-1 break-all">{link.data.url}</code>
              <Button
                variant="ghost"
                onClick={async () => {
                  await navigator.clipboard.writeText(link.data!.url);
                  setCopied(true);
                }}
                title="Copier"
              >
                <Copy size={16} /> {copied ? "Copié" : ""}
              </Button>
            </div>
            <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
              <input type="checkbox" checked={link.data.includeSubpages} onChange={(e) => setLink.mutate(e.target.checked)} />
              Inclure les sous-pages
            </label>
            <p className="text-xs text-neutral-500">Toute personne ayant ce lien peut lire la page, sans compte. Désactivez-le pour couper l'accès.</p>
          </div>
        )}
      </section>

      <div className="mt-5 flex justify-end">
        <Button variant="ghost" onClick={onClose}>
          Fermer
        </Button>
      </div>
    </Modal>
  );
}
