import { t } from "@nootion/shared";
import { useSession } from "../lib/session";
import { Rich } from "../components/ui";

export function HomePage() {
  const { user } = useSession();
  return (
    <div className="mx-auto max-w-3xl px-8 py-16">
      <h1 className="text-3xl font-bold">{t("home.hello", { name: user?.name ?? "" })} 👋</h1>
      <p className="mt-3 text-neutral-500">
        <Rich text={t("home.intro")} />
      </p>
    </div>
  );
}
