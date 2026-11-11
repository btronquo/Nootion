import path from "node:path";
import { buildApp } from "./app.js";
import { purgeExpiredSessions } from "./auth/sessions.js";
import { cleanOrphanFiles } from "./attachments.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db/index.js";

const config = loadConfig();
const db = openDb(path.join(config.dataDir, "nootion.db"));
const app = await buildApp({ db, config, logger: true });

purgeExpiredSessions(db);
cleanOrphanFiles(db, config.dataDir);
setInterval(() => purgeExpiredSessions(db), 60 * 60 * 1000).unref();

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
