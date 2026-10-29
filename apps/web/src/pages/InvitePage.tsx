import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { currentLocale, t, type Locale } from "@nootion/shared";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { AuthCard, Button, ErrorText, Field, LanguageSelect } from "../components/ui";
import { setLocale } from "../lib/i18n";

export function InvitePage() {
  const { token = "" } = useParams();
  const { refresh } = useSession();
  const navigate = useNavigate();
  const invitation = useQuery({ queryKey: ["invitation", token], queryFn: () => api<{ email: string | null }>(`/invitations/${token}`) });
  const [form, setForm] = useState({ name: "", email: "", password: "", locale: currentLocale() });
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
      <AuthCard title={t("invite.invalidTitle")} subtitle={t("invite.invalidText")}>
        <Button className="w-full" onClick={() => navigate("/login")}>
          {t("invite.goToLogin")}
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t("invite.title")} subtitle={t("invite.subtitle")}>
      <form onSubmit={submit} className="space-y-4">
        <LanguageSelect value={form.locale} onChange={(locale: Locale) => (setLocale(locale), setForm({ ...form, locale }))} />
        <Field label={t("auth.name")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
        <Field label={t("auth.email")} type="email" value={form.email} readOnly={!!invitation.data?.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <Field label={t("auth.newPassword")} type="password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required autoComplete="new-password" />
        <ErrorText error={error} />
        <Button type="submit" disabled={busy} className="w-full">
          {t("invite.submit")}
        </Button>
      </form>
    </AuthCard>
  );
}
