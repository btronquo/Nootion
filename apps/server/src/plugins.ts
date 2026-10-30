import { decryptSecret, encryptSecret, secretKey } from "./secrets.js";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
import {
  pluginManifestSchema,
  registerFormulaFunction,
  type AdminPluginInfo,
  type ClientPluginInfo,
  type FValue,
  type PageRole,
  type PluginFormulaFunction,
  type PluginManifest,
  localizeBlock,
  localizeSetting,
  localized,
  currentLocale,
  type Locale,
} from "@nootion/shared";
import type { Db } from "./db/index.js";
import { attachments, pluginUserData, plugins } from "./db/schema.js";
import { attachmentPath, uploadsDir } from "./attachments.js";
import { HttpError, notFound, unauthorized } from "./http.js";
import { getPageRole, requirePageRole } from "./permissions.js";
import { t } from "@nootion/shared";

/** Built-in plugins ship next to the server code (src/ in dev, dist/ in the image). */
export function builtinPluginsDir(): string {
  if (process.env.BUILTIN_PLUGINS_DIR) return path.resolve(process.env.BUILTIN_PLUGINS_DIR);
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "../plugins");
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** What a plugin's route handler receives. */
export interface PluginRequest {
  /** The signed-in user, or null on public routes. */
  user: { id: string; name: string; email: string; role: "admin" | "member" } | null;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
}

/** A file a plugin's route sends back as is (e.g. an image), instead of JSON. */
export class PluginBinary {
  constructor(
    readonly data: Buffer | Readable,
    readonly contentType: string,
  ) {}
}

/** A file attached to a page, as the upload route returns it. */
export interface PluginAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
}

/** The object given to a plugin's server code: `export function activate(nootion) { … }`. */
export interface ServerPluginApi {
  id: string;
  /** Setting values (passwords decrypted). The plugin is restarted when they change. */
  settings: Record<string, unknown>;
  /** A folder of its own under /data, for files the plugin keeps. */
  dataDir: string;
  log: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
  /** Adds an API route, served at /api/plugins/<id><path>. Paths may hold parameters: /items/:itemId. */
  route: (method: Method, path: string, handler: (req: PluginRequest) => unknown, opts?: { public?: boolean }) => void;
  /** Runs a task every `ms` milliseconds (at least one second) while the plugin is enabled. */
  every: (ms: number, task: () => unknown) => void;
  /** Adds a formula function, computed on the server: register("tva", { min: 1, max: 1, help, run: ([x]) => x * 0.2 }). */
  formulaFunction: (name: string, spec: { min: number; max: number; help: string; run: (args: FValue[]) => FValue }) => void;
  /** Access checks: a plugin only shows users what they may see. */
  pages: { role: (userId: string, pageId: string) => PageRole | null };
  /** Throw this from a route to answer with an error status and message. */
  HttpError: typeof HttpError;
  /** Language of the user being served ("en", "fr"…), to write messages in it. */
  locale: () => Locale;
  /** What the plugin keeps for each user (an account on another service…), stored encrypted. Any JSON value. */
  userSecrets: {
    get: (userId: string) => unknown;
    set: (userId: string, value: unknown) => void;
    delete: (userId: string) => void;
  };
  /** Attaches a file to a page, as if the user had uploaded it (they must be able to edit the page). */
  attachments: {
    create: (input: { userId: string; pageId: string; filename: string; mimeType: string; data: Buffer | Readable | ReadableStream<Uint8Array> }) => Promise<PluginAttachment>;
  };
  /** Return this from a route to send a file (an image…) instead of JSON. */
  binary: (data: Buffer | Readable, contentType: string) => PluginBinary;
}

/** Types a plugin route may send to be shown in the browser; anything else is downloaded. */
const INLINE_PLUGIN_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);

interface Route {
  method: Method;
  parts: string[];
  handler: (req: PluginRequest) => unknown;
  public: boolean;
}

interface Runtime {
  routes: Route[];
  timers: NodeJS.Timeout[];
  formulas: { info: PluginFormulaFunction; remove: () => void }[];
  deactivate?: () => unknown;
}

interface Installed {
  manifest: PluginManifest;
  dir: string;
  builtin: boolean;
  runtime: Runtime | null;
  error: string | null;
}


export class PluginManager {
  private installed = new Map<string, Installed>();
  /** Plugin folders that couldn't be read, with why. */
  readonly broken: { dir: string; error: string }[] = [];
  private key: Buffer;
  private userKey: Buffer;

