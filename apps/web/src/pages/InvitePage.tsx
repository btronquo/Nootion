import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { AuthCard, Button, ErrorText, Field } from "../components/ui";

export function InvitePage() {
  const { token = "" } = useParams();
  const { refresh } = useSession();
  const navigate = useNavigate();
  const invitation = useQuery({ queryKey: ["invitation", token], queryFn: () => api<{ email: string | null }>(`/invitations/${token}`) });
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (invitation.data?.email) setForm((f) => ({ ...f, email: invitation.data.email ?? "" }));
  }, [invitation.data]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/invitations/${token}/accept`, { method: "POST", body: form });
      await refresh();
      navigate("/", { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (invitation.isLoading) return null;
  if (invitation.isError) {
    return (
      <AuthCard title="Invitation invalide" subtitle="Ce lien a expiré ou a déjà été utilisé. Demandez-en un nouveau à l'administrateur.">
        <Button className="w-full" onClick={() => navigate("/login")}>
          Aller à la connexion
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Rejoindre Nootion" subtitle="Vous avez été invité. Créez votre compte.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nom" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
        <Field label="Email" type="email" value={form.email} readOnly={!!invitation.data?.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <Field label="Mot de passe (8 caractères min.)" type="password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required autoComplete="new-password" />
        <ErrorText error={error} />
        <Button type="submit" disabled={busy} className="w-full">
          Créer mon compte
        </Button>
      </form>
    </AuthCard>
  );
}
