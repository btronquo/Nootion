import { useQueries } from "@tanstack/react-query";
import { intlLocale, t, type TrashedPage } from "@nootion/shared";
import { workspaceName } from "../lib/labels";
import { RotateCcw, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useRefreshPages, useWorkspaces } from "../lib/queries";
import { pageTitle } from "../lib/tree";
import { Button } from "../components/ui";
import { pageIcon } from "../lib/icons";

const dateFmt = () => new Intl.DateTimeFormat(intlLocale(), { dateStyle: "medium", timeStyle: "short" });

export function TrashPage() {
  const workspaces = useWorkspaces();
  const refresh = useRefreshPages();
  const trash = useQueries({
    queries: (workspaces.data ?? []).map((ws) => ({
      queryKey: ["trash", ws.id],
      queryFn: async () => (await api<{ pages: TrashedPage[] }>(`/workspaces/${ws.id}/trash`)).pages,
    })),
  });

  async function restore(id: string) {
    await api(`/pages/${id}/restore`, { method: "POST" });
    await refresh();
  }
  async function destroy(p: TrashedPage) {
    if (!confirm(t("trash.confirmDelete", { title: pageTitle(p.title) }))) return;
    await api(`/pages/${p.id}/permanent`, { method: "DELETE" });
    await refresh();
  }

  const sections = (workspaces.data ?? []).map((ws, i) => ({ ws, pages: trash[i]?.data ?? [] })).filter((s) => s.pages.length > 0);

  return (
    <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8 sm:py-12">
      <h1 className="mb-6 text-2xl font-bold">{t("trash.title")}</h1>
      {sections.length === 0 && <p className="text-neutral-500">{t("trash.empty")}</p>}
      {sections.map(({ ws, pages }) => (
        <section key={ws.id} className="mb-8">
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-neutral-500">{workspaceName(ws)}</h2>
          <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {pages.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  {pageIcon(p.icon)} {pageTitle(p.title)} <span className="text-neutral-400">· {t("trash.deletedOn", { date: dateFmt().format(new Date(p.deletedAt)) })}</span>
                </span>
                <span className="flex shrink-0 gap-1">
                  <Button variant="ghost" onClick={() => restore(p.id)}>
                    <RotateCcw size={14} /> {t("trash.restore")}
                  </Button>
                  <Button variant="danger" onClick={() => destroy(p)} title={t("trash.deleteForever")}>
                    <Trash2 size={14} />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
