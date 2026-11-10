import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { t, type SsoSettings, type SsoSignup } from "@nootion/shared";
import { api } from "../lib/api";
import { copyText } from "../lib/browser";
import { Button, Select } from "../components/ui";

const key = ["admin", "sso"];
const input =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-900";

interface Form {
  label: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  signup: SsoSignup;
  domains: string;
  passwordLogin: boolean;
  linkByEmail: boolean;
  sessionHours: number;
}

const toForm = (s: SsoSettings | null): Form => ({
  label: s?.label ?? "Microsoft",
  issuer: s?.issuer ?? "",
  clientId: s?.clientId ?? "",
  clientSecret: "",
  signup: s?.signup ?? "invited",
  domains: s?.domains.join(", ") ?? "",
  passwordLogin: s?.passwordLogin ?? true,
  linkByEmail: s?.linkByEmail ?? true,
  sessionHours: s?.sessionHours ?? 12,
});

/** A value to copy into the provider's settings. */
function CopyRow({
  label,
  value,
  help,
}: {
  label: string;
  value: string;
  help?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      <div className="flex items-center gap-2 rounded-md bg-neutral-100 px-3 py-1.5 dark:bg-neutral-800">
        <code className="flex-1 break-all text-xs">{value}</code>
        <Button
          type="button"
          variant="ghost"
          title={t("common.copy")}
          onClick={() =>
            void copyText(value).then(
              (ok) =>
                ok &&
                (setCopied(true), setTimeout(() => setCopied(false), 1500)),
            )
          }
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </Button>
      </div>
      {help && (
        <span className="mt-1 block text-xs text-neutral-500">{help}</span>
      )}
    </div>
  );
}

