import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Monitor, Moon, Settings, Sun } from "lucide-react";
import {
  AVATAR_MAX_BYTES,
  EMAIL_KINDS,
  t,
  type EmailKind,
  type EmailPrefs,
  type Locale,
  type PublicUser,
  type TwoFactorSetup,
  type TwoFactorStatus,
} from "@nootion/shared";
import { api, ApiError } from "../lib/api";
import { useSession } from "../lib/session";
import { getTheme, setTheme, type ThemeChoice } from "../lib/theme";
import { pickFiles } from "../editor/upload";
import { Avatar } from "../components/Avatar";
import { Button, ErrorText, Field, LanguageSelect, Rich, Select } from "../components/ui";
import { setLocale } from "../lib/i18n";
import { NotionImport } from "../components/NotionImport";
import { AgentActivityList, ApiTokens, McpConnect } from "../components/ApiTokens";
import { ConnectedServices, useConnectedServices } from "../components/ConnectedServices";
import { clearOfflineData } from "../lib/offline";
import { useRefreshPages, useWorkspaces } from "../lib/queries";
import { workspaceName } from "../lib/labels";

export function AccountPage() {
  const { user } = useSession();
  const { hash } = useLocation();
  const services = useConnectedServices();
  // Links to a section (#import) open the page there.
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);
  if (!user) return null;
  return (
    <div className="mx-auto max-w-2xl space-y-10 px-5 py-8 sm:px-8 sm:py-12">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t("account.title")}</h1>
        {/* Also reachable from here, should the sidebar's footer be out of reach. */}
        {user.role === "admin" && (
          <Link
            to="/admin"
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            <Settings size={16} /> {t("admin.title")}
          </Link>
        )}
      </div>
      <ProfileSection user={user} />
      <EmailSection user={user} />
      <PasswordSection />
      <TwoFactorSection />
      <LanguageSection user={user} />
      <ThemeSection />
      <EmailPrefsSection />
      <ImportSection />
      <DemoSection />
      {!!services.data?.length && (
        <Section title={t("services.title")} id="services">
          <ConnectedServices accounts={services.data} />
        </Section>
      )}
      <Section title={t("mcp.title")} id="mcp">
        <McpConnect />
      </Section>
      <Section title={t("tokens.title")} id="api">
        <div className="space-y-6">
          <ApiTokens />
          <AgentActivityList />
        </div>
      </Section>
      <DeleteSection />
    </div>
  );
}

function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-16">
      <h2 className="mb-3 border-b border-neutral-200 pb-2 text-lg font-semibold dark:border-neutral-800">{title}</h2>
      {children}
    </section>
  );
}

/** Puts the updated user in the session cache. */
function useSetMe() {
  const qc = useQueryClient();
  return (user: PublicUser) => {
    qc.setQueryData(["me"], user);
    // Names and pictures also appear in the people directory.
    void qc.invalidateQueries({ queryKey: ["users"] });
  };
}

function Saved({ show }: { show: boolean }) {
  return show ? <span className="text-sm text-green-600 dark:text-green-400">{t("common.saved")}</span> : null;
}

function ProfileSection({ user }: { user: PublicUser }) {
  const setMe = useSetMe();
  const [name, setName] = useState(user.name);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setMe((await api<{ user: PublicUser }>("/auth/me", { method: "PATCH", body: { name } })).user);
      setSaved(true);
    } catch (err) {
      setError(err);
    }
  }

  async function upload() {
    const [file] = await pickFiles("image/png,image/jpeg,image/webp,image/gif");
    if (!file) return;
    setError(null);
    if (file.size > AVATAR_MAX_BYTES) return setError(new Error(t("error.imageTooLarge")));
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/auth/me/avatar", { method: "POST", body: form, credentials: "same-origin" });
      const data = await res.json();
      if (!res.ok) throw new ApiError(res.status, data.error, data.message);
      setMe(data.user);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function removeAvatar() {
    setMe((await api<{ user: PublicUser }>("/auth/me/avatar", { method: "DELETE" })).user);
  }

  return (
    <Section title={t("account.profile")}>
      <div className="mb-4 flex items-center gap-4">
        <Avatar name={user.name} url={user.avatarUrl} size={64} />
        <div className="flex gap-2">
          <Button variant="ghost" onClick={upload} disabled={busy}>
            {busy ? t("common.uploading") : user.avatarUrl ? t("account.changePhoto") : t("account.addPhoto")}
          </Button>
          {user.avatarUrl && (
            <Button variant="danger" onClick={removeAvatar}>
              {t("common.remove")}
            </Button>
          )}
        </div>
      </div>
      <form onSubmit={save} className="space-y-3">
        <Field
          label={t("account.displayName")}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          required
          maxLength={100}
        />
        <ErrorText error={error} />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={!name.trim() || name.trim() === user.name}>
            {t("common.save")}
          </Button>
          <Saved show={saved} />
        </div>
      </form>
    </Section>
  );
}

