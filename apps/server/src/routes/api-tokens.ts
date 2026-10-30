import type { FastifyPluginAsync } from "fastify";
import { createApiTokenInput, t } from "@nootion/shared";
import { HttpError, notFound, parseBody, requireUser } from "../http.js";
import { getWorkspaceRole } from "../permissions.js";
import { createApiToken, deleteApiToken, listApiTokens } from "../api-tokens.js";

/** The user's personal API tokens, managed from "My account" (never with a token). */
export const apiTokenRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  app.get("/", async (req) => ({ tokens: listApiTokens(db, requireUser(req).id) }));

  app.post("/", async (req) => {
    const user = requireUser(req);
    const input = parseBody(createApiTokenInput, req.body);
    if (input.workspaceIds.some((id) => !getWorkspaceRole(db, user.id, id))) throw new HttpError(400, "bad_workspace", t("error.tokenWorkspace"));
    return createApiToken(db, user.id, input);
  });

  app.delete<{ Params: { id: string } }>("/:id", async (req) => {
    if (!deleteApiToken(db, requireUser(req).id, req.params.id)) throw notFound();
    return { ok: true };
  });
};
