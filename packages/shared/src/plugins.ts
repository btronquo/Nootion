import { z } from "zod";

/** Plugin and block ids: lowercase letters, digits and "_" (they end up in node names and URLs). */
const pluginId = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, "Identifiant invalide (minuscules, chiffres et _ ; 2 à 40 caractères).");

export const PLUGIN_SETTING_TYPES = ["text", "password", "number", "boolean", "select"] as const;

export const pluginSettingSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/),
  label: z.string().min(1).max(100),
  type: z.enum(PLUGIN_SETTING_TYPES),
  help: z.string().max(500).optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  /** select: the choices. */
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
});
export type PluginSetting = z.infer<typeof pluginSettingSchema>;

export const pluginBlockSchema = z.object({
  id: pluginId,
  title: z.string().min(1).max(60),
  description: z.string().max(200).default(""),
  /** An emoji shown in the "/" menu. */
  icon: z.string().max(8).default("🧩"),
  /** Extra words that find the block in the "/" menu. */
  keywords: z.string().max(200).default(""),
  /** Data of a new block. */
  defaultData: z.record(z.string(), z.unknown()).default({}),
});
export type PluginBlock = z.infer<typeof pluginBlockSchema>;

/** Content of a plugin's manifest.json. */
export const pluginManifestSchema = z.object({
  id: pluginId,
  name: z.string().min(1).max(100),
  version: z.string().min(1).max(40),
  description: z.string().max(1000).default(""),
  author: z.string().max(200).optional(),
  homepage: z.string().url().optional(),
  /** Server code (ES module), relative to the plugin folder. */
  server: z.string().optional(),
  /** Browser code (ES module), relative to the plugin folder. */
  client: z.string().optional(),
  blocks: z.array(pluginBlockSchema).max(50).default([]),
  settings: z.array(pluginSettingSchema).max(50).default([]),
  /** Built-in plugins only: enabled until the admin turns it off. */
  enabledByDefault: z.boolean().default(false),
});
export type PluginManifest = z.infer<typeof pluginManifestSchema>;

/** A formula function added by a plugin (computed on the server). */
export interface PluginFormulaFunction {
  name: string;
  min: number;
  max: number;
  help: string;
}

/** What every page needs to know about plugins: blocks (for the editor schema) and browser code. */
export interface ClientPluginInfo {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  /** URL of the browser code, when enabled. */
  clientUrl: string | null;
  blocks: PluginBlock[];
  formulaFunctions: PluginFormulaFunction[];
}

/** A plugin as the admin sees it. */
export interface AdminPluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string | null;
  homepage: string | null;
  builtin: boolean;
  enabled: boolean;
  /** Load or start error, if any. */
  error: string | null;
  settings: PluginSetting[];
  /** Current values; passwords are never sent back, only whether one is set. */
  values: Record<string, string | number | boolean | { set: boolean }>;
}

export const updatePluginInput = z.object({
  enabled: z.boolean().optional(),
  /** Values by setting key. A password left out keeps its current value; null clears it. */
  values: z.record(z.string(), z.union([z.string().max(5000), z.number(), z.boolean(), z.null()])).optional(),
});

/** Name of the editor node of a plugin block. */
export const pluginNodeName = (pluginId: string, blockId: string) => `plugin_${pluginId}__${blockId}`;