function EmailSection({ user }: { user: PublicUser }) {
  const setMe = useSetMe();
  const [email, setEmail] = useState(user.email);
  const [currentPassword, setCurrentPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setMe((await api<{ user: PublicUser }>("/auth/me", { method: "PATCH", body: { email, currentPassword } })).user);
      setCurrentPassword("");
      setSaved(true);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Section title={t("auth.email")}>
      <form onSubmit={save} className="space-y-3">
        <Field
          label={t("account.emailAddress")}
          type="email"
          value={email}
          onChange={(e) => (setEmail(e.target.value), setSaved(false))}
          required
          autoComplete="email"
        />
        {email.trim().toLowerCase() !== user.email && (
          <Field
            label={t("account.currentPassword")}
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        )}
        <ErrorText error={error} />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={email.trim().toLowerCase() === user.email}>
            {t("account.changeEmail")}
          </Button>
          <Saved show={saved} />
        </div>
      </form>
    </Section>
  );
}

function PasswordSection() {
  const setMe = useSetMe();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) return setError(new Error(t("account.passwordMismatch")));
    try {
      setMe((await api<{ user: PublicUser }>("/auth/me", { method: "PATCH", body: { currentPassword, newPassword } })).user);
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      setSaved(true);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Section title={t("auth.password")}>
      <form onSubmit={save} className="space-y-3">
        <Field
          label={t("account.currentPassword")}
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
          autoComplete="current-password"
        />
        <Field
          label={t("account.newPassword")}
          type="password"
          value={newPassword}
          onChange={(e) => (setNewPassword(e.target.value), setSaved(false))}
          required
          minLength={8}
          autoComplete="new-password"
        />
        <Field
          label={t("account.confirmPassword")}
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
        />
        <p className="text-xs text-neutral-500">{t("account.otherDevices")}</p>
        <ErrorText error={error} />
        <div className="flex items-center gap-3">
          <Button type="submit">{t("account.changePassword")}</Button>
          <Saved show={saved} />
        </div>
      </form>
    </Section>
  );
}

