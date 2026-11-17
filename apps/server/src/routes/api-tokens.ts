import type { FastifyPluginAsync } from "fastify";
import { createApiTokenInput, t } from "@nootion/shared";
import { HttpError, notFound, parseBody, requireUser } from "../http.js";
import { getWorkspaceRole } from "../permissions.js";
import { createApiToken, deleteApiToken, listActivity, listApiTokens } from "../api-tokens.js";
import { audit } from "../audit.js";

/** The user's personal API tokens, managed from "My account" (never with a token). */
export const apiTokenRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  app.get("/", async (req) => ({ tokens: listApiTokens(db, requireUser(req).id) }));

  // What apps and agents changed with the user's tokens, latest first.
  app.get("/activity", async (req) => ({ activity: listActivity(db, requireUser(req).id) }));

  app.post("/", async (req) => {
    const user = requireUser(req);
    const input = parseBody(createApiTokenInput, req.body);
    if (input.workspaceIds.some((id) => !getWorkspaceRole(db, user.id, id))) throw new HttpError(400, "bad_workspace", t("error.tokenWorkspace"));
    const created = createApiToken(db, user.id, input);
    audit(db, req, { action: "account.token_created", target: { type: "token", id: created.apiToken.id, label: input.name }, details: { readOnly: input.readOnly, spaces: input.workspaceIds.length } });
    return created;
  });

  app.delete<{ Params: { id: string } }>("/:id", async (req) => {
    const user = requireUser(req);
    const name = listApiTokens(db, user.id).find((tk) => tk.id === req.params.id)?.name ?? null;
    if (!deleteApiToken(db, user.id, req.params.id)) throw notFound();
    audit(db, req, { action: "account.token_revoked", target: { type: "token", id: req.params.id, label: name } });
    return { ok: true };
  });
};
