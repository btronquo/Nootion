import type { FastifyPluginAsync } from "fastify";
import { backupScheduleInput } from "@nootion/shared";
import { parseBody, requireAdmin } from "../http.js";

/** The automatic backups, set by administrators. */
export const backupRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (req) => {
    requireAdmin(req);
  });

  app.get("/schedule", async () => ({ schedule: app.backups.get() }));

  app.put("/schedule", async (req) => ({ schedule: app.backups.save(parseBody(backupScheduleInput, req.body)) }));

  app.delete("/schedule", async () => {
    app.backups.remove();
    return { ok: true };
  });

  // Makes one now, to try the destination; answers once it is done.
  app.post("/run", async () => {
    await app.backups.runNow();
    return { schedule: app.backups.get() };
  });
};
