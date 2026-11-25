import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useMatch, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  AppWindow,
  ArrowRight,
  Bot,
  Check,
  Calculator,
  CheckSquare,
  Command,
  Database,
  FileDown,
  Link2,
  MessagesSquare,
  PartyPopper,
  Sparkles,
  SquarePen,
  X,
  type LucideIcon,
} from "lucide-react";
import { t, type MessageKey } from "@nootion/shared";
import { api } from "../lib/api";
import { onboardingKey, useOnboarding, useTourRequests } from "../lib/onboarding";
import { useSession } from "../lib/session";
import { useRefreshPages } from "../lib/queries";
import { setTabsEnabled, useTabs } from "../lib/tabs";
import { usePlugins } from "../plugins/registry";
import { captureShortcutLabel, isMac } from "./QuickCapture";
import { Button, Rich, useClosing } from "./ui";

/** A keyboard key, drawn as on a keyboard. */
function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-6 items-center justify-center rounded border border-b-2 border-neutral-300 bg-white px-1.5 py-0.5 font-sans text-xs font-medium text-neutral-700 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200">
      {children}
    </kbd>
  );
}

const paletteKey = () => (isMac() ? "⌘ K" : "Ctrl K");

/* ---------- Illustrations: small drawings of each feature, made of HTML so that they follow the theme ---------- */

const card = "rounded-lg border border-neutral-200 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-900";

