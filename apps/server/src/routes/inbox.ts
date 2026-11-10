import type { FastifyPluginAsync } from "fastify";
import { captureInput } from "@nootion/shared";
import { parseBody, requireUser } from "../http.js";
import { capture, ensureInbox, inboxItems } from "../inbox.js";
import { requirePageRole } from "../permissions.js";

/** Each user's inbox: quick notes, filed later. */
export const inboxRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  /** The inbox, for whoever may write in it: with an API token, one that reaches the personal space, read and write. */
  const inboxOf = (userId: string, min: "viewer" | "editor") => {
    const pageId = ensureInbox(db, userId);
    requirePageRole(db, userId, pageId, min);
    return pageId;
  };

  app.get("/inbox", async (req) => {
    const pageId = inboxOf(requireUser(req).id, "viewer");
    return { pageId, items: inboxItems(db, pageId) };
  });

  app.post("/inbox", async (req) => {
    const user = requireUser(req);
    inboxOf(user.id, "editor");
    return { page: await capture(db, app.collab, user.id, parseBody(captureInput, req.body)) };
  });
};
