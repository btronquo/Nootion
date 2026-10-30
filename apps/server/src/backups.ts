import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import yazl from "yazl";
import { backupScheduleInput, nextOccurrence, t, type BackupSchedule, type BackupScheduleInput } from "@nootion/shared";
import { HttpError } from "./http.js";
import { backupSchedules } from "./db/schema.js";
import { decryptSecret, encryptSecret, secretKey } from "./secrets.js";

const ROW = "default";
/** The copies this feature makes, and deletes when there are too many: nothing else in the folder is touched. */
const COPY = /^nootion-backup-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/;

/**
 * A full backup as a zip stream: a consistent copy of the database and every file of the data folder. Restoring =
 * unzipping into the data folder. `cleanup` removes the database copy once the zip is written.
 */
export async function fullBackupZip(app: FastifyInstance) {
  await app.collab.flushPendingStores();
  const dataDir = app.config.dataDir;
  const snapshot = path.join(dataDir, `.backup-${randomBytes(6).toString("hex")}.db`);
  await app.db.$client.backup(snapshot);
  const zip = new yazl.ZipFile();
  zip.addFile(snapshot, "nootion.db");
  const addDir = (dir: string, prefix: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) addDir(full, `${prefix}/${entry.name}`);
      else if (entry.isFile() && !entry.name.endsWith(".part")) zip.addFile(full, `${prefix}/${entry.name}`);
    }
  };
  for (const dir of ["uploads", "avatars", "plugins", "plugin-data"]) addDir(path.join(dataDir, dir), dir);
  // The keys devices receive reminders with: without them, each device would have to turn notifications on again.
  if (fs.existsSync(path.join(dataDir, "vapid.json"))) zip.addFile(path.join(dataDir, "vapid.json"), "vapid.json");
  zip.end();
  const cleanup = () => fs.rm(snapshot, { force: true }, () => {});
  zip.outputStream.on("end", cleanup).on("error", cleanup);
  return { stream: zip.outputStream as Readable, cleanup };
}

const pad = (n: number) => String(n).padStart(2, "0");
/** "nootion-backup-2026-11-02-0300.zip", in the schedule's time zone: copies sort by name. */
function copyName(at: Date, timeZone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return `nootion-backup-${p.year}-${p.month}-${p.day}-${pad(Number(p.hour) % 24)}${p.minute}.zip`;
}

/** When a schedule runs next, from now on; null when paused. */
export function nextBackup(s: BackupScheduleInput, now = new Date()): Date | null {
  if (!s.enabled) return null;
  return nextOccurrence(
    {
      frequency: s.frequency,
      interval: 1,
      weekdays: [s.weekday],
      monthDay: 1,
      time: s.time,
      timeZone: s.timeZone,
      startDate: "2000-01-03",
      parentId: null,
      dateProperty: null,
      enabled: true,
    },
    now,
  );
}

interface Webdav {
  url: string;
  username: string;
  password: string;
}

const folderUrl = (url: string) => (url.endsWith("/") ? url : `${url}/`);

async function davFetch(dav: Webdav, url: string, init: RequestInit & { duplex?: "half" } = {}) {
  const headers = { ...(init.headers as Record<string, string>), authorization: `Basic ${Buffer.from(`${dav.username}:${dav.password}`).toString("base64")}` };
  try {
    return await fetch(url, { ...init, headers, signal: AbortSignal.timeout(30 * 60_000) });
  } catch (err) {
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    throw new Error(`Can't reach ${new URL(url).host}: ${cause?.code ?? cause?.message ?? (err as Error).message}`);
  }
}

async function davCheck(res: Response, what: string) {
  if (res.ok) return res;
  const hint = res.status === 401 ? " (wrong user name or password?)" : res.status === 404 || res.status === 409 ? " (does the folder exist?)" : "";
  throw new Error(`${what}: HTTP ${res.status}${hint}`);
}

/** Puts a copy in a WebDAV folder (made if missing), and deletes the oldest copies beyond `keep`. */
async function toWebdav(dav: Webdav, file: string, name: string, keep: number) {
  const base = folderUrl(dav.url);
  // Made if missing; an existing folder answers 405.
  await davFetch(dav, base, { method: "MKCOL" }).catch(() => undefined);
  const size = fs.statSync(file).size;
  await davCheck(
    await davFetch(dav, base + encodeURIComponent(name), {
      method: "PUT",
      headers: { "content-type": "application/zip", "content-length": String(size) },
      body: Readable.toWeb(fs.createReadStream(file)) as ReadableStream,
      duplex: "half",
    }),
    "Upload",
  );
  const list = await davCheck(
    await davFetch(dav, base, {
      method: "PROPFIND",
      headers: { depth: "1", "content-type": "application/xml" },
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
    }),
    "Listing the folder",
  );
  const names = [...(await list.text()).matchAll(/<(?:\w+:)?href>([^<]+)<\/(?:\w+:)?href>/g)]
    .map((m) => decodeURIComponent(m[1]!.replace(/\/$/, "").split("/").pop() ?? ""))
    .filter((n) => COPY.test(n))
    .sort();
  for (const old of names.slice(0, Math.max(0, names.length - keep))) await davFetch(dav, base + encodeURIComponent(old), { method: "DELETE" });
}

