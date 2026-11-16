import { useQuery } from "@tanstack/react-query";
import { t } from "@nootion/shared";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { Rich } from "../components/ui";
import { PagePage } from "./PagePage";
import { MenuButton } from "../components/SidebarLayout";
import { Link } from "react-router-dom";
import { Database, FileText } from "lucide-react";
import { useSharedPages } from "../lib/queries";
import { pageIcon } from "../lib/icons";
import { pageTitle } from "../lib/tree";

/** The user's home page: an ordinary page of widgets, created on first visit. Offline, a plain welcome. */
export function HomePage() {
  const home = useQuery({ queryKey: ["home"], queryFn: async () => (await api<{ pageId: string }>("/home")).pageId, staleTime: Infinity, retry: 1 });
  if (home.isLoading) return null;
  if (home.data) return <PagePage id={home.data} />;
  return <Welcome />;
}

function Welcome() {
  const { user } = useSession();
  return (
    <>
      <header className="px-3 py-1.5 md:hidden">
        <MenuButton />
      </header>
      <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8 sm:py-16">
        <h1 className="text-3xl font-bold">{t("home.hello", { name: user?.name ?? "" })} 👋</h1>
        <p className="mt-3 text-neutral-500">
          <Rich text={t("home.intro")} />
        </p>
      </div>
    </>
  );
}

/** A guest's home: the pages shared with them, since they have nothing else. */
export function GuestHomePage() {
  const { user } = useSession();
  const shared = useSharedPages();
  const roots = shared.data?.filter((p) => p.shared) ?? [];
  return (
    <>
      <header className="px-3 py-1.5 md:hidden">
        <MenuButton />
      </header>
      <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8 sm:py-16" data-guest-home>
        <h1 className="text-3xl font-bold">{t("home.hello", { name: user?.name ?? "" })} 👋</h1>
        <p className="mt-3 text-neutral-500">{t("guest.homeIntro")}</p>
        {shared.isSuccess && !roots.length && <p className="mt-8 text-sm text-neutral-500">{t("guest.homeEmpty")}</p>}
        <ul className="mt-8 grid gap-3 sm:grid-cols-2">
          {roots.map((p) => (
            <li key={p.id}>
              <Link
                to={`/page/${p.id}`}
                className="flex items-center gap-3 rounded-lg border border-neutral-200 px-4 py-3 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
              >
                <span className="w-6 shrink-0 text-center text-lg">
                  {pageIcon(p.icon) ??
                    (p.kind === "database" ? <Database size={18} className="inline text-neutral-400" /> : <FileText size={18} className="inline text-neutral-400" />)}
                </span>
                <span className="truncate font-medium">{pageTitle(p.title)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
