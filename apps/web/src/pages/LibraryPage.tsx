import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Database, FileText, Search } from "lucide-react";
import { intlLocale, t, type LibraryPage as Entry } from "@nootion/shared";
import { api } from "../lib/api";
import { pageIcon } from "../lib/icons";
import { pageTitle } from "../lib/tree";
import { Select } from "../components/ui";

type Sort = "updated" | "created" | "title";

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();
const dateFmt = () => new Intl.DateTimeFormat(intlLocale(), { dateStyle: "medium" });

/** Every page and database the reader can open, to search, sort and filter. */
export function LibraryPage() {
  const all = useQuery({ queryKey: ["library"], queryFn: async () => (await api<{ pages: Entry[] }>("/pages/all")).pages });
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("updated");
  const [kind, setKind] = useState<"all" | "page" | "database">("all");
  const [space, setSpace] = useState<string>("all");

  const spaces = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of all.data ?? []) seen.set(p.workspaceId, p.workspaceName ?? t("workspace.personal"));
    return [...seen];
  }, [all.data]);

  const shown = useMemo(() => {
    const q = fold(query.trim());
    const list = (all.data ?? []).filter(
      (p) => (kind === "all" || p.kind === kind) && (space === "all" || p.workspaceId === space) && (!q || fold(pageTitle(p.title)).includes(q)),
    );
    if (sort === "title") list.sort((a, b) => pageTitle(a.title).localeCompare(pageTitle(b.title), intlLocale()));
    else if (sort === "created") list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    else list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return list;
  }, [all.data, query, sort, kind, space]);

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
      <h1 className="mb-1 text-2xl font-bold">{t("library.title")}</h1>
      <p className="mb-5 text-sm text-neutral-500">{all.data ? t("library.count", { count: all.data.length }) : t("common.loading")}</p>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="flex min-w-48 flex-1 items-center gap-2 rounded-md border border-neutral-300 px-2 focus-within:border-blue-500 dark:border-neutral-700">
          <Search size={15} className="shrink-0 text-neutral-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("library.search")}
            aria-label={t("library.search")}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none"
          />
        </label>
        <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label={t("library.kind")}>
          <option value="all">{t("library.allKinds")}</option>
          <option value="page">{t("library.pages")}</option>
          <option value="database">{t("library.databases")}</option>
        </Select>
        {spaces.length > 1 && (
          <Select value={space} onChange={(e) => setSpace(e.target.value)} aria-label={t("library.space")}>
            <option value="all">{t("library.allSpaces")}</option>
            {spaces.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        )}
        <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={t("library.sort")}>
          <option value="updated">{t("library.sortUpdated")}</option>
          <option value="created">{t("library.sortCreated")}</option>
          <option value="title">{t("library.sortTitle")}</option>
        </Select>
      </div>
      <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
        <table className="w-full text-sm" data-library>
          <thead className="bg-neutral-50 text-left text-xs text-neutral-500 dark:bg-neutral-900">
            <tr>
              <th className="w-[45%] px-3 py-2 font-medium">{t("library.name")}</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">{t("library.where")}</th>
              <th className="hidden px-3 py-2 font-medium sm:table-cell">{t("library.createdBy")}</th>
              <th className="px-3 py-2 text-right font-medium whitespace-nowrap">{sort === "created" ? t("library.created") : t("library.updated")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {shown.map((p) => (
              <tr key={p.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-900/60">
                <td className="max-w-0 px-3 py-1.5">
                  <Link to={`/page/${p.id}`} className="flex min-w-0 items-center gap-2">
                    <span className="w-5 shrink-0 text-center">
                      {pageIcon(p.icon) ??
                        (p.kind === "database" ? (
                          <Database size={15} className="inline text-neutral-400" />
                        ) : (
                          <FileText size={15} className="inline text-neutral-400" />
                        ))}
                    </span>
                    <span className="truncate font-medium">{pageTitle(p.title)}</span>
                  </Link>
                </td>
                <td className="hidden max-w-0 truncate px-3 py-1.5 text-neutral-500 md:table-cell">
                  {[p.workspaceName ?? t("workspace.personal"), ...p.path.map(pageTitle)].join(" / ")}
                </td>
                <td className="hidden truncate px-3 py-1.5 text-neutral-500 sm:table-cell">{p.createdByName ?? "—"}</td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap text-neutral-500 tabular-nums">
                  {dateFmt().format(new Date(sort === "created" ? p.createdAt : p.updatedAt))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {all.data && shown.length === 0 && <p className="px-3 py-4 text-sm text-neutral-500">{t("library.none")}</p>}
      </div>
    </div>
  );
}
