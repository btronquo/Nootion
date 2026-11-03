import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { UpdateStatus } from "@nootion/shared";
import { users } from "../db/schema.js";
import { parseBody, requireAdmin } from "../http.js";
import { currentVersion, isNewer } from "../updates.js";

/** Whether a newer Nootion is out, for administrators; each can stop being told about a given version. */
export const updateRoutes: FastifyPluginAsync = async (app) => {
  const { db, updates } = app;

  const status = (dismissed: string | null): UpdateStatus => {
    const current = currentVersion();
    const latest = updates.latest();
    const available = !!latest && isNewer(latest.version, current);
    return {
      current,
      checking: updates.enabled(),
      checkedAt: updates.checkedAt()?.toISOString() ?? null,
      latest,
      available,
      dismissed: available && dismissed === latest.version,
    };
  };

  app.get("/", async (req) => status(requireAdmin(req).dismissedUpdate));

  // "Check now".
  app.post(
    "/check",
    { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } },
    async (req) => {
      const admin = requireAdmin(req);
      await updates.check();
      return status(admin.dismissedUpdate);
    },
  );

  // Hides the warning for this version; a newer one shows it again.
  app.post("/dismiss", async (req) => {
    const admin = requireAdmin(req);
    const { version } = parseBody(
      z.object({ version: z.string().trim().min(1).max(50).nullable() }),
      req.body,
    );
    db.update(users)
      .set({ dismissedUpdate: version })
      .where(eq(users.id, admin.id))
      .run();
    return status(version);
  });
};
