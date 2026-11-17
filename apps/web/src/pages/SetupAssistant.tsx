import { useEffect, useRef, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  DatabaseBackup,
  Globe,
  KeyRound,
  Mail,
  Puzzle,
  Rocket,
  Sparkles,
  UserPlus,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { currentLocale, t, type Locale, type MessageKey, type SetupStatus } from "@nootion/shared";
import { api } from "../lib/api";
import { setLocale } from "../lib/i18n";
import { onboardingKey, useOnboarding } from "../lib/onboarding";
import { Button, LanguageSelect, Rich } from "../components/ui";
import { PasskeysPanel } from "../components/Passkeys";
import { MailAdmin } from "./MailAdmin";
import { SsoAdmin } from "./SsoAdmin";
import { SecurityAdmin } from "./SecurityAdmin";
import { BackupsAdmin } from "./BackupsAdmin";
import { PluginsAdmin } from "./PluginsAdmin";
import { InviteAdmin } from "./InviteAdmin";
import { GuestsAdmin } from "./GuestsAdmin";

const statusKey = ["admin", "setup"];
const ASSISTANT = ["assistant"];

interface Step {
  id: string;
  icon: LucideIcon;
  title: MessageKey;
  intro: MessageKey;
  /** Already set up (a check in the list of steps), from the server's answer. */
  done?: (s: SetupStatus) => boolean;
  when?: (s: SetupStatus) => boolean;
  body: (s: SetupStatus) => ReactNode;
}

/** A framed part of a step, around a section of Administration. */
function Panel({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/40">{children}</div>;
}

/** A line of the server's state: a check when it's fine, an amber dot when something is worth knowing. */
function Fact({ ok, label, children }: { ok: boolean; label: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${ok ? "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"}`}
      >
        {ok ? <Check size={12} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      </span>
      <span className="min-w-0 text-sm">
        <span className="block font-medium">{label}</span>
        <span className="block break-words text-neutral-500">{children}</span>
      </span>
    </li>
  );
}

async function changeLanguage(locale: Locale) {
  await api("/auth/me", { method: "PATCH", body: { locale } });
  setLocale(locale);
  // Everything is drawn again in the new language, on the same step.
  window.location.reload();
}

const STEPS: Step[] = [
  {
    id: "welcome",
    icon: Globe,
    title: "setupWizard.welcome.title",
    intro: "setupWizard.welcome.intro",
    body: (s) => (
      <div className="space-y-4">
        <Panel>
          <div className="max-w-xs">
            <LanguageSelect value={currentLocale()} onChange={(l) => void changeLanguage(l)} />
          </div>
          <p className="mt-2 text-sm text-neutral-500">{t("setupWizard.welcome.languageHelp")}</p>
        </Panel>
        <Panel>
          <h3 className="mb-1 font-semibold">{t("setupWizard.welcome.server")}</h3>
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            <Fact ok={s.passkeys} label={t("setupWizard.welcome.address")}>
              <code className="text-neutral-700 dark:text-neutral-300">{s.appUrl}</code>
              {!s.passkeys && (
                <>
                  {" · "}
                  <Rich text={t("setupWizard.welcome.addressHttp")} />
                </>
              )}
            </Fact>
            <Fact ok label={t("setupWizard.welcome.files")}>
              {s.filesBucket ? <Rich text={t("setupWizard.welcome.filesBucket", { bucket: s.filesBucket })} /> : <Rich text={t("setupWizard.welcome.filesFolder")} />}
            </Fact>
          </ul>
          <p className="mt-2 text-xs text-neutral-500">
            <Rich text={t("setupWizard.welcome.envHelp")} />
          </p>
        </Panel>
      </div>
    ),
  },
  {
    id: "mail",
    icon: Mail,
    title: "setupWizard.mail.title",
    intro: "setupWizard.mail.intro",
    done: (s) => s.mail,
    body: () => (
      <Panel>
        <MailAdmin />
      </Panel>
    ),
  },
  {
    id: "signin",
    icon: KeyRound,
    title: "setupWizard.signin.title",
    intro: "setupWizard.signin.intro",
    done: (s) => !!s.sso || s.passkeys,
    body: () => (
      <div className="space-y-4">
        <Panel>
          <h3 className="mb-1 text-lg font-semibold">{t("passkeys.title")}</h3>
          <p className="mb-3 text-sm text-neutral-500">{t("setupWizard.signin.passkeysHelp")}</p>
          <PasskeysPanel />
        </Panel>
        <Panel>
          <SsoAdmin />
        </Panel>
        <Panel>
          <SecurityAdmin />
        </Panel>
      </div>
    ),
  },
  {
    id: "backups",
    icon: DatabaseBackup,
    title: "setupWizard.backups.title",
    intro: "setupWizard.backups.intro",
    done: (s) => s.backups,
    body: () => (
      <Panel>
        <BackupsAdmin />
      </Panel>
    ),
  },
  {
    id: "assistant",
    icon: Bot,
    title: "setupWizard.assistant.title",
    intro: "setupWizard.assistant.intro",
    when: (s) => s.assistant.installed,
    done: (s) => s.assistant.enabled,
    body: () => (
      <Panel>
        <PluginsAdmin only={ASSISTANT} />
      </Panel>
    ),
  },
  {
    id: "plugins",
    icon: Puzzle,
    title: "setupWizard.plugins.title",
    intro: "setupWizard.plugins.intro",
    done: (s) => s.plugins.enabled - Number(s.assistant.enabled) > 0,
    body: () => (
      <Panel>
        <PluginsAdmin except={ASSISTANT} />
      </Panel>
    ),
  },
  {
    id: "team",
    icon: UserPlus,
    title: "setupWizard.team.title",
    intro: "setupWizard.team.intro",
    done: (s) => s.members > 1 || s.invitations > 0,
    body: () => (
      <div className="space-y-4">
        <Panel>
          <InviteAdmin />
        </Panel>
        <Panel>
          <GuestsAdmin />
        </Panel>
      </div>
    ),
  },
  {
    id: "done",
    icon: Rocket,
    title: "setupWizard.done.title",
    intro: "setupWizard.done.intro",
    body: () => null,
  },
];

/** What the summary says of each step, set up or not. */
function summary(id: string, s: SetupStatus): { ok: boolean; text: string } | null {
  switch (id) {
    case "mail":
      return { ok: s.mail, text: t(s.mail ? "setupWizard.summary.mailOn" : "setupWizard.summary.mailOff") };
    case "signin":
      return s.sso
        ? { ok: true, text: t("setupWizard.summary.sso", { label: s.sso }) }
        : { ok: s.passkeys, text: t(s.passkeys ? "setupWizard.summary.passwordPasskeys" : "setupWizard.summary.password") };
    case "backups":
      return { ok: s.backups, text: t(s.backups ? "setupWizard.summary.backupsOn" : "setupWizard.summary.backupsOff") };
    case "assistant":
      return { ok: s.assistant.enabled, text: t(s.assistant.enabled ? "setupWizard.summary.assistantOn" : "setupWizard.summary.assistantOff") };
    case "plugins": {
      const count = s.plugins.enabled - Number(s.assistant.enabled);
      return { ok: count > 0, text: t("setupWizard.summary.plugins", { count }) };
    }
    case "team":
      return {
        ok: s.members > 1 || s.invitations > 0,
        text: t("setupWizard.summary.team", { count: s.members }) + (s.invitations ? ` · ${t("setupWizard.summary.invitations", { count: s.invitations })}` : ""),
      };
    default:
      return null;
  }
}

/**
 * The setup assistant: the main settings of a new server, one step at a time, each one a section of Administration.
 * Opened after the first administrator's account is created, and from Administration at any time. Every step can be
 * skipped; what is set is saved at once, as in Administration.
 */
export function SetupAssistantPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = useQuery({ queryKey: statusKey, queryFn: () => api<SetupStatus>("/admin/setup") });
  const s = status.data;
  const steps = s ? STEPS.filter((x) => !x.when || x.when(s)) : STEPS;
  const index = Math.max(
    0,
    steps.findIndex((x) => x.id === params.get("step")),
  );
  const step = steps[index]!;
  const top = useRef<HTMLDivElement>(null);

  // Each step shows the server as it is now (a mail server just saved, a plugin just turned on).
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: statusKey });
    top.current?.scrollIntoView({ block: "start" });
  }, [index, qc]);

  const go = (i: number) => setParams({ step: steps[Math.max(0, Math.min(steps.length - 1, i))]!.id });

  async function finish(to: string) {
    await api("/admin/setup/done", { method: "POST", body: {} }).catch(() => {});
    qc.setQueryData(onboardingKey, (d: object | undefined) => (d ? { ...d, setup: false } : d));
    await qc.invalidateQueries({ queryKey: ["admin", "settings"] });
    navigate(to);
  }

  const last = index === steps.length - 1;
  return (
    <div ref={top} className="min-h-full bg-neutral-50 dark:bg-neutral-950" data-setup-assistant={step.id}>
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/90 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/90">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:px-8">
          <Wand2 size={18} className="shrink-0 text-violet-600 dark:text-violet-400" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-semibold">{t("setupWizard.title")}</span>
          <Button variant="ghost" onClick={() => void finish("/admin")} data-setup-skip-all>
            {t("setupWizard.later")}
          </Button>
        </div>
        {/* Narrow screens: how far along, instead of the list of steps. */}
        <div className="h-1 bg-neutral-100 lg:hidden dark:bg-neutral-800">
          <div className="h-1 bg-violet-500 transition-all" style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-10 lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10">
        <nav aria-label={t("setupWizard.steps")} className="sticky top-20 hidden self-start lg:block">
          <ol className="space-y-0.5">
            {steps.map((x, i) => {
              const done = !!s && !!x.done?.(s);
              return (
                <li key={x.id}>
                  <button
                    type="button"
                    onClick={() => go(i)}
                    aria-current={i === index ? "step" : undefined}
                    className={`flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-sm ${
                      i === index
                        ? "bg-white font-medium text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
                        : "text-neutral-500 hover:bg-white/60 hover:text-neutral-800 dark:hover:bg-neutral-900 dark:hover:text-neutral-200"
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${
                        done ? "bg-green-600 text-white" : i === index ? "bg-violet-600 text-white" : "border border-neutral-300 dark:border-neutral-700"
                      }`}
                    >
                      {done ? <Check size={12} /> : i + 1}
                    </span>
                    {t(x.title)}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <main className="min-w-0">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-medium tracking-wide text-neutral-500 uppercase">
            <step.icon size={14} aria-hidden />
            {t("setupWizard.progress", { step: index + 1, count: steps.length })}
          </p>
          <h1 className="text-2xl font-bold">{t(step.title)}</h1>
          <p className="mt-2 mb-6 max-w-2xl text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
            <Rich text={t(step.intro)} />
          </p>

          {s && step.id === "done" ? (
            <Summary status={s} steps={steps} onGo={go} />
          ) : (
            s && step.body(s)
          )}

          <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-neutral-200 pt-5 dark:border-neutral-800">
            {index > 0 && (
              <Button variant="ghost" onClick={() => go(index - 1)} className="flex items-center gap-1">
                <ArrowLeft size={14} /> {t("setupWizard.previous")}
              </Button>
            )}
            <span className="flex-1" />
            {last ? (
              <>
                <Button variant="ghost" onClick={() => void finish("/admin")}>
                  {t("setupWizard.toAdmin")}
                </Button>
                <Button onClick={() => void finish("/")} className="flex items-center gap-1" data-setup-finish>
                  <Sparkles size={14} /> {t("setupWizard.open")}
                </Button>
              </>
            ) : (
              <>
                {index > 0 && !(s && step.done?.(s)) && (
                  <Button variant="ghost" onClick={() => go(index + 1)} data-setup-skip>
                    {t("setupWizard.skip")}
                  </Button>
                )}
                <Button onClick={() => go(index + 1)} className="flex items-center gap-1" data-setup-next>
                  {index === 0 ? t("setupWizard.start") : t("setupWizard.next")} <ArrowRight size={14} />
                </Button>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function Summary({ status, steps, onGo }: { status: SetupStatus; steps: Step[]; onGo: (i: number) => void }) {
  return (
    <Panel>
      <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {steps.map((x, i) => {
          const line = summary(x.id, status);
          if (!line) return null;
          return (
            <li key={x.id} className="flex items-center gap-3 py-3" data-setup-summary={x.id}>
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${line.ok ? "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300" : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800"}`}
              >
                {line.ok ? <Check size={14} /> : <x.icon size={13} />}
              </span>
              <span className="min-w-0 flex-1 text-sm">
                <span className="block font-medium">{t(x.title)}</span>
                <span className="block text-neutral-500">{line.text}</span>
              </span>
              <button type="button" onClick={() => onGo(i)} className="shrink-0 text-sm text-blue-600 hover:underline dark:text-blue-400">
                {line.ok ? t("setupWizard.change") : t("setupWizard.setUp")}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-neutral-500">{t("setupWizard.done.later")}</p>
    </Panel>
  );
}

/** At the top of Administration: resume the setup assistant of a new server, or open it again. */
export function SetupAssistantCard() {
  const pending = !!useOnboarding().data?.setup;
  if (!pending)
    return (
      <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-neutral-500">
        <Wand2 size={15} aria-hidden />
        <span>{t("setupWizard.cardDone")}</span>
        <Link to="/admin/setup" className="text-blue-600 hover:underline dark:text-blue-400" data-setup-open>
          {t("setupWizard.openAgain")}
        </Link>
      </div>
    );
  return (
    <div className="mb-6 flex flex-wrap items-center gap-4 rounded-xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-900 dark:bg-violet-950/40" data-setup-card>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white">
        <Wand2 size={18} />
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">{t("setupWizard.cardTitle")}</p>
        <p className="text-neutral-600 dark:text-neutral-400">{t("setupWizard.cardBody")}</p>
      </div>
      <Link
        to="/admin/setup"
        className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700"
        data-setup-resume
      >
        {t("setupWizard.resume")} <ArrowRight size={14} />
      </Link>
    </div>
  );
}
