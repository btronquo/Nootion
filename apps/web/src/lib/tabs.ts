import { useSyncExternalStore } from "react";

/**
 * Tabs of open pages, as in a web browser (optional, see "Account › Appearance"). Each tab holds a place in the app;
 * following a link changes the current tab, Ctrl+click or a middle click opens another one. Pinned tabs come first,
 * show only their icon and keep their page: a link followed from one opens in another tab.
 *
 * Remembered on this device, for each account.
 */
export interface Tab {
  id: string;
  /** Path and query of the place it shows ("/page/…"). */
  path: string;
  pinned: boolean;
}

export interface TabsState {
  enabled: boolean;
  tabs: Tab[];
  /** The tab shown. */
  active: string | null;
  /** Where the next tab opened from the active one goes, so that several land in order after it, as in browsers. */
  insertAt?: number;
}

export const EMPTY: TabsState = { enabled: false, tabs: [], active: null };

let counter = 0;
const newId = () => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Pinned tabs first, the others after, each group in its order. */
function ordered(tabs: Tab[]): Tab[] {
  return [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)];
}

const pinnedCount = (tabs: Tab[]) => tabs.filter((t) => t.pinned).length;

/**
 * The app went to `path`, from a link, the browser's back button or a tab chosen: the active tab follows, unless it is
 * pinned (another tab opens, or the one already showing that place). With no tab yet, the first one opens.
 */
export function follow(state: TabsState, path: string): TabsState {
  const active = state.tabs.find((t) => t.id === state.active);
  if (active?.path === path) return state;
  if (!active) {
    const existing = state.tabs.find((t) => t.path === path);
    if (existing) return { ...state, active: existing.id, insertAt: undefined };
    const tab = { id: newId(), path, pinned: false };
    return { ...state, tabs: [...state.tabs, tab], active: tab.id, insertAt: undefined };
  }
  if (active.pinned) {
    const existing = state.tabs.find((t) => t.path === path);
    if (existing) return { ...state, active: existing.id, insertAt: undefined };
    const tab = { id: newId(), path, pinned: false };
    const tabs = [...state.tabs];
    tabs.splice(pinnedCount(tabs), 0, tab);
    return { ...state, tabs, active: tab.id, insertAt: undefined };
  }
  return { ...state, tabs: state.tabs.map((t) => (t === active ? { ...t, path } : t)), insertAt: undefined };
}

/** Shows a tab (the app then goes to its place). */
export function activate(state: TabsState, id: string): TabsState {
  if (!state.tabs.some((t) => t.id === id) || state.active === id) return state;
  return { ...state, active: id, insertAt: undefined };
}

/**
 * Opens `path` in a new tab after the active one (after those already opened from it), shown at once or in the
 * background. With no tab yet, the place on screen gets one first, so that it isn't lost.
 */
export function open(state: TabsState, path: string, opts: { background?: boolean; current?: string } = {}): TabsState {
  let s = state;
  if (!s.tabs.length && opts.current) s = follow(s, opts.current);
  const index = s.tabs.findIndex((t) => t.id === s.active);
  const at = Math.max(pinnedCount(s.tabs), s.insertAt ?? (index < 0 ? s.tabs.length : index + 1));
  const tab = { id: newId(), path, pinned: false };
  const tabs = [...s.tabs];
  tabs.splice(at, 0, tab);
  return opts.background ? { ...s, tabs, insertAt: at + 1 } : { ...s, tabs, active: tab.id, insertAt: undefined };
}

/** Closes tabs; when the active one goes, the next one on its right (or else its left) is shown. */
export function close(state: TabsState, ids: string[]): TabsState {
  const gone = new Set(ids);
  const tabs = state.tabs.filter((t) => !gone.has(t.id));
  if (tabs.length === state.tabs.length) return state;
  let active = state.active;
  if (active && gone.has(active)) {
    const index = state.tabs.findIndex((t) => t.id === active);
    const next = state.tabs.slice(index + 1).find((t) => !gone.has(t.id)) ?? [...state.tabs.slice(0, index)].reverse().find((t) => !gone.has(t.id));
    active = next?.id ?? null;
  }
  return { ...state, tabs, active, insertAt: undefined };
}

/** The tabs closed by "Close other tabs": all the others but the pinned ones. */
export const othersOf = (state: TabsState, id: string) => state.tabs.filter((t) => t.id !== id && !t.pinned).map((t) => t.id);

