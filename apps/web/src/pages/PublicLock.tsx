import { useState } from "react";
import { t } from "@nootion/shared";
import { api, ApiError } from "../lib/api";
import { AuthCard, Button, ErrorText, Field } from "../components/ui";

/** Why a public link or form can't be shown yet, from the error its first request got; null for any other error. */
export function lockOf(error: unknown): "password_required" | "link_expired" | null {
  return error instanceof ApiError && (error.code === "password_required" || error.code === "link_expired") ? error.code : null;
}

/**
 * What a visitor sees before a protected link opens: a small password page, or "This link has expired". `unlockPath`
 * is the API address that takes the password (`/public/<token>/unlock` or `/forms/<token>/unlock`).
 */
export function PublicLock({ lock, unlockPath, onUnlocked }: { lock: "password_required" | "link_expired"; unlockPath: string; onUnlocked: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (lock === "link_expired") {
    return (
      <AuthCard title={t("public.expired")}>
        <p className="text-center text-sm text-neutral-600 dark:text-neutral-400" data-link-expired>
          {t("public.expiredHelp")}
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t("public.passwordTitle")} subtitle={t("public.passwordHelp")}>
      <form
        className="space-y-4"
        data-link-password
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api(unlockPath, { method: "POST", body: { password } });
            onUnlocked();
          } catch (err) {
            setError(err);
            setBusy(false);
          }
        }}
      >
        <Field
          label={t("public.passwordLabel")}
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <ErrorText error={error} />
        <Button type="submit" className="w-full" disabled={busy || !password}>
          {t("public.unlock")}
        </Button>
      </form>
    </AuthCard>
  );
}
