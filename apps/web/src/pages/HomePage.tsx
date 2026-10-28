import { useSession } from "../lib/session";

export function HomePage() {
  const { user } = useSession();
  return (
    <div className="mx-auto max-w-3xl px-8 py-16">
      <h1 className="text-3xl font-bold">Bonjour {user?.name} 👋</h1>
      <p className="mt-3 text-neutral-500">
        Créez une page avec le <strong>+</strong> à côté de votre espace dans la barre latérale. Glissez-déposez les pages pour les réorganiser,
        et partagez-les avec le bouton <strong>Partager</strong>.
      </p>
    </div>
  );
}
