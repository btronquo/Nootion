import type { FastifyPluginAsync } from "fastify";
import { and, eq } from "drizzle-orm";
import { pushSubscriptionInput } from "@nootion/shared";
import { z } from "zod";
import { notFound, parseBody, requireUser } from "../http.js";
import { pushSubscriptions, reminders } from "../db/schema.js";
import { listReminders } from "../reminders.js";

/** The reminders set on dates in pages, and the devices that receive them as notifications. */
export const reminderRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  app.get("/", async (req) => ({ reminders: listReminders(db, requireUser(req).id) }));

  // Done: it leaves the list. Changing the date in the page brings it back.
  app.post<{ Params: { id: string } }>("/:id/dismiss", async (req) => {
    const user = requireUser(req);
    const done = db
      .update(reminders)
      .set({ dismissedAt: new Date() })
      .where(and(eq(reminders.id, req.params.id), eq(reminders.userId, user.id)))
      .returning({ id: reminders.id })
      .get();
    if (!done) throw notFound();
    return { ok: true };
  });

  app.get("/push-key", async (req) => {
    requireUser(req);
    return { publicKey: app.notifier.publicKey() };
  });

  app.post("/push-subscriptions", async (req) => {
    const user = requireUser(req);
    const input = parseBody(pushSubscriptionInput, req.body);
    db.insert(pushSubscriptions)
      .values({ endpoint: input.endpoint, userId: user.id, p256dh: input.keys.p256dh, auth: input.keys.auth })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: user.id, p256dh: input.keys.p256dh, auth: input.keys.auth } })
      .run();
    return { ok: true };
  });

  app.delete("/push-subscriptions", async (req) => {
    const user = requireUser(req);
    const { endpoint } = parseBody(z.object({ endpoint: z.string().min(1).max(2000) }), req.body);
    db.delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, user.id)))
      .run();
    return { ok: true };
  });
};
