import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let boris: Client;
let personal: string;
let team: string;
let base: string;

beforeEach(async () => {
  app = await makeApp();
  boris = await setupAdmin(app);
  personal = await boris.personalWorkspace();
  team = (await boris.post("/api/workspaces", { name: "Équipe" })).json().workspace.id;
  base = await app.listen({ port: 0, host: "127.0.0.1" });
});

afterEach(async () => {
  await app.close();
});

async function token(workspaceIds: string[], readOnly: boolean) {
  return (await boris.post("/api/tokens", { name: "Claude", workspaceIds, readOnly, expiresInDays: null })).json().token as string;
}

async function connect(bearer: string) {
  const client = new McpClient({ name: "test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${bearer}` } } }));
  return client;
}

const call = async (client: McpClient, name: string, args: Record<string, unknown> = {}) => {
  const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  return { error: res.isError ?? false, text: res.content[0]!.text, json: () => JSON.parse(res.content[0]!.text) };
};

describe("MCP server", () => {
  it("refuses requests without a valid token, pointing to OAuth discovery", async () => {
    const res = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe('Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/mcp"');
    const bad = await fetch(`${base}/mcp`, { method: "POST", headers: { authorization: "Bearer nt_nope" }, body: "{}" });
    expect(bad.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("gives read-only tokens the reading tools only", async () => {
    const client = await connect(await token([personal], true));
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["search", "list_spaces", "list_pages", "read_page", "list_databases", "get_database", "query_database"]));
    expect(names).not.toContain("create_page");
    const full = await connect(await token([personal], false));
    expect((await full.listTools()).tools.map((t) => t.name)).toEqual(expect.arrayContaining(["create_page", "append_to_page", "add_database_row"]));
  });

  it("lists, creates, reads and writes pages within the token's spaces", async () => {
    await boris.createPage(team, "Hors de portée");
    const client = await connect(await token([personal], false));
    const spaces = (await call(client, "list_spaces")).json();
    expect(spaces).toEqual([{ id: personal, name: "Personal space", kind: "personal", role: "owner" }]);
    expect((await call(client, "list_pages", { spaceId: team })).error).toBe(true);

    const created = (await call(client, "create_page", { spaceId: personal, title: "Courses", markdown: "- [ ] Pain\n- [ ] Lait" })).json();
    await call(client, "append_to_page", { pageId: created.id, markdown: "Penser au **fromage**." });
    const read = await call(client, "read_page", { pageId: created.id });
    expect(read.text).toContain('"title": "Courses"');
    expect(read.text).toContain("- [ ] Pain");
    expect(read.text).toContain("Penser au **fromage**.");
    expect((await call(client, "list_pages", { spaceId: personal })).json().map((p: { title: string }) => p.title)).toContain("Courses");

    await call(client, "replace_page_content", { pageId: created.id, markdown: "# Liste\nTout est acheté." });
    expect((await boris.get(`/api/pages/${created.id}/content`)).json().markdown).toBe("# Liste\n\nTout est acheté.");

    // The versions it wrote are marked with the token's name; the activity log lists what it did.
    const versions = (await boris.get(`/api/pages/${created.id}/history`)).json().versions;
    expect(versions[0]).toMatchObject({ agent: "Claude", authors: [{ name: "Boris" }] });
    const activity = (await boris.get("/api/tokens/activity")).json().activity;
    expect(activity.map((a: { action: string }) => a.action)).toEqual(["content.replace", "content.append", "page.create"]);
    expect(activity[0]).toMatchObject({ agent: "Claude", pageId: created.id, pageTitle: "Courses" });
  });

  it("creates, fills and queries databases by column and option names", async () => {
    const client = await connect(await token([personal], false));
    const db = (
      await call(client, "create_database", {
        spaceId: personal,
        title: "Tâches",
        columns: [
          { name: "Statut", type: "select", options: ["À faire", "Fait"] },
          { name: "Échéance", type: "date" },
        ],
      })
    ).json();
    expect(db.columns.map((c: { name: string }) => c.name)).toEqual(["Nom", "Statut", "Échéance"]);
    const row = (await call(client, "add_database_row", { databaseId: db.id, values: { Nom: "Filtre", Statut: "À faire" }, markdown: "Réf. F-12" })).json();
    await call(client, "add_database_row", { databaseId: db.id, values: { Nom: "Pneus", Statut: "Fait" } });
    await call(client, "update_database_row", { databaseId: db.id, rowId: row.id, values: { Échéance: { start: "2026-11-15" } } });

    const open = (await call(client, "query_database", { databaseId: db.id, filters: [{ column: "Statut", operator: "is", value: "À faire" }] })).json();
    expect(open.total).toBe(1);
    expect(open.rows[0]).toMatchObject({ id: row.id, title: "Filtre", values: { Nom: "Filtre", Statut: "À faire", Échéance: { start: "2026-11-15" } } });

    const page = await call(client, "read_page", { pageId: row.id });
    expect(page.text).toContain('"Statut": "À faire"');
    expect(page.text).toContain("Réf. F-12");
    expect((await call(client, "get_database", { databaseId: db.id })).json()).toMatchObject({ rowCount: 2 });
  });

  it("reports API errors to the agent", async () => {
    const client = await connect(await token([personal], false));
    const res = await call(client, "read_page", { pageId: "nope" });
    expect(res.error).toBe(true);
    expect(res.text).toMatch(/introuvable|not found/i);
  });
});

describe("OAuth", () => {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const redirect = "https://claude.ai/api/mcp/auth_callback";

  const form = (body: Record<string, string>) =>
    app.inject({
      method: "POST",
      url: "/api/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams(body).toString(),
    });

  async function authorize(readOnly: boolean) {
    const reg = await app.inject({
      method: "POST",
      url: "/api/oauth/register",
      headers: { origin: "https://claude.ai" },
      payload: { client_name: "Claude", redirect_uris: [redirect] },
    });
    expect(reg.statusCode, reg.body).toBe(201);
    const clientId = reg.json().client_id as string;
    const info = await boris.get(`/api/oauth/clients/${clientId}?redirect_uri=${encodeURIComponent(redirect)}`);
    expect(info.json()).toEqual({ name: "Claude", redirectHost: "claude.ai" });
    const res = await boris.post("/api/oauth/authorize", {
      clientId,
      redirectUri: redirect,
      codeChallenge: challenge,
      state: "xyz",
      workspaceIds: [personal],
      readOnly,
    });
    expect(res.statusCode, res.body).toBe(200);
    const url = new URL(res.json().redirectUrl);
    expect(url.origin + url.pathname).toBe(redirect);
    expect(url.searchParams.get("state")).toBe("xyz");
    return { clientId, code: url.searchParams.get("code")! };
  }

  it("publishes its metadata", async () => {
    const resource = (await app.inject("/.well-known/oauth-protected-resource/mcp")).json();
    expect(resource).toMatchObject({ resource: "http://localhost:3000/mcp", authorization_servers: ["http://localhost:3000"] });
    const server = (await app.inject("/.well-known/oauth-authorization-server")).json();
    expect(server).toMatchObject({
      issuer: "http://localhost:3000",
      authorization_endpoint: "http://localhost:3000/oauth/authorize",
      token_endpoint: "http://localhost:3000/api/oauth/token",
      registration_endpoint: "http://localhost:3000/api/oauth/register",
      code_challenge_methods_supported: ["S256"],
    });
  });

  it("refuses redirect addresses that are not https or local", async () => {
    const res = await app.inject({ method: "POST", url: "/api/oauth/register", payload: { redirect_uris: ["http://evil.example.com/cb"] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_redirect_uri");
  });

  it("exchanges a code (with PKCE) for tokens limited as the user chose, then renews them", async () => {
    const { clientId, code } = await authorize(true);
    expect(
      (await form({ grant_type: "authorization_code", code, redirect_uri: redirect, client_id: clientId, code_verifier: "x".repeat(43) })).json().error,
    ).toBe("invalid_grant");
    // The code was spent by the failed attempt.
    const again = await authorize(true);
    const res = await form({ grant_type: "authorization_code", code: again.code, redirect_uri: redirect, client_id: again.clientId, code_verifier: verifier });
    expect(res.statusCode, res.body).toBe(200);
    const tokens = res.json();
    expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "read" });
    expect(
      (await form({ grant_type: "authorization_code", code: again.code, redirect_uri: redirect, client_id: again.clientId, code_verifier: verifier }))
        .statusCode,
    ).toBe(400);

    const client = await connect(tokens.access_token);
    expect((await client.listTools()).tools.map((t) => t.name)).not.toContain("create_page");
    expect((await call(client, "list_spaces")).json()).toHaveLength(1);

    const listed = (await boris.get("/api/tokens")).json().tokens;
    expect(listed).toEqual([expect.objectContaining({ name: "Claude", app: true, readOnly: true, workspaceIds: [personal] })]);

    const renewed = (await form({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: again.clientId })).json();
    expect(renewed.access_token).not.toBe(tokens.access_token);
    expect((await app.inject({ url: "/api/auth/me", headers: { authorization: `Bearer ${tokens.access_token}` } })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/auth/me", headers: { authorization: `Bearer ${renewed.access_token}` } })).statusCode).toBe(200);
    expect((await form({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: again.clientId })).json().error).toBe("invalid_grant");

    // Revoking from "My account" disconnects the app.
    await boris.delete(`/api/tokens/${listed[0].id}`);
    expect((await form({ grant_type: "refresh_token", refresh_token: renewed.refresh_token, client_id: again.clientId })).statusCode).toBe(400);
  });

  it("is not reachable with a token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/oauth/authorize",
      headers: { authorization: `Bearer ${await token([personal], false)}` },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });
});
