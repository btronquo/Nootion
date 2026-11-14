import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * The actions of the command palette (Ctrl+K). Each part of the app registers the ones it offers where it is
 * shown (the app's frame its general ones, an open page its own), so that an action is written once and the
 * palette lists exactly what can be done on the screen.
 */
export type ActionSection = "page" | "create" | "go" | "settings";

export interface Action {
  /** Stable, to remember the most recently used ones. */
  id: string;
  /** In the user's language, read when the palette is drawn. */
  title: () => string;
  /** More words that find it (in the user's language too). */
  keywords?: () => string;
  section: ActionSection;
  icon?: ReactNode;
  /** The keyboard shortcut that does the same, shown beside it. */
  shortcut?: string;
  /** Hides it when it can't be done right now. */
  when?: () => boolean;
  run: () => void | Promise<unknown>;
}

const providers = new Map<string, () => Action[]>();

/** Adds actions until the returned function is called. */
export function registerActions(owner: string, actions: () => Action[]): () => void {
  providers.set(owner, actions);
  return () => {
    if (providers.get(owner) === actions) providers.delete(owner);
  };
}

/** The actions offered by a component while it is shown; `build` is read again each time the palette opens. */
export function useRegisterActions(build: () => Action[]) {
  const owner = useId();
  const latest = useRef(build);
  latest.current = build;
  useEffect(() => registerActions(owner, () => latest.current()), [owner]);
}

/** Every action that can be done now, page actions first. */
export function currentActions(): Action[] {
  const order: ActionSection[] = ["page", "create", "go", "settings"];
  const all = [...providers.values()].flatMap((p) => p()).filter((a) => !a.when || a.when());
  return order.flatMap((section) => all.filter((a) => a.section === section));
}

/** Lower case, without accents: "Créer" is found by "creer". */
export const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();

/**
 * The actions that match what was typed: every word must be found in the title or the keywords. Those whose
 * title starts with the words come first, and among equals the most recently used.
 */
export function matchActions(actions: Action[], query: string, recent: readonly string[] = []): Action[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  const rank = (a: Action) => {
    const i = recent.indexOf(a.id);
    return i === -1 ? recent.length : i;
  };
  if (!words.length) {
    // Nothing typed: the most recent first, then in their usual order.
    return actions
      .map((a, i) => ({ a, i }))
      .sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i)
      .map((x) => x.a);
  }
  const scored: { a: Action; score: number; i: number }[] = [];
  actions.forEach((a, i) => {
    const title = normalize(a.title());
    const haystack = `${title} ${normalize(a.keywords?.() ?? "")}`;
    if (!words.every((w) => haystack.includes(w))) return;
    const titleWords = title.split(/[\s/,.:()«»"']+/);
    let score = 0;
    if (title.startsWith(words.join(" "))) score += 4;
    for (const w of words) {
      if (titleWords.some((tw) => tw.startsWith(w))) score += 2;
      else if (title.includes(w)) score += 1;
    }
    scored.push({ a, score, i });
  });
  return scored.sort((x, y) => y.score - x.score || rank(x.a) - rank(y.a) || x.i - y.i).map((x) => x.a);
}

const RECENT_KEY = "nootion-recent-actions";
const RECENT_MAX = 8;

/** The ids of the actions used lately, the latest first (kept by this browser). */
export function recentActions(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function rememberAction(id: string) {
  try {
    const list = [id, ...recentActions().filter((x) => x !== id)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Not remembered: storage is blocked.
  }
}

/** Does the action and remembers it as the most recent. */
export function runAction(action: Action) {
  rememberAction(action.id);
  void Promise.resolve()
    .then(action.run)
    .catch((e: unknown) => alert(e instanceof Error ? e.message : String(e)));
}
