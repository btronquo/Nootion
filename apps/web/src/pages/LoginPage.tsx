import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { t } from "@nootion/shared";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { AuthCard, Button, ErrorText, Field } from "../components/ui";

export function LoginPage() {
  const { refresh } = useSession();
  const navigate = useNavigate();
  // After signing in, go back to the page that was asked for (e.g. a shared page link).
  const from = (useLocation().state as { from?: string } | null)?.from;
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/login", { method: "POST", body: form });
      await refresh();
      navigate(from && from !== "/login" ? from : "/", { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t("login.title")}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t("auth.email")} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required autoFocus autoComplete="username" />
        <Field label={t("auth.password")} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required autoComplete="current-password" />
        <ErrorText error={error} />
        <Button type="submit" disabled={busy} className="w-full">
          {t("login.submit")}
        </Button>
      </form>
    </AuthCard>
  );
}
