import { useMatch, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Database,
  FilePlus,
  Globe,
  Home,
  Inbox,
  Library,
  ListChecks,
  Monitor,
  Moon,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  Wand2,
  Sun,
  Trash2,
  User,
  Waypoints,
} from "lucide-react";
import { localeLabel, LOCALES, currentLocale, t, type Locale, type PageDetail, type PageSummary, type WorkspaceSummary } from "@nootion/shared";
import { api } from "../lib/api";
import { useRegisterActions, type Action } from "../lib/actions";
import { setLocale } from "../lib/i18n";
import { workspaceName } from "../lib/labels";
import { keys, useRefreshPages, useWorkspaces } from "../lib/queries";
import { useSession } from "../lib/session";
import { setTheme, type ThemeChoice } from "../lib/theme";
import { captureShortcutLabel } from "./QuickCapture";
import { startTour } from "../lib/onboarding";

const canAddPages = (w: WorkspaceSummary) => w.role === "owner" || w.role === "editor";

/**
 * The palette's actions of the whole app: create in a space, quick capture, go to a part of the app, theme and
 * language.
 */
export function useAppActions({ capture, newSpace, hasSync }: { capture: () => void; newSpace: () => void; hasSync: boolean }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const refresh = useRefreshPages();
  const { user } = useSession();
  const workspaces = useWorkspaces().data ?? [];
  const openPage = useMatch("/page/:id")?.params.id;

  useRegisterActions(() => {
    // The space of the open page first: "New page" creates there.
    const here = openPage ? qc.getQueryData<PageDetail>(keys.page(openPage))?.workspaceId : undefined;
    const spaces = workspaces
      .filter(canAddPages)
      .sort((a, b) => Number(b.id === here) - Number(a.id === here) || Number(b.kind === "personal") - Number(a.kind === "personal"));
    const create = t("palette.kwCreate");

    async function newPage(w: WorkspaceSummary) {
      const { page } = await api<{ page: PageSummary }>("/pages", { method: "POST", body: { workspaceId: w.id, parentId: null, title: "" } });
      await refresh();
      navigate(`/page/${page.id}`);
    }
    async function newDatabase(w: WorkspaceSummary) {
      const { database } = await api<{ database: { id: string } }>("/databases", {
        method: "POST",
        body: { workspaceId: w.id, parentId: null, title: "" },
      });
      await refresh();
      navigate(`/page/${database.id}`);
    }

    const actions: Action[] = [];
    spaces.forEach((w, i) => {
      const space = workspaceName(w);
      // The first one is simply "New page"; the others say where.
      actions.push({
        id: i === 0 ? "page.new" : `page.new:${w.id}`,
        title: () => (i === 0 ? t("page.new") : t("palette.newPageIn", { space })),
        keywords: () => `${create} ${space}`,
        section: "create",
        icon: <FilePlus size={16} />,
        run: () => newPage(w),
      });
    });
    spaces.forEach((w, i) => {
      const space = workspaceName(w);
      actions.push({
        id: i === 0 ? "database.new" : `database.new:${w.id}`,
        title: () => (i === 0 ? t("palette.newDatabase") : t("palette.newDatabaseIn", { space })),
        keywords: () => `${create} ${space} table`,
        section: "create",
        icon: <Database size={16} />,
        run: () => newDatabase(w),
      });
    });
    // A guest has no space of their own, nor an inbox: only the pages shared with them.
    const guest = user?.role === "guest";
    if (!guest) actions.push(
      {
        id: "capture",
        title: () => t("inbox.capture"),
        keywords: () => t("palette.kwCapture"),
        section: "create",
        icon: <Inbox size={16} />,
        shortcut: captureShortcutLabel(),
        run: capture,
      },
      { id: "space.new", title: () => t("workspace.new"), keywords: () => create, section: "create", icon: <Plus size={16} />, run: newSpace },
    );

    const go = (id: string, to: string, label: () => string, icon: React.ReactNode, when?: () => boolean): Action => ({
      id: `go:${id}`,
      title: () => t("palette.goTo", { place: label() }),
      keywords: () => t("palette.kwGo"),
      section: "go",
      icon,
      when,
      run: () => navigate(to),
    });
    actions.push(
      go("home", "/", () => t("home.title"), <Home size={16} />),
      go("reminders", "/reminders", () => t("reminders.title"), <Bell size={16} />),
      go("tasks", "/tasks", () => t("tasks.title"), <ListChecks size={16} />, () => !guest),
      go("library", "/pages", () => t("library.title"), <Library size={16} />, () => !guest),
      go("graph", "/graph", () => t("graph.title"), <Waypoints size={16} />, () => !guest),
      go("trash", "/trash", () => t("trash.title"), <Trash2 size={16} />, () => !guest),
      go(
        "sync",
        "/sync",
        () => t("sync.title"),
        <RefreshCw size={16} />,
        () => hasSync,
      ),
      go("account", "/account", () => t("account.title"), <User size={16} />),
      go(
        "admin",
        "/admin",
        () => t("admin.title"),
        <Settings size={16} />,
        () => user?.role === "admin",
      ),
    );

    actions.push(
      {
        id: "tour",
        title: () => t("tour.paletteAction"),
        keywords: () => t("tour.paletteKeywords"),
        section: "go",
        icon: <Sparkles size={16} />,
        when: () => !guest,
        run: startTour,
      },
      {
        id: "setup-assistant",
        title: () => t("setupWizard.paletteAction"),
        keywords: () => t("setupWizard.paletteKeywords"),
        section: "go",
        icon: <Wand2 size={16} />,
        when: () => user?.role === "admin",
        run: () => navigate("/admin/setup"),
      },
    );

    const themes: [ThemeChoice, () => string, React.ReactNode][] = [
      ["light", () => t("account.themeLight"), <Sun size={16} key="i" />],
      ["dark", () => t("account.themeDark"), <Moon size={16} key="i" />],
      ["system", () => t("account.themeSystem"), <Monitor size={16} key="i" />],
    ];
    for (const [choice, label, icon] of themes) {
      actions.push({
        id: `theme:${choice}`,
        title: () => t("palette.theme", { theme: label() }),
        keywords: () => t("palette.kwTheme"),
        section: "settings",
        icon,
        run: () => setTheme(choice),
      });
    }

    for (const locale of LOCALES) {
      actions.push({
        id: `language:${locale}`,
        title: () => t("palette.language", { language: localeLabel(locale) }),
        keywords: () => `${t("palette.kwLanguage")} language langue`,
        section: "settings",
        icon: <Globe size={16} />,
        when: () => locale !== currentLocale(),
        run: () => changeLanguage(locale),
      });
    }
    return actions;
  });
}

/** As in the account page: saved for the account, then everything is drawn again in the new language. */
async function changeLanguage(locale: Locale) {
  await api("/auth/me", { method: "PATCH", body: { locale } });
  setLocale(locale);
  window.location.reload();
}
