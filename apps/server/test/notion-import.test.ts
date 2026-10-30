import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { DatabaseData, DatabaseProperty } from "@nootion/shared";
import { eq } from "drizzle-orm";
import { pages } from "../src/db/schema.js";
import type { ProseMirrorNode } from "../src/collab.js";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";
import { fakeNotion } from "./notion-fake.js";

let app: FastifyInstance;
let boris: Client;
let notion: ReturnType<typeof fakeNotion>;
let ws = "";

beforeEach(async () => {
  notion = fakeNotion();
  const base = await notion.start();
  app = await makeApp(undefined, { NOTION_API_URL: base, NOTION_REQUEST_INTERVAL: "0" });
  boris = await setupAdmin(app);
  ws = await boris.personalWorkspace();
});
afterEach(async () => {
  await app.close();
  await notion.stop();
});

async function runImport(body: Record<string, unknown> = { token: "secret_good_token" }, expected = "done") {
  const res = await boris.post("/api/import/notion", { workspaceId: ws, ...body });
  expect(res.statusCode, res.body).toBe(200);
  for (let i = 0; i < 200; i++) {
    const status = (await boris.get(`/api/import/notion?workspaceId=${ws}`)).json();
    if (status.job.status !== "running") {
      if (expected === "done") expect(status.job.error).toBeNull();
      expect(status.job.status).toBe(expected);
      return status;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("import never finished");
}

type TreePage = { id: string; title: string; parentId: string | null; kind: string };
const tree = async (): Promise<TreePage[]> => (await boris.get(`/api/workspaces/${ws}/pages`)).json().pages;
const content = (id: string) => app.db.select({ c: pages.contentJson }).from(pages).where(eq(pages.id, id)).get()!.c as ProseMirrorNode;
const types = (n: ProseMirrorNode): string[] => [n.type, ...(n.content ?? []).flatMap(types)];
const getDb = async (id: string): Promise<DatabaseData> => (await boris.get(`/api/databases/${id}`)).json().database;
const prop = (d: DatabaseData, name: string) => d.properties.find((p) => p.name === name) as DatabaseProperty;

describe("Notion import", () => {
  it("imports pages, databases, rows and content", async () => {
    const status = await runImport();
    expect(status.connected).toBe(true);
    const report = status.job.report;
    expect(report).toMatchObject({ pages: 2, databases: 3, rows: 3, files: 2 });
    expect(Object.keys(report.notes)).toEqual(expect.arrayContaining(["table_of_contents"]));
    expect(Object.keys(report.notes)).not.toEqual(expect.arrayContaining(["toggle"]));
    expect(report.formulas).toEqual([expect.objectContaining({ database: "Tasks", name: "Weird" })]);

    const all = await tree();
    const byTitle = (t: string) => all.find((p) => p.title === t)!;
    const home = byTitle("Home");
    expect(home.parentId).toBeNull();
    expect(byTitle("Notes").parentId).toBe(home.id);
    expect(byTitle("Tasks")).toMatchObject({ parentId: home.id, kind: "database" });
    expect(byTitle("Projects")).toMatchObject({ parentId: null, kind: "database" });
    // A database inside a database goes next to it.
    expect(byTitle("Glossary")).toMatchObject({ parentId: home.id, kind: "database" });

    // Covers: Notion's files are copied, links are kept.
    const detail = async (id: string) => (await boris.get(`/api/pages/${id}`)).json().page;
    expect((await detail(home.id)).cover).toMatch(/^\/api\/attachments\/[0-9a-f-]{36}$/);
    expect((await detail(byTitle("Notes").id)).cover).toBe("https://www.notion.so/images/page-cover/gradients_8.png");
    expect((await detail(byTitle("Tasks").id)).cover).toBeNull();

    // Home's content, with its links pointing to the imported pages.
    const doc = content(home.id);
    const kinds = types(doc);
    for (const k of [
      "heading",
      "pageLink",
      "bulletList",
      "taskList",
      "callout",
      "codeBlock",
      "blockquote",
      "horizontalRule",
      "image",
      "table",
      "databaseBlock",
      "details",
      "detailsSummary",
      "columns",
      "column",
    ])
      expect(kinds).toContain(k);
    const json = JSON.stringify(doc);
    expect(json).toContain(`"pageId":"${byTitle("Notes").id}"`);
    expect(json).toContain(`"pageId":"${byTitle("Tasks").id}"`);
    expect(json).toMatch(/"src":"\/api\/attachments\//);
    expect(json).toContain('"checked":true');
    // Toggles, with a heading toggle keeping its level, and columns side by side.
    const toggles = doc.content!.filter((n) => n.type === "details");
    expect(toggles.map((n) => [n.attrs?.level ?? null, n.content![0]!.content![0]!.text])).toEqual([
      [null, "More"],
      [2, "Folded"],
    ]);
    expect(JSON.stringify(toggles[1])).toContain("Under the heading");
    const columns = doc.content!.find((n) => n.type === "columns")!;
    expect(columns.content!.map((c) => c.content![0]!.content![0]!.text)).toEqual(["Left", "Right"]);
    expect(json).toContain("https://example.org/doc.pdf");
    // The nested list item stays nested.
    const list = doc.content!.find((n) => n.type === "bulletList")!;
    expect(list.content).toHaveLength(2);
    expect(types(list.content![0]!).filter((t) => t === "bulletList")).toHaveLength(1);

    // Columns and their types.
    const tasks = await getDb(byTitle("Tasks").id);
    expect(prop(tasks, "Status").type).toBe("select");
    expect(prop(tasks, "Status").config).toMatchObject({ options: expect.arrayContaining([expect.objectContaining({ name: "Doing" })]) });
    expect(prop(tasks, "Price")).toMatchObject({ type: "currency", config: { currency: "EUR" } });
    expect(prop(tasks, "Done").type).toBe("checkbox");
    expect(prop(tasks, "Assignee").type).toBe("person");
    expect(prop(tasks, "Project").type).toBe("relation");
    expect(prop(tasks, "Double")).toMatchObject({ type: "formula", config: { expression: 'prop("Price") * 2' } });
    expect(prop(tasks, "Label")).toMatchObject({ type: "formula", config: { expression: 'upper(prop("Name"))' } });
    expect(prop(tasks, "Weird").type).toBe("text");
    expect(tasks.properties.find((p) => p.name === "Button")).toBeUndefined();

    // Rows and their values.
    expect(tasks.rows.map((r) => r.title).sort()).toEqual(["Buy paint", "Call plumber"]);
    const paint = tasks.rows.find((r) => r.title === "Buy paint")!;
    const v = (name: string) => paint.values[prop(tasks, name).id];
    expect(v("Price")).toBe(120);
    expect(v("Progress")).toBe(50);
    const optionName = (name: string, id: string) => prop(tasks, name).config.options!.find((o) => o.id === id)?.name;
    expect(optionName("Status", v("Status") as string)).toBe("Doing");
    expect((v("Tags") as string[]).map((id) => optionName("Tags", id))).toEqual(["paint", "urgent"]);
    expect(v("Due")).toMatchObject({ start: "2024-02-01" });
    expect(v("Assignee")).toEqual([await boris.id()]);
    expect(v("Weird")).toBe("paint,urgent");
    expect(v("Double")).toMatchObject({ value: 240 });
    expect(v("Label")).toMatchObject({ value: "BUY PAINT" });

    const projects = await getDb(byTitle("Projects").id);
    const house = projects.rows[0]!;
    expect(house.title).toBe("House");
    expect(v("Project")).toEqual([house.id]);
    // The relation's other side is the twin column, not a second relation.
    expect(prop(projects, "Tasks").type).toBe("relation");
    expect((house.values[prop(projects, "Tasks").id] as string[]).length).toBe(2);
    expect(house.values[prop(projects, "Total").id]).toMatchObject({ value: 200 });
    // "Call plumber" had too many relations to come with the row.
    const plumber = tasks.rows.find((r) => r.title === "Call plumber")!;
    expect(plumber.values[prop(tasks, "Project").id]).toEqual([house.id]);

    // A row's own content.
    expect(JSON.stringify(content(paint.id))).toContain("Two coats.");
  });

  it("imports again without duplicates, updating what changed", async () => {
    await runImport();
    const before = await tree();
    notion.editNotes("Second notes.");
    // The saved token is used.
    const status = await runImport({});
    expect(status.job.report).toMatchObject({ updated: 1 });
    const after = await tree();
    expect(after.map((p) => p.id).sort()).toEqual(before.map((p) => p.id).sort());
    const notes = after.find((p) => p.title === "Notes")!;
    expect(JSON.stringify(content(notes.id))).toContain("Second notes.");
    const tasks = await getDb(after.find((p) => p.title === "Tasks")!.id);
    expect(tasks.rows).toHaveLength(2);
    expect(tasks.properties.filter((p) => p.name === "Price")).toHaveLength(1);
  });

  it("finishes an import that stopped halfway, without duplicates", async () => {
    notion.breakContent(true);
    const failed = await runImport(undefined, "failed");
    expect(failed.job.error).toContain("Broken on purpose");
    const before = await tree();
    notion.breakContent(false);
    await runImport({});
    const after = await tree();
    expect(after.map((p) => p.id).sort()).toEqual(before.map((p) => p.id).sort());
    const tasks = await getDb(after.find((p) => p.title === "Tasks")!.id);
    expect(tasks.rows).toHaveLength(2);
    expect(prop(tasks, "Price").type).toBe("currency");
    const paint = tasks.rows.find((r) => r.title === "Buy paint")!;
    expect(paint.values[prop(tasks, "Price").id]).toBe(120);
    expect(JSON.stringify(content(after.find((p) => p.title === "Home")!.id))).toContain("Welcome");
  });

  it("refuses bad tokens and people outside the space", async () => {
    const bad = await boris.post("/api/import/notion", { workspaceId: ws, token: "secret_wrong" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code ?? bad.json().error).toBeDefined();
    expect((await boris.post("/api/import/notion", { workspaceId: ws })).statusCode).toBe(400);
    const alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
    expect((await alice.post("/api/import/notion", { workspaceId: ws, token: "secret_good_token" })).statusCode).toBe(404);
    expect((await alice.get(`/api/import/notion?workspaceId=${ws}`)).statusCode).toBe(404);
  });
});