/** Single sign-on (OpenID Connect) and SCIM, for Microsoft Entra ID, Google, Keycloak… */
export function SsoAdmin() {
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: key,
    queryFn: async () =>
      (await api<{ settings: SsoSettings | null }>("/admin/sso")).settings,
  });
  const s = settings.data ?? null;
  const [form, setForm] = useState<Form>(() => toForm(null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [scimToken, setScimToken] = useState<string | null>(null);
  useEffect(() => {
    if (settings.isSuccess) setForm(toForm(settings.data));
  }, [settings.isSuccess, settings.data]);
  const set = (patch: Partial<Form>) => (
    setForm((f) => ({ ...f, ...patch })),
    setNotice(null)
  );
  const keeps =
    !!s?.hasSecret &&
    s.issuer === form.issuer.replace(/\/+$/, "") &&
    s.clientId === form.clientId;

  async function act(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (done) setNotice(done);
      await qc.invalidateQueries({ queryKey: key });
      await qc.invalidateQueries({ queryKey: ["setup-status"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    act(async () => {
      const { clientSecret, domains, ...rest } = form;
      await api("/admin/sso", {
        method: "PUT",
        body: {
          ...rest,
          domains: domains
            .split(/[\s,;]+/)
            .map((d) => d.replace(/^@/, "").trim())
            .filter(Boolean),
          ...(clientSecret ? { clientSecret } : {}),
        },
      });
      set({ clientSecret: "" });
    }, t("sso.saved"));

  const field = (label: string, control: React.ReactNode, help?: string) => (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {control}
      {help && (
        <span className="mt-1 block text-xs text-neutral-500">{help}</span>
      )}
    </label>
  );

  return (
    <section data-sso-admin>
      <h2 className="mb-1 text-lg font-semibold">{t("sso.title")}</h2>
      <p className="mb-3 text-sm text-neutral-500">{t("sso.help")}</p>
      <p
        className={`mb-4 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs ${s ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"}`}
      >
        {s ? <Check size={12} /> : null}{" "}
        {s ? t("sso.on", { label: s.label }) : t("sso.offStatus")}
      </p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <CopyRow
          label={t("sso.redirectUri")}
          value={
            s?.redirectUri ?? `${window.location.origin}/api/auth/sso/callback`
          }
          help={t("sso.redirectUriHelp")}
        />
        <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
          {field(
            t("sso.label"),
            <input
              className={input}
              required
              maxLength={60}
              value={form.label}
              onChange={(e) => set({ label: e.target.value })}
            />,
          )}
          {field(
            t("sso.issuer"),
            <input
              className={input}
              required
              type="url"
              value={form.issuer}
              placeholder="https://login.microsoftonline.com/<tenant-id>/v2.0"
              onChange={(e) => set({ issuer: e.target.value })}
            />,
            t("sso.issuerHelp"),
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {field(
            t("sso.clientId"),
            <input
              className={input}
              required
              autoComplete="off"
              value={form.clientId}
              onChange={(e) => set({ clientId: e.target.value })}
            />,
          )}
          {field(
            t("sso.clientSecret"),
            <input
              className={input}
              type="password"
              autoComplete="new-password"
              required={!keeps}
              value={form.clientSecret}
              placeholder={keeps ? t("backup.passwordKept") : ""}
              onChange={(e) => set({ clientSecret: e.target.value })}
            />,
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {field(
            t("sso.signup"),
            <Select
              className="w-full py-2"
              value={form.signup}
              onChange={(e) => set({ signup: e.target.value as SsoSignup })}
            >
              <option value="invited">{t("sso.signupInvited")}</option>
              <option value="domains">{t("sso.signupDomains")}</option>
              <option value="anyone">{t("sso.signupAnyone")}</option>
            </Select>,
            t("sso.signupHelp"),
          )}
          {form.signup === "domains" &&
            field(
              t("sso.domains"),
              <input
                className={input}
                required
                value={form.domains}
                placeholder="example.com, example.fr"
                onChange={(e) => set({ domains: e.target.value })}
              />,
            )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {field(
            t("sso.sessionHours"),
            <input
              type="number"
              min={1}
              max={720}
              className={input}
              value={form.sessionHours}
              onChange={(e) =>
                set({
                  sessionHours: Math.min(
                    720,
                    Math.max(1, Number(e.target.value) || 12),
                  ),
                })
              }
            />,
            t("sso.sessionHoursHelp"),
          )}
          <label className="flex items-start gap-2 pt-6 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.passwordLogin}
              onChange={(e) => set({ passwordLogin: e.target.checked })}
            />
            <span>
              <span className="block font-medium">
                {t("sso.passwordLogin")}
              </span>
              <span className="block text-xs text-neutral-500">
                {t("sso.passwordLoginHelp")}
              </span>
            </span>
          </label>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.linkByEmail}
            onChange={(e) => set({ linkByEmail: e.target.checked })}
          />
          <span>
            <span className="block font-medium">{t("sso.linkByEmail")}</span>
            <span className="block text-xs text-neutral-500">
              {t("sso.linkByEmailHelp")}
            </span>
          </span>
        </label>
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={busy}>
            {t("common.save")}
          </Button>
          {s && (
            <a
              href="/api/auth/sso/start?next=/admin"
              className="rounded-md px-3 py-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
              data-sso-try
            >
              {t("sso.try")}
            </a>
          )}
          {notice && <span className="text-sm text-neutral-500">{notice}</span>}
          {s && (
            <Button
              type="button"
              variant="danger"
              className="ml-auto"
              disabled={busy}
              onClick={() =>
                void act(() => api("/admin/sso", { method: "DELETE" }))
              }
            >
              {t("sso.stop")}
            </Button>
          )}
        </div>
      </form>

      {s && (
        <div
          className="mt-6 space-y-3 border-t border-neutral-200 pt-4 dark:border-neutral-800"
          data-scim
        >
          <h3 className="font-semibold">{t("sso.scimTitle")}</h3>
          <p className="text-sm text-neutral-500">{t("sso.scimHelp")}</p>
          <CopyRow label={t("sso.scimUrl")} value={s.scim.url} />
          {scimToken && (
            <CopyRow
              label={t("sso.scimToken")}
              value={scimToken}
              help={t("sso.scimTokenOnce")}
            />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={s.scim.enabled ? "ghost" : "primary"}
              disabled={busy}
              onClick={() =>
                void act(async () =>
                  setScimToken(
                    (
                      await api<{ token: string }>("/admin/sso/scim-token", {
                        method: "POST",
                        body: {},
                      })
                    ).token,
                  ),
                )
              }
            >
              {s.scim.enabled ? t("sso.scimNewToken") : t("sso.scimTurnOn")}
            </Button>
            {s.scim.enabled && (
              <>
                <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
                  <Check size={12} /> {t("sso.scimOn")}
                </span>
                <Button
                  type="button"
                  variant="danger"
                  className="ml-auto"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      async () => (
                        await api("/admin/sso/scim-token", {
                          method: "DELETE",
                        }),
                        setScimToken(null)
                      ),
                    )
                  }
                >
                  {t("sso.scimTurnOff")}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
