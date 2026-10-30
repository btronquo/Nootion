import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { apiTokens } from "../src/db/schema.js";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let boris: Client;
let personal: string;
let team: string;

beforeEach(async () => {
  app = await makeApp();
  boris = await setupAdmin(app);
  personal = await boris.personalWorkspace();
  team = (await boris.post("/api/workspaces", { name: "Équipe" })).json().workspace.id;
});

afterEach(async () => {
  await app.close();
});

/** A client that authenticates with a personal token instead of the session cookie. */
class TokenClient extends Client {
  constructor(
    app: FastifyInstance,
    private token: string,
  ) {
    super(app);
  }
  request(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    return super.request(method, url, body, { authorization: `Bearer ${this.token}`, ...headers });
  }
}

async function makeToken(workspaceIds: string[], readOnly: boolean, expiresInDays: number | null = null) {
  const res = await boris.post("/api/tokens", { name: "Script", workspaceIds, readOnly, expiresInDays });
  expect(res.statusCode, res.body).toBe(200);
  return { client: new TokenClient(app, res.json().token), ...res.json() };
}

describe("personal API tokens", () => {
  it("are created, listed without their secret, and revoked", async () => {
    const { token, apiToken } = await makeToken([personal], true, 30);
    expect(token).toMatch(/^nt_[A-Za-z0-9_-]{40,}$/);
    expect(apiToken).toMatchObject({ name: "Script", workspaceIds: [personal], readOnly: true, lastUsedAt: null });
    const list = (await boris.get("/api/tokens")).json().tokens;
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(token);
    expect(list[0].prefix).toBe(token.slice(0, 9));

    const api = new TokenClient(app, token);
    expect((await api.get("/api/auth/me")).json().user.name).toBe("Boris");
    expect((await boris.get("/api/tokens")).json().tokens[0].lastUsedAt).not.toBeNull();

    expect((await boris.delete(`/api/tokens/${apiToken.id}`)).statusCode).toBe(200);
    expect((await api.get("/api/auth/me")).statusCode).toBe(401);
  });

  it("only reach spaces the user belongs to", async () => {
    const alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
    const theirs = await alice.personalWorkspace();
    expect((await boris.post("/api/tokens", { name: "x", workspaceIds: [theirs], readOnly: true, expiresInDays: null })).statusCode).toBe(400);
  });

  it("refuse unknown, expired tokens and disabled users", async () => {
    expect((await new TokenClient(app, "nt_nope").get("/api/auth/me")).statusCode).toBe(401);
    const { client, apiToken } = await makeToken([personal], true);
    app.db
      .update(apiTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(apiTokens.id, apiToken.id))
      .run();
    const res = await client.get("/api/auth/me");
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("bad_token");
  });

  it("can't manage the account, tokens, sharing or the administration", async () => {
    const { client } = await makeToken([personal, team], false);
    const page = await boris.createPage(personal, "Notes");
    for (const [method, url] of [
      ["GET", "/api/tokens"],
      ["POST", "/api/tokens"],
      ["PATCH", "/api/auth/me"],
      ["GET", "/api/admin/users"],
      ["GET", `/api/pages/${page}/shares`],
      ["PUT", `/api/pages/${page}/public-link`],
      ["DELETE", `/api/pages/${page}/permanent`],
      ["GET", "/api/pages/shared"],
      ["GET", "/api/reminders"],
    ]) {
      const res = await client.request(method!, url!, method === "GET" ? undefined : {});
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(res.json().error).toBe("token_not_allowed");
    }
  });

  it("stay within their spaces", async () => {
    const mine = await boris.createPage(personal, "Recettes de cuisine");
    const other = await boris.createPage(team, "Recettes de l'équipe");
    await boris.put(`/api/pages/${mine}/content`, { markdown: "Tarte aux pommes" });
    await boris.put(`/api/pages/${other}/content`, { markdown: "Tarte aux poires" });
    const { client } = await makeToken([personal], false);

    expect((await client.get("/api/workspaces")).json().workspaces.map((w: { id: string }) => w.id)).toEqual([personal]);
    expect((await client.get(`/api/pages/${mine}`)).statusCode).toBe(200);
    expect((await client.get(`/api/pages/${other}`)).statusCode).toBe(404);
    expect((await client.get(`/api/workspaces/${team}/pages`)).statusCode).toBe(404);
    expect((await client.post("/api/pages", { workspaceId: team, title: "x" })).statusCode).toBe(404);
    const found = (await client.get("/api/search?q=tarte")).json().results.map((r: { id: string }) => r.id);
    expect(found).toEqual([mine]);
    // The same user, with the app, still sees everything.
    expect((await boris.get("/api/search?q=tarte")).json().results).toHaveLength(2);
  });

  it("read only when they are read-only", async () => {
    const page = await boris.createPage(personal, "Notes");
    const { client } = await makeToken([personal], true);
    const detail = await client.get(`/api/pages/${page}`);
    expect(detail.json().page.role).toBe("viewer");
    for (const [method, url, body] of [
      ["POST", "/api/pages", { workspaceId: personal, title: "x" }],
      ["PATCH", `/api/pages/${page}`, { title: "x" }],
      ["PUT", `/api/pages/${page}/content`, { markdown: "x" }],
      ["DELETE", `/api/pages/${page}`, undefined],
    ] as const) {
      const res = await client.request(method, url, body);
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(res.json().error).toBe("token_read_only");
    }
    // Querying a database is reading.
    const database = (await boris.post("/api/databases", { workspaceId: personal, parentId: null, title: "Tâches" })).json().database.id;
    expect((await client.post(`/api/databases/${database}/query`, {})).statusCode).toBe(200);
  });
});

