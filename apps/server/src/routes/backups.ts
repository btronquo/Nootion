import type { FastifyPluginAsync } from "fastify";
import { backupScheduleInput } from "@nootion/shared";
import { parseBody, requireAdmin } from "../http.js";
import { audit, changedKeys, settingsTarget } from "../audit.js";
import { fileStore } from "../files.js";

/** The automatic backups, set by administrators. */
export const backupRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (req) => {
    requireAdmin(req);
  });

  // `filesBucket`: attached files kept in a bucket, which backups leave out.
  app.get("/schedule", async () => {
    const files = fileStore(app.config.dataDir);
    return { schedule: app.backups.get(), filesBucket: files.kind === "s3" ? files.describe() : null };
  });

  app.put("/schedule", async (req) => {
    const before = app.backups.get();
    const schedule = app.backups.save(parseBody(backupScheduleInput, req.body));
    audit(app.db, req, { action: "settings.changed", target: settingsTarget("backups"), details: { keys: changedKeys(before, schedule) } });
    return { schedule };
  });

  app.delete("/schedule", async (req) => {
    app.backups.remove();
    audit(app.db, req, { action: "settings.changed", target: settingsTarget("backups"), details: { removed: true } });
    return { ok: true };
  });

  // Makes one now, to try the destination; answers once it is done.
  app.post("/run", async (req) => {
    audit(app.db, req, { action: "backup.run" });
    await app.backups.runNow();
    return { schedule: app.backups.get() };
  });
};