/** Two-factor sign-in with an authenticator app, and the recovery codes for a lost phone. */
function TwoFactorSection() {
  const qc = useQueryClient();
  const setMe = useSetMe();
  const status = useQuery({ queryKey: ["2fa"], queryFn: () => api<TwoFactorStatus>("/auth/2fa") });
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  const refreshStatus = () => qc.invalidateQueries({ queryKey: ["2fa"] });

  const start = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setSetup(await api<TwoFactorSetup>("/auth/2fa/setup", { method: "POST", body: { password } }));
      setPassword("");
      setCode("");
    });
  };
  const confirmCode = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const res = await api<{ user: PublicUser; recoveryCodes: string[] }>("/auth/2fa/enable", { method: "POST", body: { code } });
      setMe(res.user);
      setSetup(null);
      setCodes(res.recoveryCodes);
      await refreshStatus();
    });
  };
  const newCodes = () =>
    void run(async () => {
      if (!confirm(t("twoFactor.newRecoveryHelp"))) return;
      const res = await api<{ recoveryCodes: string[] }>("/auth/2fa/recovery-codes", { method: "POST", body: { password } });
      setPassword("");
      setCodes(res.recoveryCodes);
      await refreshStatus();
    });
  const disable = () =>
    void run(async () => {
      const res = await api<{ user: PublicUser }>("/auth/2fa/disable", { method: "POST", body: { password } });
      setPassword("");
      setMe(res.user);
      await refreshStatus();
    });

  if (!status.data) return null;
  const passwordField = (
    <Field
      label={t("account.currentPassword")}
      type="password"
      value={password}
      onChange={(e) => setPassword(e.target.value)}
      required
      autoComplete="current-password"
    />
  );

  let body: ReactNode;
  if (codes) {
    body = (
      <div className="space-y-3" data-recovery-codes>
        <h3 className="font-semibold">{t("twoFactor.recoveryTitle")}</h3>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{t("twoFactor.recoveryHelp")}</p>
        <ul className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-md border border-neutral-200 bg-neutral-50 p-3 font-mono text-sm sm:max-w-sm dark:border-neutral-800 dark:bg-neutral-900">
          {codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(codes.join("\n")).then(() => setCopied(true));
            }}
          >
            {copied ? t("common.copied") : t("common.copy")}
          </Button>
          <Button
            onClick={() => {
              setCodes(null);
              setCopied(false);
            }}
          >
            {t("twoFactor.done")}
          </Button>
        </div>
      </div>
    );
  } else if (setup) {
    body = (
      <form className="space-y-3" onSubmit={confirmCode}>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{t("twoFactor.scan")}</p>
        {/* White behind the code, so phones read it in dark mode too. */}
        <img
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(setup.qrSvg)}`}
          alt={setup.otpauthUrl}
          width={192}
          height={192}
          className="rounded-md bg-white p-2"
        />
        <p className="text-xs text-neutral-500">
          {t("twoFactor.manualKey")}{" "}
          <code className="break-all rounded bg-neutral-100 px-1 py-0.5 font-mono text-neutral-800 select-all dark:bg-neutral-800 dark:text-neutral-200">
            {setup.secret.replace(/(.{4})/g, "$1 ").trim()}
          </code>
        </p>
        <Field
          label={t("twoFactor.code")}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          autoFocus
          autoComplete="one-time-code"
          inputMode="numeric"
          maxLength={8}
        />
        <ErrorText error={error} />
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || !code.trim()}>
            {t("twoFactor.confirm")}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setSetup(null)}>
            {t("common.cancel")}
          </Button>
        </div>
      </form>
    );
  } else if (!status.data.enabled) {
    body = (
      <form className="space-y-3" onSubmit={start}>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{t("twoFactor.intro")}</p>
        <p className="text-sm">{t("twoFactor.off")}</p>
        {passwordField}
        <ErrorText error={error} />
        <Button type="submit" disabled={busy || !password}>
          {t("twoFactor.enable")}
        </Button>
      </form>
    );
  } else {
    body = (
      <form className="space-y-3" onSubmit={(e) => e.preventDefault()}>
        <p className="text-sm text-green-700 dark:text-green-400">{t("twoFactor.on")}</p>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{t("twoFactor.recoveryLeft", { count: status.data.recoveryCodesLeft })}</p>
        {passwordField}
        <ErrorText error={error} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" disabled={busy || !password} onClick={newCodes}>
            {t("twoFactor.newRecovery")}
          </Button>
          <Button type="button" variant="danger" disabled={busy || !password} onClick={disable} title={t("twoFactor.disableHelp")}>
            {t("twoFactor.disable")}
          </Button>
        </div>
      </form>
    );
  }
  return (
    <Section title={t("twoFactor.title")} id="two-factor">
      {body}
    </Section>
  );
}

const THEMES: { value: ThemeChoice; label: () => string; icon: ReactNode }[] = [
  { value: "light", label: () => t("account.themeLight"), icon: <Sun size={18} /> },
  { value: "dark", label: () => t("account.themeDark"), icon: <Moon size={18} /> },
  { value: "system", label: () => t("account.themeSystem"), icon: <Monitor size={18} /> },
];

function LanguageSection({ user }: { user: PublicUser }) {
  const [error, setError] = useState<unknown>(null);
  async function change(locale: Locale) {
    setError(null);
    try {
      await api("/auth/me", { method: "PATCH", body: { locale } });
      setLocale(locale);
      // Everything on screen (and plugins) is drawn again in the new language.
      window.location.reload();
    } catch (err) {
      setError(err);
    }
  }
  return (
    <Section title={t("account.language")}>
      <div className="max-w-xs">
        <LanguageSelect value={user.locale} onChange={change} />
      </div>
      <ErrorText error={error} />
    </Section>
  );
}

function ThemeSection() {
  const [theme, setChoice] = useState(getTheme());
  return (
    <Section title={t("account.appearance")}>
      <div role="radiogroup" aria-label={t("account.theme")} className="grid grid-cols-3 gap-2">
        {THEMES.map((th) => (
          <button
            key={th.value}
            role="radio"
            aria-checked={theme === th.value}
            onClick={() => {
              setTheme(th.value);
              setChoice(th.value);
            }}
            className={`flex flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-sm ${theme === th.value ? "border-blue-500 ring-2 ring-blue-500/30" : "border-neutral-200 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/60"}`}
          >
            {th.icon}
            {th.label()}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-neutral-500">{t("account.themeHelp")}</p>
    </Section>
  );
}

/** Which e-mails the user gets (once administrators set up e-mail). */
function EmailPrefsSection() {
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: ["email-prefs"], queryFn: () => api<{ enabled: boolean; prefs: EmailPrefs }>("/account/email") });
  const toggle = async (kind: EmailKind, on: boolean) => {
    const data = await api<{ enabled: boolean; prefs: EmailPrefs }>("/account/email", { method: "PUT", body: { [kind]: on } });
    qc.setQueryData(["email-prefs"], data);
  };
  if (!prefs.data) return null;
  return (
    <Section title={t("account.emails")} id="email">
      {!prefs.data.enabled ? (
        <p className="text-sm text-neutral-500">{t("account.emailsOff")}</p>
      ) : (
        <div className="space-y-2">
          <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">{t("account.emailsHelp")}</p>
          {EMAIL_KINDS.map((kind) => (
            <label key={kind} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-blue-600"
                checked={prefs.data.prefs[kind]}
                onChange={(e) => void toggle(kind, e.target.checked)}
              />
              {t(`account.email_${kind}`)}
            </label>
          ))}
        </div>
      )}
    </Section>
  );
}

/** The demo page again, for those who deleted it (or never had it). */
function DemoSection() {
  const navigate = useNavigate();
  const refresh = useRefreshPages();
  const [busy, setBusy] = useState(false);
  return (
    <Section title={t("account.demo")} id="demo">
      <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">{t("account.demoHelp")}</p>
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const { pageId } = await api<{ pageId: string }>("/demo", { method: "POST" });
            await refresh();
            navigate(`/page/${pageId}`);
          } finally {
            setBusy(false);
          }
        }}
      >
        ✨ {t("account.demoCreate")}
      </Button>
    </Section>
  );
}

function ImportSection() {
  return (
    <Section title={t("account.import")} id="import">
      <p className="mb-2 text-sm text-neutral-600 dark:text-neutral-400">{t("account.importIntro")}</p>
      <ul className="mb-5 list-disc space-y-1 pl-5 text-sm text-neutral-600 dark:text-neutral-400">
        {(["account.importNotion", "account.importCsv", "account.importBackup"] as const).map((k) => (
          <li key={k}>
            <Rich text={t(k)} />
          </li>
        ))}
      </ul>
      <NotionImport />
    </Section>
  );
}

function DeleteSection() {
  const workspaces = useWorkspaces();
  const owned = (workspaces.data ?? []).filter((w) => w.role === "owner");
  const [chosen, setChosen] = useState("");
  const space = owned.find((w) => w.id === chosen) ?? owned[0];
  const [typed, setTyped] = useState("");
  const [emptyError, setEmptyError] = useState<unknown>(null);
  const [emptied, setEmptied] = useState<number | null>(null);
  const [password, setPassword] = useState("");
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const refreshPages = useRefreshPages();
  const { refresh } = useSession();
  const navigate = useNavigate();
  const name = space ? workspaceName(space) : "";

  async function empty(e: FormEvent) {
    e.preventDefault();
    if (!space || typed.trim() !== name) return;
    setBusy(true);
    setEmptyError(null);
    try {
      const res = await api<{ deleted: number }>(`/workspaces/${space.id}/content`, { method: "DELETE" });
      setEmptied(res.deleted);
      setTyped("");
      await refreshPages();
    } catch (err) {
      setEmptyError(err);
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount(e: FormEvent) {
    e.preventDefault();
    if (!password || !confirm(t("account.confirmDeleteAccount"))) return;
    setBusy(true);
    setDeleteError(null);
    try {
      await api("/auth/me", { method: "DELETE", body: { password } });
    } catch (err) {
      setDeleteError(err);
      setBusy(false);
      return;
    }
    await clearOfflineData();
    await refresh();
    navigate("/login", { replace: true });
  }

  return (
    <Section title={t("account.danger")} id="delete">
      <div className="space-y-8">
        {owned.length > 0 && (
          <form className="space-y-3" onSubmit={empty}>
            <h3 className="font-semibold">{t("account.emptySpace")}</h3>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">{t("account.emptySpaceHelp")}</p>
            <Select
              value={space?.id ?? ""}
              onChange={(e) => {
                setChosen(e.target.value);
                setTyped("");
                setEmptied(null);
              }}
              aria-label={t("notion.space")}
            >
              {owned.map((w) => (
                <option key={w.id} value={w.id}>
                  {workspaceName(w)}
                </option>
              ))}
            </Select>
            <label className="block text-sm">
              <span className="mb-1 block">
                <Rich text={t("account.emptySpaceConfirm", { name })} />
              </span>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
              />
            </label>
            <div className="flex items-center gap-3">
              <Button type="submit" variant="danger" disabled={busy || typed.trim() !== name}>
                {t("account.emptySpaceButton")}
              </Button>
              {emptied !== null && <span className="text-sm text-green-600 dark:text-green-400">{t("account.emptied", { count: emptied })}</span>}
            </div>
            <ErrorText error={emptyError} />
          </form>
        )}

        <form className="space-y-3" onSubmit={deleteAccount}>
          <h3 className="font-semibold">{t("account.deleteAccount")}</h3>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">{t("account.deleteAccountHelp")}</p>
          <Field
            label={t("account.currentPassword")}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit" variant="danger" disabled={busy || !password}>
            {t("account.deleteAccountButton")}
          </Button>
          <ErrorText error={deleteError} />
        </form>
      </div>
    </Section>
  );
}
