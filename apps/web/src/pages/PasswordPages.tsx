import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { t } from "@nootion/shared";
import { api } from "../lib/api";
import { AuthCard, Button, ErrorText, Field } from "../components/ui";

/** "Forgot password": asks for the address, the link goes by e-mail. */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/forgot", { method: "POST", body: { email } });
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t("forgot.title")} subtitle={sent ? undefined : t("forgot.subtitle")}>
      {sent ? (
        <p className="text-center text-sm text-neutral-600 dark:text-neutral-300" data-forgot-sent>
          {t("forgot.sent", { email })}
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label={t("auth.email")} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus autoComplete="username" />
          <ErrorText error={error} />
          <Button type="submit" disabled={busy} className="w-full">
            {t("forgot.submit")}
          </Button>
        </form>
      )}
      <p className="mt-4 text-center text-sm">
        <Link to="/login" className="text-neutral-500 hover:underline">
          {t("forgot.back")}
        </Link>
      </p>
    </AuthCard>
  );
}

/** The page the e-mailed link opens: a new password, then sign in. */
export function ResetPasswordPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const check = useQuery({ queryKey: ["reset", token], retry: false, queryFn: () => api<{ email: string }>(`/auth/reset/${token}`) });
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/reset", { method: "POST", body: { token, password } });
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t("reset.title")} subtitle={check.data?.email}>
      {check.isError ? (
        <div className="space-y-4 text-center text-sm">
          <ErrorText error={check.error} />
          <Link to="/forgot" className="text-blue-600 hover:underline dark:text-blue-400">
            {t("reset.again")}
          </Link>
        </div>
      ) : done ? (
        <div className="space-y-4 text-center text-sm">
          <p>{t("reset.done")}</p>
          <Button className="w-full" onClick={() => navigate("/login", { replace: true })}>
            {t("login.submit")}
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <input type="email" value={check.data?.email ?? ""} autoComplete="username" readOnly hidden />
          <Field
            label={t("reset.password")}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoFocus
            autoComplete="new-password"
          />
          <ErrorText error={error} />
          <Button type="submit" disabled={busy || !check.data} className="w-full">
            {t("reset.submit")}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
