import { useSession } from "../lib/session";

export function HomePage() {
  const { user } = useSession();
  return (
    <div className="mx-auto max-w-3xl px-8 py-16">
      <h1 className="text-3xl font-bold">Bonjour {user?.name} 👋</h1>
      <p className="mt-3 text-neutral-500">
        Nootion est installé. Les pages, l'éditeur et les databases arrivent dans les prochaines étapes.
      </p>
    </div>
  );
}
