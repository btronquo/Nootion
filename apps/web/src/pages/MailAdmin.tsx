import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { t, type MailSettings } from "@nootion/shared";
import { api } from "../lib/api";
import { Button, Select } from "../components/ui";

const key = ["admin", "mail"];
const input =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-900";

type Security = "tls" | "starttls" | "none";
interface Form {
  provider: "smtp" | "resend";
  from: string;
  host: string;
  port: number;
  security: Security;
  user: string;
  secret: string;
}

const toForm = (s: MailSettings | null): Form => ({
  provider: s?.provider ?? "smtp",
  from: s?.from ?? "",
  host: s?.smtp?.host ?? "",
  port: s?.smtp?.port ?? 587,
  security: s?.smtp?.security ?? "starttls",
  user: s?.smtp?.user ?? "",
  secret: "",
});

/** How the server sends e-mail (reminders, mentions, invitations, password resets). */
export function MailAdmin() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: key, queryFn: async () => (await api<{ settings: MailSettings | null }>("/admin/mail")).settings });
  const s = settings.data ?? null;
  const [form, setForm] = useState<Form>(() => toForm(null));
  const [busy, setBusy] = useState<"save" | "test" | "stop" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (settings.isSuccess) setForm(toForm(settings.data));
  }, [settings.isSuccess, settings.data]);
  const set = (patch: Partial<Form>) => (setForm((f) => ({ ...f, ...patch })), setNotice(null));
  // A secret is kept only for the provider it was given for.
  const keeps = !!s?.hasSecret && s.provider === form.provider;

  async function act(kind: "save" | "test" | "stop") {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      if (kind === "stop") {
        await api("/admin/mail", { method: "DELETE" });
        setForm(toForm(null));
      } else if (kind === "test") {
        const { to } = await api<{ to: string }>("/admin/mail/test", { method: "POST", body: {} });
        setNotice(t("mail.testSent", { to }));
      } else {
        const { provider, from, host, port, security, user, secret } = form;
        const body =
          provider === "smtp"
            ? { provider, from, smtp: { host, port, security, user, ...(secret ? { password: secret } : {}) } }
            : { provider, from, ...(secret ? { resendKey: secret } : {}) };
        await api("/admin/mail", { method: "PUT", body });
        set({ secret: "" });
        setNotice(t("mail.saved"));
      }
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const field = (label: string, control: React.ReactNode, help?: string) => (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {control}
      {help && <span className="mt-1 block text-xs text-neutral-500">{help}</span>}
    </label>
  );

  return (
    <section data-mail-admin>
      <h2 className="mb-1 text-lg font-semibold">{t("mail.title")}</h2>
      <p className="mb-3 text-sm text-neutral-500">{t("mail.help")}</p>
      <p
        className={`mb-4 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs ${s ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"}`}
      >
        {s ? <Check size={12} /> : null} {s ? t("mail.on", { provider: s.provider === "smtp" ? "SMTP" : "Resend" }) : t("mail.off")}
      </p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void act("save");
        }}
      >
        <fieldset className="text-sm">
          <legend className="mb-1 font-medium">{t("mail.provider")}</legend>
          <div className="flex flex-wrap gap-4">
            {(["smtp", "resend"] as const).map((p) => (
              <label key={p} className="flex items-center gap-2">
                <input type="radio" name="mail-provider" checked={form.provider === p} onChange={() => set({ provider: p, secret: "" })} />
                {p === "smtp" ? t("mail.smtp") : "Resend"}
              </label>
            ))}
          </div>
        </fieldset>
        {field(
          t("mail.from"),
          <input className={input} required value={form.from} placeholder="Nootion <nootion@example.com>" onChange={(e) => set({ from: e.target.value })} />,
          t("mail.fromHelp"),
        )}
        {form.provider === "smtp" ? (
          <>
            <div className="grid gap-3 sm:grid-cols-[1fr_7rem_10rem]">
              {field(
                t("mail.host"),
                <input className={input} required value={form.host} placeholder="smtp.example.com" onChange={(e) => set({ host: e.target.value })} />,
              )}
              {field(
                t("mail.port"),
                <input type="number" min={1} max={65535} className={input} value={form.port} onChange={(e) => set({ port: Number(e.target.value) || 587 })} />,
              )}
              {field(
                t("mail.security"),
                <Select
                  className="w-full py-2"
                  value={form.security}
                  onChange={(e) => {
                    const security = e.target.value as Security;
                    // The usual port goes with each choice.
                    set({ security, port: security === "tls" ? 465 : form.port === 465 ? 587 : form.port });
                  }}
                >
                  <option value="starttls">STARTTLS</option>
                  <option value="tls">SSL/TLS</option>
                  <option value="none">{t("mail.securityNone")}</option>
                </Select>,
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {field(t("mail.user"), <input className={input} autoComplete="off" value={form.user} onChange={(e) => set({ user: e.target.value })} />)}
              {field(
                t("mail.password"),
                <input
                  className={input}
                  type="password"
                  autoComplete="new-password"
                  value={form.secret}
                  placeholder={keeps ? t("backup.passwordKept") : ""}
                  onChange={(e) => set({ secret: e.target.value })}
                />,
              )}
            </div>
            <p className="text-xs text-neutral-500">{t("mail.smtpHelp")}</p>
          </>
        ) : (
          field(
            t("mail.resendKey"),
            <input
              className={input}
              type="password"
              autoComplete="new-password"
              required={!keeps}
              value={form.secret}
              placeholder={keeps ? t("backup.passwordKept") : "re_…"}
              onChange={(e) => set({ secret: e.target.value })}
            />,
            t("mail.resendHelp"),
          )
        )}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={!!busy}>
            {t("common.save")}
          </Button>
          {s && (
            <Button type="button" variant="ghost" disabled={!!busy} onClick={() => void act("test")} data-mail-test>
              {busy === "test" ? t("mail.testing") : t("mail.test")}
            </Button>
          )}
          {notice && <span className="text-sm text-neutral-500">{notice}</span>}
          {s && (
            <Button type="button" variant="danger" className="ml-auto" disabled={!!busy} onClick={() => void act("stop")}>
              {t("mail.stop")}
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}
