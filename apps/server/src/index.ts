import path from "node:path";
import { buildApp } from "./app.js";
import { purgeExpiredSessions } from "./auth/sessions.js";
import { purgeOldAuditEvents } from "./audit.js";
import { cleanOrphanFiles } from "./attachments.js";
import { fileStore } from "./files.js";
import { purgeOrphanViews } from "./databases.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db/index.js";

const config = loadConfig();
const db = openDb(path.join(config.dataDir, "nootion.db"));
const app = await buildApp({ db, config, logger: true });

// A bucket that can't be reached is said at once, rather than at the first upload.
const files = fileStore(config.dataDir);
try {
  await files.check();
} catch (err) {
  app.log.error(`Attached files: ${(err as Error).message}`);
  process.exit(1);
}
if (files.kind === "s3") app.log.info(`Attached files are kept in ${files.describe()}`);

purgeExpiredSessions(db);
void cleanOrphanFiles(db, config.dataDir).catch((err) => app.log.warn({ err }, "Couldn't remove orphan files"));
purgeOrphanViews(db);
purgeOldAuditEvents(db);
setInterval(() => {
  purgeExpiredSessions(db);
  purgeOrphanViews(db);
  purgeOldAuditEvents(db);
}, 60 * 60 * 1000).unref();

const shutdown = async () => {
  await app.close();
  db.$client.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Started by the desktop app: stop with it, even if it crashed and couldn't say so.
const parent = Number(process.env.NOOTION_DESKTOP_PARENT_PID);
if (config.desktop && parent > 0) {
  setInterval(() => {
    try {
      process.kill(parent, 0);
    } catch {
      void shutdown();
    }
  }, 5000).unref();
}

await app.listen({ port: config.port, host: config.host });