  constructor(
    private db: Db,
    private opts: {
      dirs: { path: string; builtin: boolean }[];
      dataDir: string;
      appSecret: string;
      log: FastifyBaseLogger;
      maxUploadMb: number;
      /** Called after a plugin attached a file (to read its text for search). */
      onAttachment?: () => void;
    },
  ) {
    this.key = secretKey(opts.appSecret, "nootion-plugin-settings");
    this.userKey = secretKey(opts.appSecret, "nootion-plugin-user-data");
  }

  /** Reads every manifest, then starts the enabled plugins. */
  async start() {
    for (const { path: root, builtin } of this.opts.dirs) {
      if (!fs.existsSync(root)) continue;
      for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(root, entry.name);
        const file = path.join(dir, "manifest.json");
        if (!fs.existsSync(file)) continue;
        try {
          const manifest = pluginManifestSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
          if (this.installed.has(manifest.id)) throw new Error(`plugin "${manifest.id}" is already installed elsewhere`);
          for (const f of [manifest.server, manifest.client]) if (f) this.resolveFile(dir, f);
          this.installed.set(manifest.id, { manifest, dir, builtin, runtime: null, error: null });
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          this.broken.push({ dir, error });
          this.opts.log.warn(`Plugin skipped (${dir}): ${error}`);
        }
      }
    }
    for (const p of this.installed.values()) if (this.isEnabled(p)) await this.activate(p);
  }

  async stop() {
    for (const p of this.installed.values()) await this.deactivate(p);
  }

  /** A file of the plugin; refuses paths that leave its folder. */
  private resolveFile(dir: string, file: string): string {
    const full = path.resolve(dir, file);
    if (!full.startsWith(dir + path.sep)) throw new Error(`file outside the plugin folder: ${file}`);
    if (!fs.existsSync(full)) throw new Error(`fichier introuvable : ${file}`);
    return full;
  }

  private row(id: string) {
    return this.db.select().from(plugins).where(eq(plugins.id, id)).get();
  }

  private isEnabled(p: Installed): boolean {
    const row = this.row(p.manifest.id);
    return row ? row.enabled : p.builtin && p.manifest.enabledByDefault;
  }

  // --- Settings ---------------------------------------------------------------------------------

  private encrypt(value: string): string {
    return encryptSecret(this.key, value);
  }

  private decrypt(value: string): string | null {
    return decryptSecret(this.key, value);
  }

  /** Setting values with defaults filled in and passwords decrypted. */
  private settingsOf(p: Installed): Record<string, unknown> {
    const stored = this.row(p.manifest.id)?.settings ?? {};
    const out: Record<string, unknown> = {};
    for (const s of p.manifest.settings) {
      const v = stored[s.key];
      if (s.type === "password") out[s.key] = typeof v === "string" ? this.decrypt(v) : null;
      else out[s.key] = v ?? s.default ?? (s.type === "boolean" ? false : null);
    }
    return out;
  }

  private checkValue(s: PluginManifest["settings"][number], v: string | number | boolean): string | number | boolean {
    const bad = () => new HttpError(400, "invalid_setting", t("error.invalidValue", { name: localized(s.label) }));
    switch (s.type) {
      case "boolean":
        if (typeof v !== "boolean") throw bad();
        return v;
      case "number":
        if (typeof v !== "number" || !Number.isFinite(v)) throw bad();
        return v;
      case "select":
        if (typeof v !== "string" || !s.options?.some((o) => o.value === v)) throw bad();
        return v;
      default:
        if (typeof v !== "string") throw bad();
        return v;
    }
  }

  // --- Lifecycle --------------------------------------------------------------------------------

  private async activate(p: Installed) {
    const runtime: Runtime = { routes: [], timers: [], formulas: [] };
    p.runtime = runtime;
    p.error = null;
    const id = p.manifest.id;
    if (!p.manifest.server) return;
    const dataDir = path.join(this.opts.dataDir, "plugin-data", id);
    const log = this.opts.log;
    const api: ServerPluginApi = {
      id,
      settings: this.settingsOf(p),
      dataDir,
      log: {
        info: (m) => log.info(`[plugin ${id}] ${m}`),
        warn: (m) => log.warn(`[plugin ${id}] ${m}`),
        error: (m) => log.error(`[plugin ${id}] ${m}`),
      },
      route: (method, routePath, handler, opts) => {
        if (!routePath.startsWith("/")) throw new Error('A route path starts with "/".');
        runtime.routes.push({ method, parts: routePath.split("/").filter(Boolean), handler, public: !!opts?.public });
      },
      every: (ms, task) => {
        const t = setInterval(
          () => {
            Promise.resolve()
              .then(task)
              .catch((e) => log.error(`[plugin ${id}] task: ${e instanceof Error ? e.message : e}`));
          },
          Math.max(1000, ms),
        );
        t.unref();
        runtime.timers.push(t);
      },
      formulaFunction: (name, spec) => {
        const remove = registerFormulaFunction(name, { min: spec.min, max: spec.max, help: spec.help, run: (args) => spec.run(args) });
        runtime.formulas.push({ info: { name, min: spec.min, max: spec.max === Infinity ? 99 : spec.max, help: spec.help }, remove });
      },
      pages: { role: (userId, pageId) => getPageRole(this.db, userId, pageId) },
      HttpError,
      locale: currentLocale,
      userSecrets: {
        get: (userId) => this.getUserSecret(id, userId),
        set: (userId, value) => this.setUserSecret(id, userId, value),
        delete: (userId) => {
          this.db
            .delete(pluginUserData)
            .where(and(eq(pluginUserData.pluginId, id), eq(pluginUserData.userId, userId)))
            .run();
        },
      },
      attachments: { create: (input) => this.createAttachment(input) },
      binary: (data, contentType) => new PluginBinary(data, contentType),
    };
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      // The query string makes Node load the code again after an update or a restart of the plugin.
      const mod = await import(`${pathToFileURL(this.resolveFile(p.dir, p.manifest.server)).href}?v=${Date.now()}`);
      const activate = mod.activate ?? mod.default;
      if (typeof activate !== "function") throw new Error("the server code must export an activate(nootion) function");
      const result = await activate(api);
      runtime.deactivate = typeof mod.deactivate === "function" ? mod.deactivate : typeof result === "function" ? result : undefined;
    } catch (e) {
      p.error = e instanceof Error ? e.message : String(e);
      log.error(`Plugin ${id}: failed to start: ${p.error}`);
      await this.deactivate(p);
      p.error ??= "failed to start";
    }
  }

  private async deactivate(p: Installed) {
    const r = p.runtime;
    if (!r) return;
    p.runtime = null;
    for (const t of r.timers) clearInterval(t);
    for (const f of r.formulas) f.remove();
    try {
      await r.deactivate?.();
    } catch (e) {
      this.opts.log.warn(`Plugin ${p.manifest.id}: error while stopping: ${e instanceof Error ? e.message : e}`);
    }
  }

  // --- Per-user data and files ----------------------------------------------------------------

  private getUserSecret(pluginId: string, userId: string): unknown {
    const row = this.db
      .select()
      .from(pluginUserData)
      .where(and(eq(pluginUserData.pluginId, pluginId), eq(pluginUserData.userId, userId)))
      .get();
    const text = row ? decryptSecret(this.userKey, row.value) : null;
    return text === null ? null : JSON.parse(text);
  }

  private setUserSecret(pluginId: string, userId: string, value: unknown) {
    const encrypted = encryptSecret(this.userKey, JSON.stringify(value ?? null));
    this.db
      .insert(pluginUserData)
      .values({ pluginId, userId, value: encrypted, updatedAt: new Date() })
      .onConflictDoUpdate({ target: [pluginUserData.pluginId, pluginUserData.userId], set: { value: encrypted, updatedAt: new Date() } })
      .run();
  }

  private async createAttachment(input: Parameters<ServerPluginApi["attachments"]["create"]>[0]): Promise<PluginAttachment> {
    requirePageRole(this.db, input.userId, input.pageId, "editor");
    const max = this.opts.maxUploadMb * 1024 * 1024;
    const source = Buffer.isBuffer(input.data) ? Readable.from([input.data]) : input.data instanceof Readable ? input.data : Readable.fromWeb(input.data as never);
    const id = randomUUID();
    fs.mkdirSync(uploadsDir(this.opts.dataDir), { recursive: true });
    const dest = attachmentPath(this.opts.dataDir, id);
    const tmp = `${dest}.part`;
    let size = 0;
    try {
      await pipeline(
        source,
        async function* (chunks: AsyncIterable<Buffer>) {
          for await (const chunk of chunks) {
            size += chunk.length;
            if (size > max) throw new HttpError(413, "too_large", t("error.fileTooLarge", { max: max / 1024 / 1024 }));
            yield chunk;
          }
        },
        fs.createWriteStream(tmp),
      );
      fs.renameSync(tmp, dest);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    const filename = (input.filename || "file").replace(/[\\/\r\n]/g, "_").slice(0, 255);
    const mimeType = input.mimeType.split(";")[0]!.trim().toLowerCase() || "application/octet-stream";
    this.db.insert(attachments).values({ id, pageId: input.pageId, filename, mimeType, size, createdBy: input.userId }).run();
    this.opts.onAttachment?.();
    return { id, filename, mimeType, size, url: `/api/attachments/${id}` };
  }

  // --- Admin ------------------------------------------------------------------------------------

  adminList(): AdminPluginInfo[] {
    return [...this.installed.values()].map((p) => {
      const stored = this.row(p.manifest.id)?.settings ?? {};
      const values: AdminPluginInfo["values"] = {};
      const current = this.settingsOf(p);
      for (const s of p.manifest.settings) {
        values[s.key] = s.type === "password" ? { set: typeof stored[s.key] === "string" } : (current[s.key] as string | number | boolean);
      }
      return {
        id: p.manifest.id,
        name: localized(p.manifest.name),
        version: p.manifest.version,
        description: localized(p.manifest.description),
        author: p.manifest.author ?? null,
        homepage: p.manifest.homepage ?? null,
        builtin: p.builtin,
        enabled: this.isEnabled(p),
        error: p.error,
        settings: p.manifest.settings.map(localizeSetting),
        values,
      };
    });
  }

  /** Turns a plugin on or off and / or changes its settings; a running plugin restarts with the new settings. */
  async update(id: string, input: { enabled?: boolean; values?: Record<string, string | number | boolean | null> }) {
    const p = this.installed.get(id);
    if (!p) throw notFound();
    const settings = { ...(this.row(id)?.settings ?? {}) };
    for (const [key, v] of Object.entries(input.values ?? {})) {
      const s = p.manifest.settings.find((x) => x.key === key);
      if (!s) throw new HttpError(400, "invalid_setting", t("error.unknownSetting", { key }));
      if (v === null) delete settings[key];
      else if (s.type === "password") settings[key] = this.encrypt(String(this.checkValue(s, v)));
      else settings[key] = this.checkValue(s, v);
    }
    const enabled = input.enabled ?? this.isEnabled(p);
    this.db
      .insert(plugins)
      .values({ id, enabled, settings, updatedAt: new Date() })
      .onConflictDoUpdate({ target: plugins.id, set: { enabled, settings, updatedAt: new Date() } })
      .run();
    await this.deactivate(p);
    p.error = null;
    if (enabled) await this.activate(p);
  }

  // --- Browser side -----------------------------------------------------------------------------

  /** Every installed plugin's blocks (so pages keep them even when a plugin is off), and the enabled ones' code. */
  clientList(): ClientPluginInfo[] {
    return [...this.installed.values()].map((p) => {
      const enabled = !!p.runtime;
      return {
        id: p.manifest.id,
        name: localized(p.manifest.name),
        version: p.manifest.version,
        enabled,
        clientUrl: enabled && p.manifest.client ? `/api/plugins/${p.manifest.id}/client.js?v=${encodeURIComponent(p.manifest.version)}` : null,
        blocks: p.manifest.blocks.map(localizeBlock),
        formulaFunctions: p.runtime?.formulas.map((f) => f.info) ?? [],
      };
    });
  }

  /** The browser code of an enabled plugin. */
  clientFile(id: string): string | null {
    const p = this.installed.get(id);
    if (!p?.runtime || !p.manifest.client) return null;
    return this.resolveFile(p.dir, p.manifest.client);
  }

  /** Serves /api/plugins/<id>/<path> from the plugin's routes. */
  async handle(id: string, rest: string, req: FastifyRequest, reply: FastifyReply) {
    const p = this.installed.get(id);
    if (!p?.runtime) throw notFound();
    const parts = rest.split("?")[0]!.split("/").filter(Boolean).map(decodeURIComponent);
    for (const route of p.runtime.routes) {
      if (route.method !== req.method || route.parts.length !== parts.length) continue;
      const params: Record<string, string> = {};
      const ok = route.parts.every((seg, i) => (seg.startsWith(":") ? ((params[seg.slice(1)] = parts[i]!), true) : seg === parts[i]));
      if (!ok) continue;
      if (!route.public && !req.user) throw unauthorized();
      const u = req.user;
      const result = await route.handler({
        user: u ? { id: u.id, name: u.name, email: u.email, role: u.role } : null,
        params,
        query: (req.query ?? {}) as Record<string, string>,
        body: req.body,
        headers: req.headers,
      });
      if (result instanceof PluginBinary) {
        const inline = INLINE_PLUGIN_TYPES.has(result.contentType);
        return reply
          .header("content-type", inline ? result.contentType : "application/octet-stream")
          .header("content-disposition", inline ? "inline" : "attachment")
          .header("x-content-type-options", "nosniff")
          .header("content-security-policy", "default-src 'none'; sandbox")
          .header("cache-control", "private, max-age=3600")
          .send(result.data);
      }
      return reply.send(result ?? { ok: true });
    }
    throw notFound();
  }
}
