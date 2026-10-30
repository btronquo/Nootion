import * as React from "react";
import { createRoot } from "react-dom/client";
import { useQuery } from "@tanstack/react-query";
import { currentLocale, FormulaError, t, registerFormulaFunction, type ClientPluginInfo, type Locale } from "@nootion/shared";
import { api } from "../lib/api";
import { Button, Modal } from "../components/ui";
import type { UploadedFile } from "../editor/upload";

/** What a plugin block's component receives. */
export interface PluginBlockProps {
  /** The block's data, as last saved. */
  data: Record<string, unknown>;
  /** Saves new data for the block (it is stored in the page and shared live with other editors). */
  setData: (data: Record<string, unknown>) => void;
  /** False for readers and on public pages. */
  editable: boolean;
}

/** What the cell of a plugin's column type receives. */
export interface PluginPropertyCellProps {
  /** The text the cell keeps (the plugin decides what it holds: a number, JSON…), or null when empty. */
  value: string | null;
  /** Saves a new value (null empties the cell). */
  setValue: (value: string | null) => void;
  /** False for readers and on public pages. */
  editable: boolean;
  /** "table": a compact cell, one line high. "panel": the properties of an opened row, or a card. */
  variant: "table" | "panel";
}

/** Somewhere else files can come from (a cloud drive…): offered next to "upload" in pages and "File" columns. */
export interface PluginFileSource {
  /** Shown as "From <label>" and as a "/" command. */
  label: string;
  /** An emoji. */
  icon?: string;
  /** Extra words that find it in the "/" menu. */
  keywords?: string;
  /** Lets the user pick files and attaches copies of them to the page; resolves with nothing when cancelled. */
  pick: (ctx: { pageId: string; multiple: boolean }) => Promise<UploadedFile[] | undefined | null>;
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
  /** Draws and edits the cells of a column type declared in the manifest. */
  registerPropertyType: (typeId: string, spec: { Cell: React.ComponentType<PluginPropertyCellProps> }) => void;
  /** Language of the interface ("en", "fr"…). The page reloads when it changes. */
  locale: Locale;
  /** Adds a place to pick files from. */
  registerFileSource: (source: PluginFileSource) => void;
  /** Pieces of the app's interface, so that plugins look like the rest of Nootion. */
  ui: {
    /** A dialog box: { title, onClose, wide, children }. */
    Modal: typeof Modal;
    /** A button: { variant: "primary" | "ghost" | "danger", ...button props }. */
    Button: typeof Button;
    /** Shows what `render` draws above the page, until it calls `close(value)`; resolves with that value. */
    showDialog: <T>(render: (close: (value?: T) => void) => React.ReactNode) => Promise<T | undefined>;
  };
}

/** Draws a dialog in a root of its own, outside the page's content (whose styles it must not inherit). */
function showDialog<T>(render: (close: (value?: T) => void) => React.ReactNode): Promise<T | undefined> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const close = (value?: T) => {
      root.unmount();
      host.remove();
      resolve(value);
    };
    root.render(React.createElement(React.Fragment, null, render(close)));
  });
}

const renderers = new Map<string, React.ComponentType<PluginBlockProps>>();
const loaded = new Map<string, Promise<void>>();
const formulaStubs = new Map<string, () => void>();
const enabled = new Set<string>();
const sources = new Map<string, PluginFileSource>();
const cells = new Map<string, React.ComponentType<PluginPropertyCellProps>>();

/** Places to pick files from, of enabled plugins. */
export const fileSources = () => [...sources.entries()].filter(([id]) => enabled.has(id)).map(([, s]) => s);

/** The cell component of a plugin's column type, when the plugin is on. */
export const propertyCell = (pluginId: string, typeId: string) => (enabled.has(pluginId) ? cells.get(`${pluginId}.${typeId}`) : undefined);

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
    registerPropertyType: (typeId, spec) => {
      cells.set(`${p.id}.${typeId}`, spec.Cell);
    },
    registerFileSource: (source) => {
      sources.set(p.id, source);
    },
    ui: { Modal, Button, showDialog },
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

/** Column types that enabled plugins add to databases. */
export function usePluginPropertyTypes() {
  const plugins = usePlugins().data ?? [];
  return plugins.filter((p) => p.enabled).flatMap((p) => p.propertyTypes.map((type) => ({ pluginId: p.id, ...type })));
}

/** Installed plugins, with the browser code of the enabled ones loaded. Pages wait for it: their content may hold plugin blocks. */
export function usePlugins() {
  return useQuery({ queryKey: ["plugins"], queryFn: loadPlugins, staleTime: Infinity, retry: 5 });
}
