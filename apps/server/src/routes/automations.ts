import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { asc, eq } from "drizzle-orm";
import { automationInput, t } from "@nootion/shared";
import { automations } from "../db/schema.js";
import { HttpError, notFound, parseBody, requireUser } from "../http.js";
import { requirePageRole } from "../permissions.js";
import { listProperties } from "../databases.js";
import { toAutomation } from "../automations.js";

/** A database's automations, set up by the people who may edit it. */
export const automationRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  function requireDatabase(userId: string, databaseId: string) {
    const { page } = requirePageRole(db, userId, databaseId, "editor");
    if (page.kind !== "database") throw notFound();
    return page;
  }

  /** The trigger's column must exist, with the right type. */
  function checkTrigger(databaseId: string, input: ReturnType<typeof automationInput.parse>) {
    if (input.trigger.type === "row_added") return;
    const prop = listProperties(db, databaseId).find((p) => p.id === (input.trigger as { propertyId: string }).propertyId);
    if (!prop || (input.trigger.type === "date_reached" && prop.type !== "date")) throw new HttpError(400, "bad_trigger", t("automation.badTrigger"));
  }

  app.get<{ Params: { id: string } }>("/databases/:id/automations", async (req) => {
    const user = requireUser(req);
    const database = requireDatabase(user.id, req.params.id);
    const list = db.select().from(automations).where(eq(automations.databaseId, database.id)).orderBy(asc(automations.createdAt)).all();
    return { automations: list.map((a) => toAutomation(db, a)) };
  });

  app.post<{ Params: { id: string } }>("/databases/:id/automations", async (req) => {
    const user = requireUser(req);
    const database = requireDatabase(user.id, req.params.id);
    const input = parseBody(automationInput, req.body);
    checkTrigger(database.id, input);
    const row = db
      .insert(automations)
      .values({
        id: randomUUID(),
        databaseId: database.id,
        name: input.name,
        enabled: input.enabled,
        trigger: input.trigger,
        steps: input.steps,
        createdBy: user.id,
      })
      .returning()
      .get();
    return { automation: toAutomation(db, row) };
  });

  function own(userId: string, id: string) {
    const row = db.select().from(automations).where(eq(automations.id, id)).get();
    if (!row) throw notFound();
    requireDatabase(userId, row.databaseId);
    return row;
  }

  // Whoever changes an automation becomes the one it runs as.
  app.put<{ Params: { id: string } }>("/automations/:id", async (req) => {
    const user = requireUser(req);
    const current = own(user.id, req.params.id);
    const input = parseBody(automationInput, req.body);
    checkTrigger(current.databaseId, input);
    const row = db
      .update(automations)
      .set({ name: input.name, enabled: input.enabled, trigger: input.trigger, steps: input.steps, createdBy: user.id })
      .where(eq(automations.id, current.id))
      .returning()
      .get();
    return { automation: toAutomation(db, row!) };
  });

  // Pausing doesn't change who it runs as.
  app.post<{ Params: { id: string } }>("/automations/:id/enabled", async (req) => {
    const user = requireUser(req);
    const current = own(user.id, req.params.id);
    const { enabled } = parseBody(automationInput.pick({ enabled: true }).required(), req.body);
    const row = db.update(automations).set({ enabled }).where(eq(automations.id, current.id)).returning().get();
    return { automation: toAutomation(db, row!) };
  });

  app.delete<{ Params: { id: string } }>("/automations/:id", async (req) => {
    const user = requireUser(req);
    const current = own(user.id, req.params.id);
    db.delete(automations).where(eq(automations.id, current.id)).run();
    return { ok: true };
  });
};
