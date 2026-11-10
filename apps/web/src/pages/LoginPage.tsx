import { useState, type FormEvent } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { t, type SsoInfo } from "@nootion/shared";
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
  // "Forgot password" only when the server can send its e-mail.
  const setup = useQuery({
    queryKey: ["setup-status"],
    queryFn: () => api<{ mail?: boolean; sso?: SsoInfo | null }>("/setup"),
  });
  const [params] = useSearchParams();
  const sso = setup.data?.sso;
  const ssoError = params.get("sso_error");
  // With passwords off, the form stays for administrators, behind a link.
  const [showPassword, setShowPassword] = useState(params.has("password"));
  const passwordForm = !sso || sso.passwordLogin || showPassword;

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
      {sso && (
        <div className="mb-4 space-y-3" data-sso-login>
          <a
            href={`/api/auth/sso/start?next=${encodeURIComponent(from && from !== "/login" ? from : "/")}`}
            className="flex w-full items-center justify-center rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            {t("sso.signIn", { label: sso.label })}
          </a>
          {ssoError && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {ssoErrorText(ssoError)}
            </p>
          )}
          {passwordForm && (
            <p className="text-center text-xs text-neutral-500">
              {t("sso.or")}
            </p>
          )}
        </div>
      )}
      {passwordForm && (
        <form onSubmit={submit} className="space-y-4">
          <Field
            label={t("auth.email")}
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
            autoFocus
            autoComplete="username"
          />
          <Field
            label={t("auth.password")}
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
            autoComplete="current-password"
          />
          <ErrorText error={error} />
          <Button type="submit" disabled={busy} className="w-full">
            {t("login.submit")}
          </Button>
        </form>
      )}
      {!passwordForm && (
        <p className="text-center text-sm">
          <button
            type="button"
            className="text-neutral-500 hover:underline"
            onClick={() => setShowPassword(true)}
          >
            {t("sso.adminPassword")}
          </button>
        </p>
      )}
      {setup.data?.mail && passwordForm && (
        <p className="mt-4 text-center text-sm">
          <Link to="/forgot" className="text-neutral-500 hover:underline">
            {t("forgot.link")}
          </Link>
        </p>
      )}
    </AuthCard>
  );
}

function ssoErrorText(code: string): string {
  switch (code) {
    case "no_account":
      return t("sso.errorNoAccount");
    case "disabled":
      return t("error.accountDisabled");
    case "no_email":
      return t("sso.errorNoEmail");
    case "unverified_email":
      return t("sso.errorUnverifiedEmail");
    case "not_linked":
      return t("sso.errorNotLinked");
    case "denied":
      return t("sso.errorDenied");
    case "expired":
      return t("sso.errorExpired");
    default:
      return t("sso.errorFailed");
  }
}
