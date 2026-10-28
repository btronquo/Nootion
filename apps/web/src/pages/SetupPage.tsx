import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { AuthCard, Button, ErrorText, Field } from "../components/ui";

export function SetupPage() {
  const { refresh } = useSession();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/setup", { method: "POST", body: form });
      await refresh();
      navigate("/", { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Bienvenue sur Nootion" subtitle="Créez le compte administrateur de cette instance.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nom" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
        <Field label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <Field label="Mot de passe (8 caractères min.)" type="password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required autoComplete="new-password" />
        <ErrorText error={error} />
        <Button type="submit" disabled={busy} className="w-full">
          Créer le compte
        </Button>
      </form>
    </AuthCard>
  );
}
