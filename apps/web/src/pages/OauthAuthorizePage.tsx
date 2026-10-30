import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { t } from "@nootion/shared";
import { api } from "../lib/api";
import { useWorkspaces } from "../lib/queries";
import { workspaceName } from "../lib/labels";
import { AuthCard, Button, ErrorText } from "../components/ui";

/** Sends the user back to the app with an OAuth error. */
function sendBack(redirectUri: string, error: string, state: string | null) {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  if (state) url.searchParams.set("state", state);
  window.location.assign(url.toString());
}

/**
 * Where an app connecting with OAuth (such as a Claude connector) sends the user: they choose the spaces it may reach
 * and whether it may write, then go back to the app with a code.
 */
export function OauthAuthorizePage() {
  const [params] = useSearchParams();
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const challenge = params.get("code_challenge") ?? "";
  const state = params.get("state");
  const valid = params.get("response_type") === "code" && params.get("code_challenge_method") === "S256" && challenge.length >= 43;
  const client = useQuery({
    queryKey: ["oauth-client", clientId, redirectUri],
    queryFn: () =>
      api<{ name: string; redirectHost: string }>(`/oauth/clients/${encodeURIComponent(clientId)}?redirect_uri=${encodeURIComponent(redirectUri)}`),
    enabled: !!clientId && !!redirectUri,
    retry: false,
  });
  const workspaces = useWorkspaces();
  const [spaces, setSpaces] = useState<string[] | null>(null);
  const [readOnly, setReadOnly] = useState(!(params.get("scope") ?? "").split(" ").includes("write"));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  // Every space is offered at first.
  useEffect(() => {
    if (workspaces.data && spaces === null) setSpaces(workspaces.data.map((w) => w.id));
  }, [workspaces.data, spaces]);
  // A known app with a bad request is told so: its address being registered, it may be sent back.
  const known = !!client.data;
  useEffect(() => {
    if (known && !valid) sendBack(redirectUri, "invalid_request", state);
  }, [known, valid, redirectUri, state]);

  if (client.isLoading) return <AuthCard title="Nootion">{t("common.loading")}</AuthCard>;
  if (!client.data) {
    return (
      <AuthCard title="Nootion">
        <p className="text-sm text-neutral-600 dark:text-neutral-400" data-oauth-invalid>
          {t("oauth.invalid")}
        </p>
      </AuthCard>
    );
  }
  if (!valid) return null;

  async function allow(e: FormEvent) {
    e.preventDefault();
    if (!spaces?.length) return setError(new Error(t("tokens.pickSpace")));
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ redirectUrl: string }>("/oauth/authorize", {
        method: "POST",
        body: { clientId, redirectUri, codeChallenge: challenge, ...(state ? { state } : {}), workspaceIds: spaces, readOnly },
      });
      window.location.assign(res.redirectUrl);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const name = client.data.name;
  return (
    <AuthCard title={t("oauth.title", { name })} subtitle={t("oauth.subtitle", { name })}>
      <form onSubmit={allow} className="space-y-4" data-oauth-form>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">{t("tokens.spaces")}</legend>
          {(workspaces.data ?? []).map((w) => (
            <label key={w.id} className="flex items-center gap-2 py-0.5 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-blue-600"
                checked={spaces?.includes(w.id) ?? false}
                onChange={(e) => setSpaces((s) => (e.target.checked ? [...(s ?? []), w.id] : (s ?? []).filter((x) => x !== w.id)))}
              />
              {workspaceName(w)}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">{t("tokens.access")}</legend>
          {[true, false].map((ro) => (
            <label key={String(ro)} className="flex items-center gap-2 py-0.5 text-sm">
              <input type="radio" name="access" className="h-4 w-4 accent-blue-600" checked={readOnly === ro} onChange={() => setReadOnly(ro)} />
              {ro ? t("tokens.readOnly") : t("tokens.readWrite")}
            </label>
          ))}
        </fieldset>
        <p className="text-xs text-neutral-500">{t("oauth.redirect", { host: client.data.redirectHost })}</p>
        <ErrorText error={error} />
        <div className="flex gap-2">
          <Button type="submit" disabled={busy} className="flex-1">
            {t("oauth.allow")}
          </Button>
          <Button type="button" variant="ghost" onClick={() => sendBack(redirectUri, "access_denied", state)}>
            {t("oauth.deny")}
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}
