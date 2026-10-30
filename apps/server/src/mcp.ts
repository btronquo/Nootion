import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { OPTION_COLORS, type CellValue, type DatabaseProperty, type RelatedRow, type WorkspaceSummary } from "@nootion/shared";
import { findTokenUser, type TokenScope } from "./api-tokens.js";

const VERSION = "1.2.0";

const INSTRUCTIONS = `Nootion is a self-hosted notes and databases app, like Notion. Content is organised in spaces; a space holds a tree of pages.
A page can be a plain page, a database (a table whose rows are pages with cell values) or a database row.
Find things with search or list_pages, read pages as Markdown with read_page, and query databases with query_database.
Columns and select options are named by their names. Changes show at once to people who have the page open, and each version you write is kept in the page's history, marked with your name.
Prefer append_to_page to add to a page; replace_page_content rewrites all of it.`;

/** An error to show the agent: what the API answered. */
class ApiError extends Error {}

type Call = <T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown) => Promise<T>;

/** Calls the API as the token's user: the same checks, limits and logs as any request made with the token. */
function apiCaller(app: FastifyInstance, req: FastifyRequest): Call {
  return async (method, url, body) => {
    const res = await app.inject({
      method,
      url: `/api${url}`,
      headers: {
        authorization: req.headers.authorization!,
        ...(req.headers["accept-language"] ? { "accept-language": req.headers["accept-language"] } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });
    const json = res.body ? JSON.parse(res.body) : {};
    if (res.statusCode >= 400) throw new ApiError(json.message ?? json.error ?? `HTTP ${res.statusCode}`);
    return json;
  };
}

const text = (value: string): CallToolResult => ({ content: [{ type: "text", text: value }] });
const json = (value: unknown): CallToolResult => text(JSON.stringify(value, null, 1));

/** Cell values keyed by column name, with option, people and row names instead of ids. */
function readable(properties: DatabaseProperty[], values: Record<string, CellValue>, people: Record<string, string>, related: Record<string, RelatedRow>) {
  const out: Record<string, unknown> = {};
  for (const p of properties) {
    const v = values[p.id];
    if (v === null || v === undefined || (Array.isArray(v) && !v.length)) continue;
    const option = (id: string) => p.config.options?.find((o) => o.id === id)?.name ?? id;
    switch (p.type) {
      case "select":
        out[p.name] = option(String(v));
        break;
      case "multi_select":
        out[p.name] = (v as string[]).map(option);
        break;
      case "person":
      case "created_by":
        out[p.name] = (Array.isArray(v) ? (v as string[]) : [v as string]).map((id) => people[id] ?? id);
        break;
      case "relation":
        out[p.name] = (v as string[]).map((id) => ({ id, title: related[id]?.title ?? null }));
        break;
      case "file":
        out[p.name] = (v as { name: string }[]).map((f) => f.name);
        break;
      default:
        out[p.name] = v;
    }
  }
  return out;
}

const columns = (properties: DatabaseProperty[]) =>
  properties.map((p) => ({ id: p.id, name: p.name, type: p.type, ...(p.config.options ? { options: p.config.options.map((o) => o.name) } : {}) }));

interface DatabaseAnswer {
  database: { id: string; title: string; properties: DatabaseProperty[]; views: { id: string; name: string; type: string }[]; rows: unknown[] };
}
interface QueryAnswer {
  properties: DatabaseProperty[];
  rows: { id: string; title: string; values: Record<string, CellValue>; createdAt: string; updatedAt: string }[];
  total: number;
  nextCursor: string | null;
  people: Record<string, string>;
  related: Record<string, RelatedRow>;
}

const id = (what: string) => z.string().min(1).describe(`The ${what}'s id.`);
const markdown = z.string().max(2_000_000).describe("Content in Markdown: headings, lists, to-dos (- [ ]), quotes, code, tables, links, images.");
const cellValues = z
  .record(z.string(), z.unknown())
  .describe(
    'Cell values by column name: text, number, true/false, a date as {"start": "2026-11-15"} or {"start": "2026-11-15T09:00"}, an option name for a select, a list of names for a multi-select, user ids for a person, row ids for a relation; null empties a cell.',
  );
const filterSchema = z.object({
  column: z.string().describe("Column name."),
  operator: z
    .string()
    .describe(
      "text: contains, not_contains, is, is_not, starts_with, ends_with; number: eq, neq, gt, lt, gte, lte; date: is, before, after, on_or_before, on_or_after, within; checkbox: checked, unchecked; select: is, is_not; multi-select, person, relation: contains, not_contains; any: is_empty, is_not_empty.",
    ),
  value: z
    .unknown()
    .optional()
    .describe(
      "Text, number, option name, a date (2026-11-15, today, tomorrow, one_week_ago…), within: past_week, next_week, next_month…; person: a user id or me.",
    ),
});

/** The tools a token gets: reading always, writing unless it is read-only. */
function buildServer(call: Call, scope: TokenScope): McpServer {
  const server = new McpServer({ name: "nootion", version: VERSION }, { instructions: INSTRUCTIONS });
  const read: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };
  const write: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
  const tool = <A extends z.ZodRawShape>(
    name: string,
    config: { title: string; description: string; inputSchema: A; annotations: ToolAnnotations },
    run: (args: z.infer<z.ZodObject<A>>) => Promise<CallToolResult>,
  ) =>
    server.registerTool(name, config, (async (args: z.infer<z.ZodObject<A>>) => {
      try {
        return await run(args);
      } catch (err) {
        if (err instanceof ApiError) return { isError: true, content: [{ type: "text", text: err.message }] };
        throw err;
      }
    }) as never);

  tool(
    "search",
    {
      title: "Search",
      description: "Searches page titles, page content and attached files (PDFs, scans) in the spaces this connection can reach.",
      inputSchema: { query: z.string().min(1).max(200), limit: z.number().int().min(1).max(50).optional() },
      annotations: read,
    },
    async ({ query, limit }) => json((await call<{ results: unknown[] }>("GET", `/search?q=${encodeURIComponent(query)}&limit=${limit ?? 20}`)).results),
  );

  tool(
    "list_spaces",
    { title: "List spaces", description: "The spaces this connection can reach, with your role in each.", inputSchema: {}, annotations: read },
    async () => {
      const { workspaces } = await call<{ workspaces: WorkspaceSummary[] }>("GET", "/workspaces");
      return json(workspaces.map((w) => ({ id: w.id, name: w.kind === "personal" ? "Personal space" : w.name, kind: w.kind, role: w.role })));
    },
  );

  tool(
    "list_pages",
    {
      title: "List pages",
      description: "Every page and database of a space, as a tree (parentId null at the root). Database rows are not listed: use query_database.",
      inputSchema: { spaceId: id("space") },
      annotations: read,
    },
    async ({ spaceId }) => {
      const { pages } = await call<{ pages: { id: string; parentId: string | null; kind: string; title: string; icon: string | null }[] }>(
        "GET",
        `/workspaces/${encodeURIComponent(spaceId)}/pages`,
      );
      return json(pages.map((p) => ({ id: p.id, parentId: p.parentId, kind: p.kind, title: p.title, ...(p.icon ? { icon: p.icon } : {}) })));
    },
  );

  tool(
    "read_page",
    {
      title: "Read a page",
      description:
        "A page's title, place and content as Markdown. For a database row, also its cell values. For a database, use get_database and query_database.",
      inputSchema: { pageId: id("page") },
      annotations: read,
    },
    async ({ pageId }) => {
      const pid = encodeURIComponent(pageId);
      const { page } = await call<{
        page: { id: string; kind: string; title: string; parentId: string | null; breadcrumb: { title: string }[]; updatedAt: string };
      }>("GET", `/pages/${pid}`);
      if (page.kind === "database") return text(`"${page.title}" is a database: use get_database and query_database with id ${page.id}.`);
      const content = await call<{ markdown: string }>("GET", `/pages/${pid}/content`);
      const head: Record<string, unknown> = {
        id: page.id,
        title: page.title,
        kind: page.kind,
        path: page.breadcrumb.map((b) => b.title).join(" / "),
        updatedAt: page.updatedAt,
      };
      if (page.kind === "row" && page.parentId) {
        const db = await call<QueryAnswer>("POST", `/databases/${encodeURIComponent(page.parentId)}/query`, { limit: 1000 });
        const row = db.rows.find((r) => r.id === page.id);
        head.databaseId = page.parentId;
        if (row) head.values = readable(db.properties, row.values, db.people, db.related);
      }
      return text(`${JSON.stringify(head, null, 1)}\n\n${content.markdown}`);
    },
  );

  tool("list_databases", { title: "List databases", description: "The databases this connection can read.", inputSchema: {}, annotations: read }, async () =>
    json((await call<{ databases: unknown[] }>("GET", "/databases")).databases),
  );

  tool(
    "get_database",
    {
      title: "Get a database",
      description: "A database's columns (name, type, select options) and views, and how many rows it has.",
      inputSchema: { databaseId: id("database") },
      annotations: read,
    },
    async ({ databaseId }) => {
      const { database } = await call<DatabaseAnswer>("GET", `/databases/${encodeURIComponent(databaseId)}`);
      return json({
        id: database.id,
        title: database.title,
        columns: columns(database.properties),
        views: database.views.map((v) => ({ id: v.id, name: v.name, type: v.type })),
        rowCount: database.rows.length,
      });
    },
  );

  tool(
    "query_database",
    {
      title: "Query a database",
      description: "Rows of a database, filtered and sorted, with their cell values by column name. Returns nextCursor while more rows remain.",
      inputSchema: {
        databaseId: id("database"),
        filters: z.array(filterSchema).max(20).optional(),
        filterMode: z.enum(["and", "or"]).optional(),
        sorts: z
          .array(z.object({ column: z.string(), direction: z.enum(["asc", "desc"]) }))
          .max(5)
          .optional(),
        viewId: z.string().optional().describe("Use a view's filters and sorts instead."),
        limit: z.number().int().min(1).max(200).optional(),
        cursor: z.string().optional(),
      },
      annotations: read,
    },
    async ({ databaseId, filters, filterMode, sorts, viewId, limit, cursor }) => {
      const res = await call<QueryAnswer>("POST", `/databases/${encodeURIComponent(databaseId)}/query`, {
        ...(filters ? { filters: filters.map((f) => ({ propertyId: f.column, operator: f.operator, value: f.value ?? null })) } : {}),
        ...(filterMode ? { filterMode } : {}),
        ...(sorts ? { sorts: sorts.map((s) => ({ propertyId: s.column, direction: s.direction })) } : {}),
        ...(viewId ? { viewId } : {}),
        limit: limit ?? 50,
        ...(cursor ? { cursor } : {}),
      });
      return json({
        total: res.total,
        nextCursor: res.nextCursor,
        rows: res.rows.map((r) => ({ id: r.id, title: r.title, values: readable(res.properties, r.values, res.people, res.related), updatedAt: r.updatedAt })),
      });
    },
  );

  if (scope.readOnly) return server;

  tool(
    "create_page",
    {
      title: "Create a page",
      description: "Creates a page at the root of a space or inside another page, with its content in Markdown.",
      inputSchema: {
        spaceId: id("space"),
        parentId: z.string().nullable().optional().describe("The parent page's id; none for the root of the space."),
        title: z.string().max(500),
        icon: z.string().max(16).optional().describe("An emoji."),
        markdown: markdown.optional(),
      },
      annotations: write,
    },
    async ({ spaceId, parentId, title, icon, markdown: md }) => {
      const { page } = await call<{ page: { id: string } }>("POST", "/pages", {
        workspaceId: spaceId,
        parentId: parentId ?? null,
        title,
        ...(icon ? { icon } : {}),
        ...(md ? { markdown: md } : {}),
      });
      return json({ id: page.id, created: true });
    },
  );

  tool(
    "update_page",
    {
      title: "Rename a page",
      description: "Changes a page's title or icon.",
      inputSchema: { pageId: id("page"), title: z.string().max(500).optional(), icon: z.string().max(16).nullable().optional() },
      annotations: { ...write, idempotentHint: true },
    },
    async ({ pageId, title, icon }) => {
      await call("PATCH", `/pages/${encodeURIComponent(pageId)}`, { ...(title !== undefined ? { title } : {}), ...(icon !== undefined ? { icon } : {}) });
      return json({ ok: true });
    },
  );

  tool(
    "append_to_page",
    {
      title: "Add to a page",
      description: "Adds Markdown at the end of a page or database row.",
      inputSchema: { pageId: id("page"), markdown },
      annotations: write,
    },
    async ({ pageId, markdown: md }) => {
      await call("POST", `/pages/${encodeURIComponent(pageId)}/content`, { markdown: md });
      return json({ ok: true });
    },
  );

  tool(
    "replace_page_content",
    {
      title: "Rewrite a page",
      description: "Replaces all of a page's content with this Markdown. The previous content stays in the page's history. Read the page first.",
      inputSchema: { pageId: id("page"), markdown },
      annotations: { ...write, destructiveHint: true, idempotentHint: true },
    },
    async ({ pageId, markdown: md }) => {
      await call("PUT", `/pages/${encodeURIComponent(pageId)}/content`, { markdown: md });
      return json({ ok: true });
    },
  );

  tool(
    "move_page",
    {
      title: "Move a page",
      description: "Moves a page under another page of the same space, or to its root.",
      inputSchema: { pageId: id("page"), parentId: z.string().nullable().describe("The new parent's id, or null for the root.") },
      annotations: { ...write, idempotentHint: true },
    },
    async ({ pageId, parentId }) => {
      await call("POST", `/pages/${encodeURIComponent(pageId)}/move`, { parentId });
      return json({ ok: true });
    },
  );

  tool(
    "trash_page",
    {
      title: "Move to the trash",
      description: "Moves a page, a database or a database row to the trash, with its subpages. People can restore it from the trash.",
      inputSchema: { pageId: id("page") },
      annotations: { ...write, destructiveHint: true, idempotentHint: true },
    },
    async ({ pageId }) => {
      await call("DELETE", `/pages/${encodeURIComponent(pageId)}`);
      return json({ ok: true });
    },
  );

  tool(
    "create_database",
    {
      title: "Create a database",
      description: "Creates a database (a table): a title column, then the columns given.",
      inputSchema: {
        spaceId: id("space"),
        parentId: z.string().nullable().optional().describe("The parent page's id; none for the root of the space."),
        title: z.string().max(500),
        columns: z
          .array(
            z.object({
              name: z.string().min(1).max(100),
              type: z.enum(["text", "number", "currency", "percent", "checkbox", "date", "select", "multi_select", "person", "url", "email", "file"]),
              options: z.array(z.string().min(1).max(100)).max(100).optional().describe("For select and multi_select: the option names."),
            }),
          )
          .max(50)
          .optional(),
      },
      annotations: write,
    },
    async ({ spaceId, parentId, title, columns: cols }) => {
      const { database } = await call<DatabaseAnswer>("POST", "/databases", { workspaceId: spaceId, parentId: parentId ?? null, title });
      // The columns a new database starts with, besides its title, give way to the ones asked for.
      if (cols?.length) for (const p of database.properties) if (p.type !== "title") await call("DELETE", `/databases/${database.id}/properties/${p.id}`);
      for (const c of cols ?? []) {
        const options = c.options?.map((name, i) => ({ id: randomUUID().slice(0, 8), name, color: OPTION_COLORS[(i + 1) % OPTION_COLORS.length] }));
        await call("POST", `/databases/${database.id}/properties`, { name: c.name, type: c.type, config: options ? { options } : {} });
      }
      const { database: done } = await call<DatabaseAnswer>("GET", `/databases/${database.id}`);
      return json({ id: done.id, columns: columns(done.properties) });
    },
  );

  tool(
    "add_database_row",
    {
      title: "Add a row",
      description: "Adds a row to a database, with its cell values by column name and, optionally, page content in Markdown.",
      inputSchema: { databaseId: id("database"), values: cellValues, markdown: markdown.optional() },
      annotations: write,
    },
    async ({ databaseId, values, markdown: md }) => {
      const { row } = await call<{ row: { id: string } }>("POST", `/databases/${encodeURIComponent(databaseId)}/rows`, {
        values,
        ...(md ? { markdown: md } : {}),
      });
      return json({ id: row.id, created: true });
    },
  );

  tool(
    "update_database_row",
    {
      title: "Change a row",
      description: "Changes cells of a database row; cells not named stay as they are.",
      inputSchema: { databaseId: id("database"), rowId: id("row"), values: cellValues },
      annotations: { ...write, idempotentHint: true },
    },
    async ({ databaseId, rowId, values }) => {
      await call("PATCH", `/databases/${encodeURIComponent(databaseId)}/rows/${encodeURIComponent(rowId)}`, { values });
      return json({ ok: true });
    },
  );

  return server;
}

/**
 * The MCP server (Streamable HTTP, without sessions), for AI agents such as Claude: each request is answered on its
 * own, with the tools of the token it carries. Tokens are personal API tokens, or tokens given to an app with OAuth.
 */
export const mcpRoutes: FastifyPluginAsync = async (app) => {
  const metadata = `${app.config.appUrl}/.well-known/oauth-protected-resource/mcp`;
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id",
    "access-control-expose-headers": "www-authenticate, mcp-session-id",
  };
  const rpcError = (code: number, message: string) => ({ jsonrpc: "2.0", error: { code, message }, id: null });

  app.options("/mcp", async (_req, reply) =>
    reply
      .headers({ ...cors, "access-control-allow-methods": "GET, POST, DELETE, OPTIONS" })
      .status(204)
      .send(),
  );

  app.post("/mcp", async (req, reply) => {
    reply.headers(cors);
    const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "")?.[1];
    const found = bearer ? findTokenUser(app.db, bearer) : null;
    if (!found) {
      // Tells the app where to sign in (OAuth discovery).
      return reply
        .status(401)
        .header("www-authenticate", `Bearer resource_metadata="${metadata}"${bearer ? ', error="invalid_token"' : ""}`)
        .send(rpcError(-32001, "Unauthorized"));
    }
    const server = buildServer(apiCaller(app, req), found.scope);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    reply.hijack();
    for (const [k, v] of Object.entries(cors)) reply.raw.setHeader(k, v);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });

  // Without sessions, there is no stream to open or session to end.
  for (const method of ["GET", "DELETE"] as const) {
    app.route({
      method,
      url: "/mcp",
      handler: async (_req, reply) =>
        reply
          .headers({ ...cors, allow: "POST" })
          .status(405)
          .send(rpcError(-32000, "Method not allowed.")),
    });
  }
};
