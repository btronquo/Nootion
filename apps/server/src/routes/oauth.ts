import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import { oauthAuthorizeInput, OAUTH_SCOPES, t } from "@nootion/shared";
import { HttpError, notFound, parseBody, requireUser } from "../http.js";
import { getWorkspaceRole } from "../permissions.js";
import { createCode, exchangeCode, getClient, OauthError, refreshToken, registerClient, revokeToken } from "../oauth.js";

// Apps reach these from anywhere (a browser-based client included), without cookies.
const cors = (reply: FastifyReply) =>
  reply
    .header("access-control-allow-origin", "*")
    .header("access-control-allow-methods", "GET, POST, OPTIONS")
    .header("access-control-allow-headers", "authorization, content-type, mcp-protocol-version, mcp-session-id")
    .header("access-control-expose-headers", "www-authenticate, mcp-session-id");

/** OAuth 2.1 discovery (RFC 9728 and RFC 8414), at the root of the server, for apps connecting to /mcp. */
export const oauthDiscoveryRoutes: FastifyPluginAsync = async (app) => {
  const base = app.config.appUrl;
  const resource = () => ({
    resource: `${base}/mcp`,
    authorization_servers: [base],
    scopes_supported: OAUTH_SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "Nootion",
  });
  const server = () => ({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: OAUTH_SCOPES,
  });
  for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
    app.get(path, async (_req, reply) => cors(reply).send(resource()));
  }
  for (const path of ["/.well-known/oauth-authorization-server", "/.well-known/oauth-authorization-server/mcp", "/.well-known/openid-configuration"]) {
    app.get(path, async (_req, reply) => cors(reply).send(server()));
  }
  app.options("/.well-known/*", async (_req, reply) => cors(reply).status(204).send());
};

const registerInput = z.object({
  redirect_uris: z.array(z.string().max(2000)).min(1).max(10),
  client_name: z.string().trim().max(100).optional(),
});

const tokenInput = z.discriminatedUnion("grant_type", [
  z.object({
    grant_type: z.literal("authorization_code"),
    code: z.string().min(1).max(200),
    redirect_uri: z.string().min(1).max(2000),
    client_id: z.string().min(1).max(200),
    code_verifier: z.string().min(43).max(128),
  }),
  z.object({
    grant_type: z.literal("refresh_token"),
    refresh_token: z.string().min(1).max(200),
    client_id: z.string().min(1).max(200),
  }),
]);

/** The OAuth server: registration, the user's consent, and tokens. */
export const oauthRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  // Token requests are sent as a form (RFC 6749).
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(body))));
  });

  const oauthError = (reply: FastifyReply, err: unknown) => {
    if (err instanceof OauthError) return reply.status(err.status).send({ error: err.code, error_description: err.message });
    if (err instanceof z.ZodError) return reply.status(400).send({ error: "invalid_request", error_description: z.prettifyError(err) });
    throw err;
  };

  app.options("/*", async (_req, reply) => cors(reply).status(204).send());

  app.post("/register", { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (req, reply) => {
    cors(reply);
    try {
      const input = registerInput.parse(req.body);
      const client = registerClient(db, { name: input.client_name || "App", redirectUris: input.redirect_uris });
      return reply.status(201).send({
        client_id: client.id,
        client_name: client.name,
        redirect_uris: client.redirectUris,
        client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      });
    } catch (err) {
      if (err instanceof z.ZodError) return reply.status(400).send({ error: "invalid_client_metadata", error_description: z.prettifyError(err) });
      return oauthError(reply, err);
    }
  });

  app.post("/token", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    cors(reply).header("cache-control", "no-store");
    try {
      const input = tokenInput.parse(req.body);
      return input.grant_type === "authorization_code"
        ? exchangeCode(db, { code: input.code, clientId: input.client_id, redirectUri: input.redirect_uri, verifier: input.code_verifier })
        : refreshToken(db, { refreshToken: input.refresh_token, clientId: input.client_id });
    } catch (err) {
      const grant = (req.body as { grant_type?: unknown } | null)?.grant_type;
      if (err instanceof z.ZodError && grant !== "authorization_code" && grant !== "refresh_token")
        return reply.status(400).send({ error: "unsupported_grant_type", error_description: "Use authorization_code or refresh_token." });
      return oauthError(reply, err);
    }
  });

  app.post("/revoke", async (req, reply) => {
    cors(reply);
    const token = (req.body as { token?: unknown } | null)?.token;
    if (typeof token === "string" && token) revokeToken(db, token);
    return reply.status(200).send({});
  });

  // For the consent page: the app asking, if it is known and may be sent back to that address.
  app.get<{ Params: { id: string }; Querystring: { redirect_uri?: string } }>("/clients/:id", async (req) => {
    requireUser(req);
    const client = getClient(db, req.params.id);
    if (!client || !client.redirectUris.includes(req.query.redirect_uri ?? "")) throw notFound();
    return { name: client.name, redirectHost: new URL(req.query.redirect_uri!).host };
  });

  // The user allowed the app: where to send them back, with a code.
  app.post("/authorize", async (req) => {
    const user = requireUser(req);
    const input = parseBody(oauthAuthorizeInput, req.body);
    const client = getClient(db, input.clientId);
    if (!client || !client.redirectUris.includes(input.redirectUri)) throw notFound();
    if (input.workspaceIds.some((id) => !getWorkspaceRole(db, user.id, id))) throw new HttpError(400, "bad_workspace", t("error.tokenWorkspace"));
    const url = new URL(input.redirectUri);
    url.searchParams.set("code", createCode(db, user.id, input));
    if (input.state) url.searchParams.set("state", input.state);
    url.searchParams.set("iss", app.config.appUrl);
    return { redirectUrl: url.toString() };
  });
};
