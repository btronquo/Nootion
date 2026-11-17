import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Cloud, Fingerprint, Pencil, Trash2 } from "lucide-react";
import { browserSupportsWebAuthn, startRegistration, WebAuthnError } from "@simplewebauthn/browser";
import { intlLocale, t, type PasskeyInfo, type PasskeysStatus } from "@nootion/shared";
import { api } from "../lib/api";
import { Button, ErrorText, Field } from "./ui";

const day = (iso: string) => new Date(iso).toLocaleDateString(intlLocale(), { dateStyle: "medium" });

/** The browser's own errors (the person closed the dialog, no device…) in words people understand. */
export function passkeyError(err: unknown): unknown {
  const name = err instanceof WebAuthnError ? (err.cause as Error | undefined)?.name : err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "AbortError") return new Error(t("passkeys.cancelled"));
  if (name === "InvalidStateError") return new Error(t("passkeys.exists"));
  if (name === "SecurityError") return new Error(t("passkeys.unavailable"));
  return err;
}

/** Why passkeys can't be used from this page, or null when they can. */
export function passkeysBlocked(origin: string | null | undefined): string | null {
  if (!origin) return t("passkeys.unavailable");
  if (origin !== window.location.origin) return t("passkeys.unavailableHere", { origin });
  if (!browserSupportsWebAuthn()) return t("passkeys.unsupported");
  return null;
}

/** "My account → Passkeys": add one (after the password), list them with their last use, rename, remove. */
export function PasskeysPanel() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["passkeys"], queryFn: () => api<PasskeysStatus>("/auth/passkeys") });
  const [adding, setAdding] = useState(false);
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["passkeys"] });

  if (!status.data) return null;
  const blocked = passkeysBlocked(status.data.available ? status.data.origin : null);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { options } = await api<{ options: Parameters<typeof startRegistration>[0]["optionsJSON"] }>("/auth/passkeys/options", {
        method: "POST",
        body: { password },
      });
      const response = await startRegistration({ optionsJSON: options });
      await api("/auth/passkeys", { method: "POST", body: { name: name.trim() || undefined, response } });
      setAdding(false);
      setPassword("");
      setName("");
      await refresh();
    } catch (err) {
      setError(passkeyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3" data-passkeys>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">{t("passkeys.intro")}</p>
      {status.data.passkeys.length > 0 ? (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {status.data.passkeys.map((p) => (
            <PasskeyRow key={p.id} passkey={p} onChange={refresh} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-neutral-500">{t("passkeys.empty")}</p>
      )}
      {blocked ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200" data-passkeys-blocked>
          {blocked}
        </p>
      ) : adding ? (
        <form className="space-y-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800" onSubmit={add} data-passkey-add>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">{t("passkeys.addHelp")}</p>
          <Field
            label={t("passkeys.name")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("passkeys.namePlaceholder")}
            maxLength={100}
          />
          <Field
            label={t("account.currentPassword")}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
            autoComplete="current-password"
          />
          <ErrorText error={error} />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !password}>
              <Fingerprint size={14} /> {t("passkeys.add")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setError(null);
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="ghost" onClick={() => setAdding(true)} className="border border-neutral-200 dark:border-neutral-700">
          <Fingerprint size={14} /> {t("passkeys.add")}
        </Button>
      )}
    </div>
  );
}

function PasskeyRow({ passkey, onChange }: { passkey: PasskeyInfo; onChange: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(passkey.name);
  const [error, setError] = useState<unknown>(null);

  async function rename(e: FormEvent) {
    e.preventDefault();
    try {
      await api(`/auth/passkeys/${passkey.id}`, { method: "PATCH", body: { name } });
      setEditing(false);
      await onChange();
    } catch (err) {
      setError(err);
    }
  }
  async function remove() {
    if (!confirm(t("passkeys.deleteConfirm", { name: passkey.name }))) return;
    try {
      await api(`/auth/passkeys/${passkey.id}`, { method: "DELETE" });
      await onChange();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <li className="flex items-start gap-3 px-3 py-2 text-sm" data-passkey={passkey.id}>
      <Fingerprint size={16} className="mt-0.5 shrink-0 text-neutral-400" />
      <div className="min-w-0 flex-1">
        {editing ? (
          <form onSubmit={rename} className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
              aria-label={t("passkeys.name")}
              maxLength={100}
              autoFocus
              className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-800"
            />
            <Button type="submit" disabled={!name.trim()} className="py-1">
              {t("common.save")}
            </Button>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5 font-medium">
            <span className="break-words">{passkey.name}</span>
            {passkey.backedUp && (
              <span
                className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-xs font-normal text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                title={t("passkeys.backedUpHelp")}
              >
                <Cloud size={11} /> {t("passkeys.backedUp")}
              </span>
            )}
          </div>
        )}
        <div className="text-xs text-neutral-500">
          {t("passkeys.createdOn", { date: day(passkey.createdAt) })} ·{" "}
          {passkey.lastUsedAt ? t("passkeys.lastUsed", { date: day(passkey.lastUsedAt) }) : t("passkeys.neverUsed")}
        </div>
        <ErrorText error={error} />
      </div>
      {!editing && (
        <div className="flex shrink-0">
          <Button
            variant="ghost"
            onClick={() => {
              setName(passkey.name);
              setEditing(true);
            }}
            title={t("passkeys.rename")}
            aria-label={t("passkeys.rename")}
          >
            <Pencil size={14} />
          </Button>
          <Button variant="danger" onClick={() => void remove()} title={t("passkeys.delete")} aria-label={t("passkeys.delete")}>
            <Trash2 size={14} />
          </Button>
        </div>
      )}
    </li>
  );
}
