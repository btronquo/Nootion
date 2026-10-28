import path from "node:path";
import { buildApp } from "./app.js";
import { purgeExpiredSessions } from "./auth/sessions.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db/index.js";

const config = loadConfig();
const db = openDb(path.join(config.dataDir, "nootion.db"));
const app = await buildApp({ db, config, logger: true });

purgeExpiredSessions(db);
setInterval(() => purgeExpiredSessions(db), 60 * 60 * 1000).unref();

const shutdown = async () => {
  await app.close();
  db.$client.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ port: config.port, host: config.host });
