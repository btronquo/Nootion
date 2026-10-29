import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { currentLocale, FormulaError, t, registerFormulaFunction, type ClientPluginInfo, type Locale } from "@nootion/shared";
import { api } from "../lib/api";

/** What a plugin block's component receives. */
export interface PluginBlockProps {
  /** The block's data, as last saved. */
  data: Record<string, unknown>;
  /** Saves new data for the block (it is stored in the page and shared live with other editors). */
  setData: (data: Record<string, unknown>) => void;
  /** False for readers and on public pages. */
  editable: boolean;
}

/** The object given to a plugin's browser code: `export function activate(nootion) { … }`. */
export interface ClientPluginApi {
  id: string;
  /** The app's React: plugins must use this one, not bundle their own. */
  React: typeof React;
  /** Calls one of the plugin's server routes: api("/preview?url=…"). */
  api: <T = unknown>(path: string, init?: { method?: string; body?: unknown }) => Promise<T>;
  /** Renders a block declared in the manifest. */
  registerBlock: (blockId: string, component: React.ComponentType<PluginBlockProps>) => void;
  /** Language of the interface ("en", "fr"…). The page reloads when it changes. */
  locale: Locale;
}

const renderers = new Map<string, React.ComponentType<PluginBlockProps>>();
const loaded = new Map<string, Promise<void>>();
const formulaStubs = new Map<string, () => void>();
const enabled = new Set<string>();

export const blockRenderer = (pluginId: string, blockId: string) => (enabled.has(pluginId) ? renderers.get(`${pluginId}.${blockId}`) : undefined);

async function loadClient(p: ClientPluginInfo) {
  const sdk: ClientPluginApi = {
    id: p.id,
    React,
    locale: currentLocale(),
    api: (path, init) => api(`/plugins/${p.id}${path}`, init),
    registerBlock: (blockId, component) => {
      renderers.set(`${p.id}.${blockId}`, component);
    },
  };
  try {
    const mod = await import(/* @vite-ignore */ p.clientUrl!);
    const activate = mod.activate ?? mod.default;
    if (typeof activate === "function") await activate(sdk);
  } catch (e) {
    // One broken plugin must not break the editor: its blocks show a placeholder.
    console.warn(`Plugin ${p.id}: could not load its browser code`, e);
  }
}

async function loadPlugins(): Promise<ClientPluginInfo[]> {
  const { plugins } = await api<{ plugins: ClientPluginInfo[] }>("/plugins");
  enabled.clear();
  for (const p of plugins) if (p.enabled) enabled.add(p.id);
  await Promise.all(
    plugins
      .filter((p) => p.enabled && p.clientUrl)
      .map((p) => {
        let promise = loaded.get(p.clientUrl!);
        if (!promise) loaded.set(p.clientUrl!, (promise = loadClient(p)));
        return promise;
      }),
  );
  // Formula functions of plugins are computed by the server; the editor only needs to know them.
  const names = new Set<string>();
  for (const f of plugins.flatMap((p) => p.formulaFunctions)) {
    names.add(f.name);
    if (formulaStubs.has(f.name)) continue;
    try {
      const run = () => {
        throw new FormulaError(t("formula.error.serverOnly", { name: f.name }));
      };
      formulaStubs.set(f.name, registerFormulaFunction(f.name, { min: f.min, max: f.max, help: f.help, run }));
    } catch {
      // Same name as a built-in function: the server refused it too.
    }
  }
  for (const [name, remove] of formulaStubs) if (!names.has(name)) (remove(), formulaStubs.delete(name));
  return plugins;
}

/** Installed plugins, with the browser code of the enabled ones loaded. Pages wait for it: their content may hold plugin blocks. */
export function usePlugins() {
  return useQuery({ queryKey: ["plugins"], queryFn: loadPlugins, staleTime: Infinity, retry: 5 });
}
