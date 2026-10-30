import { useQuery } from "@tanstack/react-query";
import { t } from "@nootion/shared";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { Rich } from "../components/ui";
import { PagePage } from "./PagePage";
import { MenuButton } from "../components/SidebarLayout";

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
