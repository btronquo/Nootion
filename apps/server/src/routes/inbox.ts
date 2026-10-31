import type { FastifyPluginAsync } from "fastify";
import { captureInput } from "@nootion/shared";
import { parseBody, requireUser } from "../http.js";
import { capture, ensureInbox, inboxItems } from "../inbox.js";

/** Each user's inbox: quick notes, filed later. */
export const inboxRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  app.get("/inbox", async (req) => {
    const pageId = ensureInbox(db, requireUser(req).id);
    return { pageId, items: inboxItems(db, pageId) };
  });

  app.post("/inbox", async (req) => {
    const user = requireUser(req);
    return { page: await capture(db, app.collab, user.id, parseBody(captureInput, req.body)) };
  });
};
