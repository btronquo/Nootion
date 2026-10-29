import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { currentLocale, t, type Locale } from "@nootion/shared";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { AuthCard, Button, ErrorText, Field, LanguageSelect } from "../components/ui";
import { setLocale } from "../lib/i18n";

export function SetupPage() {
  const { refresh } = useSession();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "", locale: currentLocale() });
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
    <AuthCard title={t("setup.title")} subtitle={t("setup.subtitle")}>
      <form onSubmit={submit} className="space-y-4">
        <LanguageSelect value={form.locale} onChange={(locale: Locale) => (setLocale(locale), setForm({ ...form, locale }))} />
        <Field label={t("auth.name")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
        <Field label={t("auth.email")} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <Field label={t("auth.newPassword")} type="password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required autoComplete="new-password" />
        <ErrorText error={error} />
        <Button type="submit" disabled={busy} className="w-full">
          {t("setup.submit")}
        </Button>
      </form>
    </AuthCard>
  );
}
