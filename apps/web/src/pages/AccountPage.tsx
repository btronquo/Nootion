import { useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Monitor, Moon, Sun } from "lucide-react";
import { AVATAR_MAX_BYTES, type PublicUser } from "@nootion/shared";
import { api, ApiError } from "../lib/api";
import { useSession } from "../lib/session";
import { getTheme, setTheme, type ThemeChoice } from "../lib/theme";
import { pickFiles } from "../editor/upload";
import { Avatar } from "../components/Avatar";
import { Button, ErrorText, Field } from "../components/ui";

export function AccountPage() {
  const { user } = useSession();
  if (!user) return null;
  return (
    <div className="mx-auto max-w-2xl space-y-10 px-8 py-12">
      <h1 className="text-2xl font-bold">Mon compte</h1>
      <ProfileSection user={user} />
      <EmailSection user={user} />
      <PasswordSection />
      <ThemeSection />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 border-b border-neutral-200 pb-2 text-lg font-semibold dark:border-neutral-800">{title}</h2>
      {children}
    </section>
  );
}

/** Puts the updated user in the session cache. */
function useSetMe() {
  const qc = useQueryClient();
  return (user: PublicUser) => {
    qc.setQueryData(["me"], user);
    // Names and pictures also appear in the people directory.
    void qc.invalidateQueries({ queryKey: ["users"] });
  };
}

function Saved({ show }: { show: boolean }) {
  return show ? <span className="text-sm text-green-600 dark:text-green-400">Enregistré</span> : null;
}

function ProfileSection({ user }: { user: PublicUser }) {
  const setMe = useSetMe();
  const [name, setName] = useState(user.name);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setMe((await api<{ user: PublicUser }>("/auth/me", { method: "PATCH", body: { name } })).user);
      setSaved(true);
    } catch (err) {
      setError(err);
    }
  }

  async function upload() {
    const [file] = await pickFiles("image/png,image/jpeg,image/webp,image/gif");
    if (!file) return;
    setError(null);
    if (file.size > AVATAR_MAX_BYTES) return setError(new Error("Image trop volumineuse (max 2 Mo)."));
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/auth/me/avatar", { method: "POST", body: form, credentials: "same-origin" });
      const data = await res.json();
      if (!res.ok) throw new ApiError(res.status, data.error, data.message);
      setMe(data.user);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function removeAvatar() {
    setMe((await api<{ user: PublicUser }>("/auth/me/avatar", { method: "DELETE" })).user);
  }

  return (
    <Section title="Profil">
      <div className="mb-4 flex items-center gap-4">
        <Avatar name={user.name} url={user.avatarUrl} size={64} />
        <div className="flex gap-2">
          <Button variant="ghost" onClick={upload} disabled={busy}>
            {busy ? "Envoi…" : user.avatarUrl ? "Changer la photo" : "Ajouter une photo"}
          </Button>
          {user.avatarUrl && (
            <Button variant="danger" onClick={removeAvatar}>
              Retirer
            </Button>
          )}
        </div>
      </div>
      <form onSubmit={save} className="space-y-3">
        <Field
          label="Prénom ou nom affiché"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          required
          maxLength={100}
        />
        <ErrorText error={error} />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={!name.trim() || name.trim() === user.name}>
            Enregistrer
          </Button>
          <Saved show={saved} />
        </div>
      </form>
    </Section>
  );
}

function EmailSection({ user }: { user: PublicUser }) {
  const setMe = useSetMe();
  const [email, setEmail] = useState(user.email);
  const [currentPassword, setCurrentPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setMe((await api<{ user: PublicUser }>("/auth/me", { method: "PATCH", body: { email, currentPassword } })).user);
      setCurrentPassword("");
      setSaved(true);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Section title="Email">
      <form onSubmit={save} className="space-y-3">
        <Field label="Adresse email" type="email" value={email} onChange={(e) => (setEmail(e.target.value), setSaved(false))} required autoComplete="email" />
        {email.trim().toLowerCase() !== user.email && (
          <Field label="Mot de passe actuel" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required autoComplete="current-password" />
        )}
        <ErrorText error={error} />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={email.trim().toLowerCase() === user.email}>
            Changer l'email
          </Button>
          <Saved show={saved} />
        </div>
      </form>
    </Section>
  );
}

function PasswordSection() {
  const setMe = useSetMe();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) return setError(new Error("Les deux mots de passe ne correspondent pas."));
    try {
      setMe((await api<{ user: PublicUser }>("/auth/me", { method: "PATCH", body: { currentPassword, newPassword } })).user);
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      setSaved(true);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Section title="Mot de passe">
      <form onSubmit={save} className="space-y-3">
        <Field label="Mot de passe actuel" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required autoComplete="current-password" />
        <Field label="Nouveau mot de passe" type="password" value={newPassword} onChange={(e) => (setNewPassword(e.target.value), setSaved(false))} required minLength={8} autoComplete="new-password" />
        <Field label="Confirmer le nouveau mot de passe" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} autoComplete="new-password" />
        <p className="text-xs text-neutral-500">Les autres appareils connectés à ce compte seront déconnectés.</p>
        <ErrorText error={error} />
        <div className="flex items-center gap-3">
          <Button type="submit">Changer le mot de passe</Button>
          <Saved show={saved} />
        </div>
      </form>
    </Section>
  );
}

const THEMES: { value: ThemeChoice; label: string; icon: ReactNode }[] = [
  { value: "light", label: "Clair", icon: <Sun size={18} /> },
  { value: "dark", label: "Sombre", icon: <Moon size={18} /> },
  { value: "system", label: "Système", icon: <Monitor size={18} /> },
];

function ThemeSection() {
  const [theme, setChoice] = useState(getTheme());
  return (
    <Section title="Apparence">
      <div role="radiogroup" aria-label="Thème" className="grid grid-cols-3 gap-2">
        {THEMES.map((t) => (
          <button
            key={t.value}
            role="radio"
            aria-checked={theme === t.value}
            onClick={() => {
              setTheme(t.value);
              setChoice(t.value);
            }}
            className={`flex flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-sm ${theme === t.value ? "border-blue-500 ring-2 ring-blue-500/30" : "border-neutral-200 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/60"}`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-neutral-500">« Système » suit le réglage de ton ordinateur. Le choix est mémorisé sur cet appareil.</p>
    </Section>
  );
}