function EditorArt() {
  const items: [string, string][] = [
    ["H1", t("tour.art.heading")],
    ["☐", t("tour.art.todo")],
    ["▥", t("tour.art.columns")],
    ["💡", t("tour.art.callout")],
  ];
  return (
    <div className="w-60 space-y-2">
      <div className={`${card} px-3 py-2 text-sm`}>
        <span className="text-neutral-400">/</span>
        <span className="ml-0.5 inline-block h-4 w-px animate-pulse bg-neutral-500 align-middle" />
      </div>
      <ul className={`${card} p-1 text-sm`}>
        {items.map(([icon, label], i) => (
          <li key={label} className={`flex items-center gap-2 rounded px-2 py-1 ${i === 0 ? "bg-neutral-100 dark:bg-neutral-800" : ""}`}>
            <span className="w-5 text-center text-xs text-neutral-500">{icon}</span>
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DatabaseArt() {
  const columns: [string, string, number][] = [
    [t("tour.art.todoColumn"), "bg-neutral-200 dark:bg-neutral-700", 2],
    [t("tour.art.doingColumn"), "bg-amber-200 dark:bg-amber-700/60", 1],
    [t("tour.art.doneColumn"), "bg-green-200 dark:bg-green-700/60", 2],
  ];
  return (
    <div className="w-72 space-y-2">
      <div className="flex gap-1 text-xs">
        {(["view.table", "view.board", "view.calendar", "view.timeline"] as const).map((k, i) => (
          <span key={k} className={`rounded-md px-2 py-1 ${i === 1 ? "bg-white font-medium shadow-sm dark:bg-neutral-800" : "text-neutral-500"}`}>
            {t(k)}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {columns.map(([label, color, n]) => (
          <div key={label} className="space-y-1.5">
            <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] ${color}`}>{label}</span>
            {Array.from({ length: n }, (_, i) => (
              <div key={i} className={`${card} h-8 p-1.5`}>
                <div className="h-1.5 w-4/5 rounded bg-neutral-200 dark:bg-neutral-700" />
                <div className="mt-1 h-1.5 w-1/2 rounded bg-neutral-100 dark:bg-neutral-800" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function MathArt() {
  const box = "rounded-md border border-blue-300 bg-blue-50 px-2 py-1 text-xs text-blue-900 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-200";
  return (
    <div className="flex w-72 flex-col items-center gap-3">
      <div className={`${card} w-full px-4 py-3 text-center font-serif text-xl italic`}>
        e<sup>iπ</sup> + 1 = 0
      </div>
      <div className={`${card} flex w-full items-center justify-center gap-1.5 px-3 py-3`}>
        <span className={box}>{t("tour.art.idea")}</span>
        <ArrowRight size={14} className="text-neutral-400" />
        <span className={box}>{t("tour.art.draft")}</span>
        <ArrowRight size={14} className="text-neutral-400" />
        <span className={box}>{t("tour.art.published")}</span>
      </div>
    </div>
  );
}

function SyncedArt() {
  const page = (title: string) => (
    <div className={`${card} w-32 space-y-1.5 p-2`}>
      <div className="text-xs font-semibold">{title}</div>
      <div className="h-1.5 w-full rounded bg-neutral-100 dark:bg-neutral-800" />
      <div className="rounded border-2 border-red-300 p-1 dark:border-red-500/70">
        <div className="h-1.5 w-4/5 rounded bg-red-200 dark:bg-red-800/70" />
        <div className="mt-1 h-1.5 w-3/5 rounded bg-red-100 dark:bg-red-900/60" />
      </div>
      <div className="h-1.5 w-2/3 rounded bg-neutral-100 dark:bg-neutral-800" />
    </div>
  );
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex gap-3">
        {page(t("tour.art.pageA"))}
        {page(t("tour.art.pageB"))}
      </div>
      <span className="text-xs text-neutral-500">{t("tour.art.syncedIn", { count: 2 })}</span>
    </div>
  );
}

function PaletteArt() {
  return (
    <div className={`${card} w-72 p-2 text-sm`}>
      <div className="mb-1 flex items-center justify-between border-b border-neutral-200 px-1 pb-2 dark:border-neutral-700">
        <span className="text-neutral-400">{t("tour.art.searchPlaceholder")}</span>
        <Key>{paletteKey()}</Key>
      </div>
      {[t("page.new"), t("palette.newDatabase"), t("inbox.capture")].map((label, i) => (
        <div key={label} className={`rounded px-2 py-1 ${i === 0 ? "bg-neutral-100 dark:bg-neutral-800" : ""}`}>
          {label}
        </div>
      ))}
    </div>
  );
}

function TabsArt() {
  const tabs: [string, string, boolean][] = [
    ["🏠", "", true],
    ["📝", t("tour.art.tabNotes"), false],
    ["💶", t("tour.art.tabBudget"), false],
    ["🗾", t("tour.art.tabTrip"), false],
  ];
  return (
    <div className="w-80 space-y-2">
      <div className={`${card} flex items-center gap-1 p-1 text-xs`}>
        {tabs.map(([icon, label, pinned], i) => (
          <span
            key={icon}
            className={`flex h-6 items-center gap-1 rounded-md ${pinned ? "w-7 justify-center" : "min-w-0 flex-1 pr-1 pl-1.5"} ${i === 1 ? "bg-neutral-100 font-medium ring-1 ring-neutral-200 dark:bg-neutral-800 dark:ring-neutral-700" : "text-neutral-500"}`}
          >
            <span>{icon}</span>
            {!pinned && <span className="min-w-0 flex-1 truncate">{label}</span>}
            {!pinned && i === 1 && <X size={11} className="shrink-0 text-neutral-400" />}
          </span>
        ))}
        <span className="px-1 text-neutral-400">+</span>
      </div>
      <div className={`${card} space-y-1.5 p-3`}>
        <div className="h-2 w-1/2 rounded bg-neutral-300 dark:bg-neutral-600" />
        <div className="h-1.5 w-full rounded bg-neutral-100 dark:bg-neutral-800" />
        <div className="h-1.5 w-4/5 rounded bg-neutral-100 dark:bg-neutral-800" />
      </div>
    </div>
  );
}

/** Turns the tab bar on (or off again) without leaving the tour. */
function TabsSwitch() {
  const { enabled } = useTabs();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => setTabsEnabled(!enabled)}
      data-tour-tabs
      className={`mt-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${enabled ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" : "border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"}`}
    >
      {enabled ? <Check size={16} /> : <AppWindow size={16} />}
      {enabled ? t("tour.tabs.enabled") : t("tour.tabs.enable")}
    </button>
  );
}

function TasksArt() {
  const rows: [boolean, string, string | null][] = [
    [true, t("tour.art.task1"), null],
    [false, t("tour.art.task2"), t("tour.art.tomorrow")],
    [false, t("tour.art.task3"), t("tour.art.friday")],
  ];
  return (
    <ul className={`${card} w-72 space-y-1.5 p-3 text-sm`}>
      {rows.map(([done, label, date]) => (
        <li key={label} className="flex items-center gap-2">
          <span className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] ${done ? "border-blue-600 bg-blue-600 text-white" : "border-neutral-400"}`}>
            {done && "✓"}
          </span>
          <span className={done ? "text-neutral-400 line-through" : ""}>{label}</span>
          {date && <span className="ml-auto rounded bg-blue-50 px-1.5 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300">@{date}</span>}
        </li>
      ))}
    </ul>
  );
}

function CollabArt() {
  const people: [string, string][] = [
    ["A", "bg-rose-400"],
    ["M", "bg-sky-500"],
    ["L", "bg-emerald-500"],
  ];
  return (
    <div className="w-72 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex -space-x-2">
          {people.map(([letter, color]) => (
            <span key={letter} className={`flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-xs font-semibold text-white dark:border-neutral-900 ${color}`}>
              {letter}
            </span>
          ))}
        </div>
        <span className="flex items-center gap-1 rounded-md bg-neutral-900 px-2 py-1 text-xs text-white dark:bg-white dark:text-neutral-900">
          <Link2 size={12} /> {t("tour.art.share")}
        </span>
      </div>
      <div className={`${card} p-3 text-sm`}>
        <span className="rounded bg-amber-100 px-0.5 dark:bg-amber-500/30">{t("tour.art.commented")}</span>
        <div className="mt-2 rounded-md bg-neutral-50 p-2 text-xs dark:bg-neutral-800">
          <span className="font-semibold">Alice</span> · <span className="text-blue-600 dark:text-blue-400">@Marc</span> {t("tour.art.comment")}
        </div>
      </div>
    </div>
  );
}

function AssistantArt() {
  return (
    <div className="relative w-72">
      <div className={`${card} p-3 text-sm leading-relaxed`}>
        {t("tour.art.before")} <span className="rounded bg-blue-200/70 px-0.5 dark:bg-blue-500/40">{t("tour.art.selected")}</span>
      </div>
      <div className={`${card} mt-2 ml-6 w-44 p-1 text-xs`}>
        {(["tour.art.summarise", "tour.art.translate", "tour.art.improve"] as const).map((k, i) => (
          <div key={k} className={`flex items-center gap-1.5 rounded px-2 py-1 ${i === 0 ? "bg-violet-50 dark:bg-violet-950" : ""}`}>
            <Sparkles size={12} className="text-violet-500" /> {t(k)}
          </div>
        ))}
      </div>
      <span className="absolute -right-1 -bottom-3 flex h-9 w-9 items-center justify-center rounded-full bg-violet-600 text-white shadow-lg">
        <Sparkles size={16} />
      </span>
    </div>
  );
}

function MoreArt() {
  const items: [string, string][] = [
    ["📥", t("tour.art.import")],
    ["🖨️", t("tour.art.pdf")],
    ["🗺️", t("tour.art.graph")],
    ["📱", t("tour.art.offline")],
    ["🧩", t("tour.art.widgets")],
    ["🔌", t("tour.art.plugins")],
  ];
  return (
    <div className="grid w-72 grid-cols-3 gap-2">
      {items.map(([icon, label]) => (
        <div key={label} className={`${card} flex flex-col items-center gap-1 p-2 text-center text-[11px] leading-tight`}>
          <span className="text-lg">{icon}</span>
          {label}
        </div>
      ))}
    </div>
  );
}

function BigIcon({ icon: Icon, className }: { icon: LucideIcon; className: string }) {
  return (
    <span className={`flex h-20 w-20 items-center justify-center rounded-2xl shadow-lg ${className}`}>
      <Icon size={40} />
    </span>
  );
}

/* ---------- The steps ---------- */

interface Step {
  id: string;
  icon: LucideIcon;
  /** Colours of the icon and of the illustration's background. */
  tint: string;
  title: MessageKey;
  body: MessageKey;
  /** Short tips, each with the keys to press. */
  tips?: { keys?: string[]; text: MessageKey }[];
  art: () => ReactNode;
  /** Something to do right from the card (turn a feature on). */
  action?: () => ReactNode;
}

function steps(assistant: boolean, wide: boolean): Step[] {
  const all: (Step | false)[] = [
    {
      id: "welcome",
      icon: Sparkles,
      tint: "from-violet-100 to-sky-100 dark:from-violet-950 dark:to-sky-950",
      title: "tour.welcome.title",
      body: "tour.welcome.body",
      art: () => <BigIcon icon={Sparkles} className="bg-gradient-to-br from-violet-500 to-sky-500 text-white" />,
    },
    {
      id: "editor",
      icon: SquarePen,
      tint: "from-sky-100 to-cyan-50 dark:from-sky-950 dark:to-cyan-950",
      title: "tour.editor.title",
      body: "tour.editor.body",
      tips: [
        { keys: ["/"], text: "tour.editor.tipSlash" },
        { keys: ["#", "-", "[ ]"], text: "tour.editor.tipMarkdown" },
        { keys: ["⋮⋮"], text: "tour.editor.tipDrag" },
      ],
      art: () => <EditorArt />,
    },
    {
      id: "databases",
      icon: Database,
      tint: "from-amber-50 to-orange-100 dark:from-amber-950 dark:to-orange-950",
      title: "tour.databases.title",
      body: "tour.databases.body",
      tips: [{ text: "tour.databases.tipViews" }, { text: "tour.databases.tipFormulas" }, { text: "tour.databases.tipSubitems" }],
      art: () => <DatabaseArt />,
    },
    {
      id: "math",
      icon: Calculator,
      tint: "from-blue-50 to-indigo-100 dark:from-blue-950 dark:to-indigo-950",
      title: "tour.math.title",
      body: "tour.math.body",
      tips: [
        { keys: ["$…$"], text: "tour.math.tipInline" },
        { keys: ["/equation"], text: "tour.math.tipBlock" },
        { keys: ["/mermaid"], text: "tour.math.tipMermaid" },
      ],
      art: () => <MathArt />,
    },
    {
      id: "synced",
      icon: Link2,
      tint: "from-rose-50 to-red-100 dark:from-rose-950 dark:to-red-950",
      title: "tour.synced.title",
      body: "tour.synced.body",
      tips: [{ keys: ["/synced"], text: "tour.synced.tipCommand" }, { text: "tour.synced.tipMenu" }],
      art: () => <SyncedArt />,
    },
    {
      id: "palette",
      icon: Command,
      tint: "from-neutral-100 to-stone-200 dark:from-neutral-900 dark:to-stone-900",
      title: "tour.palette.title",
      body: "tour.palette.body",
      tips: [
        { keys: [paletteKey()], text: "tour.palette.tipOpen" },
        { keys: [captureShortcutLabel()], text: "tour.palette.tipCapture" },
      ],
      art: () => <PaletteArt />,
    },
    // The tab bar is only on wide screens.
    wide && {
      id: "tabs",
      icon: AppWindow,
      tint: "from-sky-50 to-blue-100 dark:from-sky-950 dark:to-blue-950",
      title: "tour.tabs.title",
      body: "tour.tabs.body",
      tips: [
        { keys: [isMac() ? "⌘" : "Ctrl"], text: "tour.tabs.tipOpen" },
        { keys: ["📌"], text: "tour.tabs.tipPin" },
      ],
      art: () => <TabsArt />,
      action: () => <TabsSwitch />,
    },
    {
      id: "tasks",
      icon: CheckSquare,
      tint: "from-emerald-50 to-teal-100 dark:from-emerald-950 dark:to-teal-950",
      title: "tour.tasks.title",
      body: "tour.tasks.body",
      tips: [{ keys: ["[ ]"], text: "tour.tasks.tipTodo" }, { keys: ["@"], text: "tour.tasks.tipDate" }, { text: "tour.tasks.tipList" }],
      art: () => <TasksArt />,
    },
    {
      id: "collab",
      icon: MessagesSquare,
      tint: "from-pink-50 to-fuchsia-100 dark:from-pink-950 dark:to-fuchsia-950",
      title: "tour.collab.title",
      body: "tour.collab.body",
      tips: [{ keys: ["@"], text: "tour.collab.tipMention" }, { text: "tour.collab.tipShare" }, { text: "tour.collab.tipHistory" }],
      art: () => <CollabArt />,
    },
    assistant && {
      id: "assistant",
      icon: Bot,
      tint: "from-violet-100 to-purple-100 dark:from-violet-950 dark:to-purple-950",
      title: "tour.assistant.title",
      body: "tour.assistant.body",
      tips: [{ text: "tour.assistant.tipSelection" }, { text: "tour.assistant.tipChat" }],
      art: () => <AssistantArt />,
    },
    {
      id: "more",
      icon: FileDown,
      tint: "from-lime-50 to-green-100 dark:from-lime-950 dark:to-green-950",
      title: "tour.more.title",
      body: "tour.more.body",
      tips: [{ text: "tour.more.tipImport" }, { keys: [isMac() ? "⌘ P" : "Ctrl P"], text: "tour.more.tipPrint" }, { text: "tour.more.tipApps" }],
      art: () => <MoreArt />,
    },
    {
      id: "done",
      icon: PartyPopper,
      tint: "from-amber-50 to-pink-100 dark:from-amber-950 dark:to-pink-950",
      title: "tour.done.title",
      body: "tour.done.body",
      art: () => <BigIcon icon={PartyPopper} className="bg-gradient-to-br from-amber-400 to-pink-500 text-white" />,
    },
  ];
  return all.filter((s): s is Step => !!s);
}

/**
 * The guided tour: a few cards on what Nootion can do, shown once to each new account (and the first administrator
 * once the setup assistant is done). Skipped or finished, it doesn't come back by itself; My account and the palette
 * open it again.
 */
export function OnboardingTour() {
  const { user } = useSession();
  const guest = user?.role === "guest";
  const onboarding = useOnboarding(!!user && !guest);
  const onSetup = useMatch("/admin/setup");
  const [requested, setRequested] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useTourRequests(useCallback(() => (setRequested(true), setDismissed(false)), []));
  const data = onboarding.data;
  // The administrator of a new server sets it up first; the tour follows.
  const automatic = !!data?.tour && !data.setup && !onSetup;
  if (guest || dismissed || !(requested || automatic)) return null;
  return (
    <TourDialog
      demoPageId={data?.demoPageId ?? null}
      onClose={() => {
        setDismissed(true);
        setRequested(false);
      }}
    />
  );
}

function TourDialog({ demoPageId, onClose }: { demoPageId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const refresh = useRefreshPages();
  const plugins = usePlugins().data ?? [];
  const assistant = plugins.some((p) => p.id === "assistant" && p.enabled);
  // Read once: the cards don't change while the tour is open.
  const [wide] = useState(() => !!window.matchMedia?.("(min-width: 768px)").matches);
  const list = steps(assistant, wide);
  const [index, setIndex] = useState(0);
  const step = list[Math.min(index, list.length - 1)]!;
  const last = index >= list.length - 1;
  const [busy, setBusy] = useState(false);
  const next = useRef<HTMLButtonElement>(null);

  const finish = useCallback(() => {
    void api("/onboarding/tour/done", { method: "POST", body: {} })
      .then(() => qc.setQueryData(onboardingKey, (d: object | undefined) => (d ? { ...d, tour: false } : d)))
      .catch(() => {});
    onClose();
  }, [qc, onClose]);
  const { closing, close } = useClosing(finish);

  useEffect(() => next.current?.focus(), [index]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight" && !last) setIndex((i) => i + 1);
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, last]);

  async function openExamples() {
    setBusy(true);
    try {
      const pageId = demoPageId ?? (await api<{ pageId: string }>("/demo", { method: "POST" })).pageId;
      if (!demoPageId) await refresh();
      close();
      navigate(`/page/${pageId}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="nt-backdrop fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" data-closing={closing || undefined}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("tour.title")}
        data-tour={step.id}
        className="nt-dialog relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-neutral-200 bg-white shadow-2xl sm:max-w-lg sm:rounded-2xl dark:border-neutral-800 dark:bg-neutral-900"
      >
        <button
          type="button"
          onClick={close}
          className="absolute top-3 right-3 z-10 rounded-full bg-white/70 p-1.5 text-neutral-500 hover:bg-white hover:text-neutral-800 dark:bg-neutral-900/70 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
          aria-label={t("tour.skip")}
          title={t("tour.skip")}
        >
          <X size={16} />
        </button>
        <div className={`flex h-48 shrink-0 items-center justify-center bg-gradient-to-br sm:h-56 ${step.tint}`} aria-hidden>
          {step.art()}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-2">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-medium tracking-wide text-neutral-500 uppercase">
            <step.icon size={14} aria-hidden />
            {t("tour.progress", { step: index + 1, count: list.length })}
          </p>
          <h2 className="text-xl font-semibold">{t(step.title)}</h2>
          <p className="mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
            <Rich text={t(step.body)} />
          </p>
          {step.tips && (
            <ul className="mt-4 space-y-2 text-sm">
              {step.tips.map((tip) => (
                <li key={tip.text} className="flex items-start gap-2.5">
                  <span className={`flex shrink-0 flex-wrap gap-1 pt-0.5 ${step.tips!.some((x) => x.keys) ? "w-20" : ""}`}>
                    {tip.keys ? tip.keys.map((k) => <Key key={k}>{k}</Key>) : <span className="mt-2 ml-1 h-1.5 w-1.5 rounded-full bg-neutral-400" />}
                  </span>
                  <span className="text-neutral-700 dark:text-neutral-300">
                    <Rich text={t(tip.text)} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          {step.action?.()}
        </div>
        <div className="flex shrink-0 items-center gap-3 border-t border-neutral-100 px-6 py-4 dark:border-neutral-800">
          <div className="flex flex-1 flex-wrap gap-1.5" role="tablist" aria-label={t("tour.title")}>
            {list.map((s, i) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={t(s.title)}
                title={t(s.title)}
                onClick={() => setIndex(i)}
                className={`h-2 rounded-full transition-all ${i === index ? "w-5 bg-neutral-800 dark:bg-neutral-100" : "w-2 bg-neutral-300 hover:bg-neutral-400 dark:bg-neutral-700"}`}
              />
            ))}
          </div>
          {index > 0 && (
            <Button variant="ghost" onClick={() => setIndex(index - 1)} aria-label={t("tour.previous")} title={t("tour.previous")}>
              <ArrowLeft size={16} />
            </Button>
          )}
          {last ? (
            <>
              <Button variant="ghost" onClick={() => void openExamples()} disabled={busy} data-tour-examples>
                {t("tour.examples")}
              </Button>
              <Button ref={next} onClick={close} data-tour-finish>
                {t("tour.finish")}
              </Button>
            </>
          ) : (
            <>
              {index === 0 && (
                <Button variant="ghost" onClick={close} data-tour-skip>
                  {t("tour.skip")}
                </Button>
              )}
              <Button ref={next} onClick={() => setIndex(index + 1)} className="flex items-center gap-1" data-tour-next>
                {index === 0 ? t("tour.start") : t("tour.next")} <ArrowRight size={14} />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
