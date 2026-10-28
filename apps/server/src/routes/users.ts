import type { FastifyPluginAsync } from "fastify";
import type { UserDirectoryEntry } from "@nootion/shared";
import { eq } from "drizzle-orm";
import { users } from "../db/schema.js";
import { requireUser } from "../http.js";

export const userRoutes: FastifyPluginAsync = async (app) => {
  // Directory of active accounts on this instance, used to pick people when sharing.
  app.get("/", async (req) => {
    requireUser(req);
    const list: UserDirectoryEntry[] = app.db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.disabled, false))
      .orderBy(users.name)
      .all();
    return { users: list };
  });
};
