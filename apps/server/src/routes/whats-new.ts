import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import type { WhatsNew } from "@nootion/shared";
import { users } from "../db/schema.js";
import { requireUser } from "../http.js";
import { currentVersion } from "../updates.js";
import { changelog, releasesSince } from "../whats-new.js";

/** A release version ("3.3.0"), not a development build ("3.3.0-dev", "dev"). */
const isRelease = (v: string) => /^\d+\.\d+\.\d+$/.test(v);

/**
 * "What's new": the release notes of the versions this user hasn't seen yet, shown once after an update.
 * seenVersion is "" for an account created since this feature (nothing to show: it starts on this version)
 * and null for one from before (it sees the notes of the current version once).
 */
export const whatsNewRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  const markSeen = (userId: string, version: string) =>
    db.update(users).set({ seenVersion: version }).where(eq(users.id, userId)).run();

  app.get("/", async (req): Promise<WhatsNew> => {
    const user = requireUser(req);
    const current = currentVersion();
    if (!isRelease(current)) return { version: current, releases: [] };
    if (user.seenVersion === "") {
      markSeen(user.id, current);
      return { version: current, releases: [] };
    }
    return { version: current, releases: releasesSince(changelog(), user.seenVersion, current) };
  });

  // "Got it": not shown again until the next update.
  app.post("/seen", async (req) => {
    const user = requireUser(req);
    const current = currentVersion();
    if (isRelease(current)) markSeen(user.id, current);
    return { ok: true };
  });
};