/** Puts a copy in a folder of the server, and deletes the oldest copies beyond `keep`. */
async function toFolder(dir: string, file: string, name: string, keep: number) {
  if (!path.isAbsolute(dir)) throw new Error(`"${dir}" is not an absolute path.`);
  await fs.promises.mkdir(dir, { recursive: true });
  const part = path.join(dir, `${name}.part`);
  await fs.promises.copyFile(file, part);
  await fs.promises.rename(part, path.join(dir, name));
  const names = (await fs.promises.readdir(dir)).filter((n) => COPY.test(n)).sort();
  for (const old of names.slice(0, Math.max(0, names.length - keep))) await fs.promises.rm(path.join(dir, old), { force: true });
}

/** The automatic backups: their schedule, kept in the database, and the runs it sets off. */
export function createBackups(app: FastifyInstance) {
  const { db } = app;
  const key = secretKey(app.config.appSecret, "nootion-backups");
  let running: Promise<void> | null = null;

  const row = () => db.select().from(backupSchedules).where(eq(backupSchedules.id, ROW)).get();

  function get(): BackupSchedule | null {
    const r = row();
    if (!r) return null;
    const config = backupScheduleInput.parse(r.config);
    const { password: _, ...dest } = config.destination as BackupScheduleInput["destination"] & { password?: string };
    return {
      ...config,
      destination: dest.type === "webdav" ? { ...dest, hasPassword: !!r.secret } : dest,
      nextRunAt: r.nextRunAt?.toISOString() ?? null,
      lastRunAt: r.lastRunAt?.toISOString() ?? null,
      lastError: r.lastError,
      lastName: r.lastName,
      lastSize: r.lastSize,
    };
  }

  /** Saves the schedule; a WebDAV password left out keeps the saved one. */
  function save(input: BackupScheduleInput) {
    const old = row();
    let secret: string | null = null;
    if (input.destination.type === "webdav") {
      secret = input.destination.password ? encryptSecret(key, input.destination.password) : (old?.secret ?? null);
      if (!secret) throw new HttpError(400, "password_required", t("backup.passwordRequired"));
    }
    const config = input.destination.type === "webdav" ? { ...input, destination: { ...input.destination, password: undefined } } : input;
    const values = { config, secret, nextRunAt: nextBackup(input), updatedAt: new Date() };
    db.insert(backupSchedules)
      .values({ id: ROW, ...values })
      .onConflictDoUpdate({ target: backupSchedules.id, set: values })
      .run();
    return get()!;
  }

  function remove() {
    db.delete(backupSchedules).where(eq(backupSchedules.id, ROW)).run();
  }

  async function make(now: Date) {
    const r = row();
    if (!r) return;
    const config = backupScheduleInput.parse(r.config);
    const name = copyName(now, config.timeZone);
    const tmp = path.join(app.config.dataDir, `.${name}.part`);
    let error: string | null = null;
    let size: number | null = null;
    try {
      const { stream } = await fullBackupZip(app);
      await pipeline(stream, fs.createWriteStream(tmp));
      size = fs.statSync(tmp).size;
      const dest = config.destination;
      if (dest.type === "folder") await toFolder(dest.path, tmp, name, config.keep);
      else {
        const password = r.secret ? decryptSecret(key, r.secret) : null;
        if (!password) throw new Error("The WebDAV password can't be read any more (APP_SECRET changed?): type it again.");
        await toWebdav({ url: dest.url, username: dest.username, password }, tmp, name, config.keep);
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      app.log.warn({ err }, "The automatic backup failed");
    } finally {
      await fs.promises.rm(tmp, { force: true });
    }
    db.update(backupSchedules)
      .set({ lastRunAt: now, lastError: error, ...(error ? {} : { lastName: name, lastSize: size }) })
      .where(eq(backupSchedules.id, ROW))
      .run();
  }

  /** Makes a backup now (one at a time); `now` dates it. */
  function runNow(now = new Date()) {
    running ??= make(now).finally(() => (running = null));
    return running;
  }

  /** Makes the backup when its time came; a time missed while the server was off is made up once. */
  async function tick(now = new Date()) {
    const r = row();
    if (!r?.nextRunAt || r.nextRunAt > now) return;
    db.update(backupSchedules)
      .set({ nextRunAt: nextBackup(backupScheduleInput.parse(r.config), now) })
      .where(eq(backupSchedules.id, ROW))
      .run();
    await runNow(now);
  }

  const timer = setInterval(() => void tick().catch((err) => app.log.warn({ err }, "Couldn't check the backup schedule")), 60_000);
  timer.unref();
  return { get, save, remove, runNow, tick, stop: () => clearInterval(timer) };
}

export type Backups = ReturnType<typeof createBackups>;