/** The tabs closed by "Close tabs to the right" (not pinned ones). */
export function rightOf(state: TabsState, id: string) {
  const index = state.tabs.findIndex((t) => t.id === id);
  return state.tabs.slice(index + 1).filter((t) => !t.pinned).map((t) => t.id);
}

/** Pins a tab (it goes at the end of the pinned ones) or unpins it (it goes first after them). */
export function togglePin(state: TabsState, id: string): TabsState {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab) return state;
  const rest = state.tabs.filter((t) => t !== tab);
  const moved = { ...tab, pinned: !tab.pinned };
  const tabs = [...rest];
  tabs.splice(pinnedCount(rest), 0, moved);
  return { ...state, tabs, insertAt: undefined };
}

/**
 * Moves a tab before or after another one. Dropped among the pinned tabs it is pinned, among the others it is not:
 * as in browsers, the pinned ones stay together on the left.
 */
export function move(state: TabsState, id: string, target: string | null, after: boolean): TabsState {
  if (id === target) return state;
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab) return state;
  const rest = state.tabs.filter((t) => t !== tab);
  const goal = target ? rest.find((t) => t.id === target) : undefined;
  const pinned = goal ? goal.pinned : false;
  const tabs = [...rest];
  const index = goal ? rest.indexOf(goal) + (after ? 1 : 0) : rest.length;
  tabs.splice(index, 0, { ...tab, pinned });
  return { ...state, tabs: ordered(tabs), insertAt: undefined };
}

/** Opens `path` in a new tab put next to another one (a page dragged from the sidebar onto the tabs). */
export function insertNear(state: TabsState, path: string, target: string | null, after: boolean, current?: string): TabsState {
  const opened = open({ ...state, insertAt: undefined }, path, { current });
  const id = opened.active!;
  return { ...move(opened, id, target, after), active: id };
}

/* The store, shared by the tab bar, the account page and the menus. */

const ENABLED_KEY = "nootion-tabs-enabled:";
const TABS_KEY = "nootion-tabs:";
let user: string | null = null;
let state: TabsState = EMPTY;
const listeners = new Set<() => void>();

function read(userId: string): TabsState {
  try {
    const enabled = localStorage.getItem(ENABLED_KEY + userId) === "1";
    const saved = JSON.parse(localStorage.getItem(TABS_KEY + userId) ?? "null") as Partial<TabsState> | null;
    const tabs = Array.isArray(saved?.tabs)
      ? saved.tabs.filter((t): t is Tab => !!t && typeof t.id === "string" && typeof t.path === "string").map((t) => ({ id: t.id, path: t.path, pinned: !!t.pinned }))
      : [];
    const active = tabs.some((t) => t.id === saved?.active) ? saved!.active! : null;
    return { enabled, tabs: ordered(tabs), active };
  } catch {
    return EMPTY;
  }
}

function save() {
  if (!user) return;
  try {
    localStorage.setItem(ENABLED_KEY + user, state.enabled ? "1" : "0");
    if (state.tabs.length) localStorage.setItem(TABS_KEY + user, JSON.stringify({ tabs: state.tabs, active: state.active }));
    else localStorage.removeItem(TABS_KEY + user);
  } catch {
    // Private browsing: kept for this visit only.
  }
}

/**
 * The signed-in account, whose tabs are shown. Called while the app shell is drawn, before what shows the tabs:
 * they read the new state as they are drawn, so nothing needs telling.
 */
export function setTabsUser(userId: string | null) {
  if (userId === user) return;
  user = userId;
  state = userId ? read(userId) : EMPTY;
}

export function updateTabs(change: (s: TabsState) => TabsState) {
  const next = change(state);
  if (next === state) return;
  state = next;
  save();
  listeners.forEach((l) => l());
}

export const getTabs = () => state;

/** Shows or hides the tab bar; its tabs are kept for when it comes back. */
export function setTabsEnabled(enabled: boolean) {
  updateTabs((s) => (s.enabled === enabled ? s : { ...s, enabled }));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another window of the app (same account) changed them.
  const onStorage = (e: StorageEvent) => {
    if (!user || (e.key !== TABS_KEY + user && e.key !== ENABLED_KEY + user)) return;
    const fresh = read(user);
    // The tabs and the switch follow; each window keeps its own tab shown.
    state = { ...fresh, active: fresh.tabs.some((t) => t.id === state.active) ? state.active : fresh.active };
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useTabs(): TabsState {
  return useSyncExternalStore(subscribe, getTabs);
}