describe("page content", () => {
  it("is written and read as Markdown", async () => {
    const { client } = await makeToken([personal], false);
    const created = await client.post("/api/pages", {
      workspaceId: personal,
      title: "Courses",
      markdown:
        "# Liste\n\nPour **samedi** et [le site](https://example.com) :\n\n- [ ] pain\n- [x] lait\n\n1. un\n2. deux\n   - sous-point\n\n> À ne pas oublier\n\n```js\nconst a = 1;\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n---\n",
    });
    expect(created.statusCode, created.body).toBe(200);
    const id = created.json().page.id;
    const content = (await client.get(`/api/pages/${id}/content`)).json();
    expect(content.content.content.map((n: { type: string }) => n.type)).toEqual([
      "heading",
      "paragraph",
      "taskList",
      "orderedList",
      "blockquote",
      "codeBlock",
      "table",
      "horizontalRule",
    ]);
    expect(content.markdown).toContain("# Liste");
    expect(content.markdown).toContain("**samedi**");
    expect(content.markdown).toContain("[le site](https://example.com)");
    expect(content.markdown).toContain("- [x] lait");
    expect(content.markdown).toContain("const a = 1;");
    // Search finds what was written.
    expect((await client.get("/api/search?q=samedi")).json().results.map((r: { id: string }) => r.id)).toEqual([id]);

    // Added at the end, then replaced.
    expect((await client.post(`/api/pages/${id}/content`, { markdown: "Fin de la liste" })).statusCode).toBe(200);
    expect((await client.get(`/api/pages/${id}/content`)).json().markdown.trim().endsWith("Fin de la liste")).toBe(true);
    expect((await client.put(`/api/pages/${id}/content`, { markdown: "Tout neuf" })).statusCode).toBe(200);
    expect((await client.get(`/api/pages/${id}/content`)).json().markdown.trim()).toBe("Tout neuf");
    // The previous content is in the history.
    expect((await boris.get(`/api/pages/${id}/history`)).json().versions.length).toBeGreaterThan(0);
  });

  it("checks the editor's JSON", async () => {
    const { client } = await makeToken([personal], false);
    const id = await boris.createPage(personal, "JSON");
    const bad = await client.put(`/api/pages/${id}/content`, { content: { type: "doc", content: [{ type: "script", text: "x" }] } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe("bad_content");
    const ok = await client.put(`/api/pages/${id}/content`, {
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "clic", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] },
              { type: "dateMention", attrs: { id: "x", date: "2026-11-02", reminder: 0, remindAt: "2026-11-02T08:00:00.000Z", remindUser: "someone-else" } },
            ],
          },
        ],
      },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const para = (await client.get(`/api/pages/${id}/content`)).json().content.content[0];
    expect(para.content[0].marks).toBeUndefined();
    expect(para.content[1].attrs.remindUser).toBeUndefined();
    expect(para.content[1].attrs.date).toBe("2026-11-02");
  });
});

describe("database queries", () => {
  it("filter, sort and page rows, with columns and options named", async () => {
    const { client } = await makeToken([personal], false);
    const database = (await client.post("/api/databases", { workspaceId: personal, parentId: null, title: "Tâches" })).json().database;
    const titleName = database.properties[0].name;
    const status = (
      await client.post(`/api/databases/${database.id}/properties`, {
        name: "Statut",
        type: "select",
        config: {
          options: [
            { id: "a", name: "À faire", color: "gray" },
            { id: "b", name: "Fait", color: "green" },
          ],
        },
      })
    ).json().property;
    await client.post(`/api/databases/${database.id}/properties`, { name: "Priorité", type: "number", config: {} });
    for (const [title, s, p] of [
      ["Pain", "à faire", 2],
      ["Lait", "Fait", 1],
      ["Oeufs", "À faire", 3],
    ] as const) {
      const res = await client.post(`/api/databases/${database.id}/rows`, {
        values: { [titleName]: title, statut: s, Priorité: p },
        markdown: `Acheter du ${title}`,
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().row.values[status.id]).toBe(s === "Fait" ? "b" : "a");
    }
    const q = await client.post(`/api/databases/${database.id}/query`, {
      filters: [{ propertyId: "Statut", operator: "is", value: "a" }],
      sorts: [{ propertyId: "Priorité", direction: "desc" }],
      limit: 1,
    });
    expect(q.statusCode, q.body).toBe(200);
    expect(q.json()).toMatchObject({ total: 2, nextCursor: "1" });
    expect(q.json().rows.map((r: { title: string }) => r.title)).toEqual(["Oeufs"]);
    const next = (
      await client.post(`/api/databases/${database.id}/query`, {
        filters: [{ propertyId: "Statut", operator: "is", value: "À faire" }],
        sorts: [{ propertyId: "Priorité", direction: "desc" }],
        limit: 1,
        cursor: "1",
      })
    ).json();
    expect(next.rows.map((r: { title: string }) => r.title)).toEqual(["Pain"]);
    expect(next.nextCursor).toBeNull();
    expect((await client.post(`/api/databases/${database.id}/query`, { filters: [{ propertyId: "Nope", operator: "is", value: "a" }] })).statusCode).toBe(400);

    // Each row has its page content.
    const row = q.json().rows[0].id;
    expect((await client.get(`/api/pages/${row}/content`)).json().markdown.trim()).toBe("Acheter du Oeufs");
    // Updated by names too.
    const patched = await client.patch(`/api/databases/${database.id}/rows/${row}`, { values: { Statut: "Fait" } });
    expect(patched.json().row.values[status.id]).toBe("b");
  });
});
