import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { DatabaseData, DatabaseProperty } from "@nootion/shared";
import { eq } from "drizzle-orm";
import { databaseProperties, pages } from "../src/db/schema.js";
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

async function runImport(body: Record<string, unknown> = { token: "secret_good_token" }, expected = "done", who = boris) {
  const res = await who.post("/api/import/notion", { workspaceId: ws, ...body });
  expect(res.statusCode, res.body).toBe(200);
  for (let i = 0; i < 200; i++) {
    const status = (await who.get(`/api/import/notion?workspaceId=${ws}`)).json();
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
    // Each note says where it is, with a link to Notion (to the block for page contents).
    // Status columns are kept as status columns: nothing to report.
    expect(report.details.status).toBeUndefined();
    expect(report.details.propertyType).toEqual([expect.objectContaining({ where: "Tasks", item: "Button", info: "button" })]);
    expect(report.details.icon).toEqual([expect.objectContaining({ where: "Notes", info: "i.png" })]);
    expect(report.details.table_of_contents).toEqual([{ where: "Home", url: "https://www.notion.so/11111111111111111111111111111111#b14" }]);
    expect(report.formulas[0].url).toBe("https://www.notion.so/33333333333333333333333333333333");

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
    // Icons: emojis as they are, Notion's images as icons of the server; images elsewhere are left out.
    expect((await detail(home.id)).icon).toBe("🏠");
    expect((await detail(byTitle("Projects").id)).icon).toMatch(/^icon:[0-9a-f-]{36}$/);
    expect((await detail(byTitle("Notes").id)).icon).toBeNull();
    expect(report.notes.icon).toBe(1);

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
    // Their widths, as resized in Notion.
    expect(columns.content!.map((c) => c.attrs?.width)).toEqual([0.3, 0.7]);
    expect(json).toContain("https://example.org/doc.pdf");
    // Callouts keep every block inside; one without an icon stays without one.
    const callouts = doc.content!.filter((n) => n.type === "callout");
    expect(callouts.map((c) => c.attrs?.emoji)).toEqual(["⚠️", ""]);
    expect(callouts[1]!.content!.map((n) => n.type)).toEqual(["heading", "bulletList"]);
    // The nested list item stays nested.
    const list = doc.content!.find((n) => n.type === "bulletList")!;
    expect(list.content).toHaveLength(2);
    expect(types(list.content![0]!).filter((t) => t === "bulletList")).toHaveLength(1);

    // Columns and their types.
    const tasks = await getDb(byTitle("Tasks").id);
    // Status columns keep their options' categories.
    expect(prop(tasks, "Status").type).toBe("status");
    expect(prop(tasks, "Status").config.options).toEqual([
      { id: "s1", name: "To do", color: "gray", group: "todo" },
      { id: "s2", name: "Doing", color: "blue", group: "in_progress" },
      { id: "s3", name: "Shipped", color: "green", group: "done" },
    ]);
    expect(prop(tasks, "Price")).toMatchObject({ type: "currency", config: { currency: "EUR" } });
    expect(prop(tasks, "Done").type).toBe("checkbox");
    expect(prop(tasks, "Assignee").type).toBe("person");
    expect(prop(tasks, "Project").type).toBe("relation");
    expect(prop(tasks, "Double")).toMatchObject({ type: "formula", config: { expression: 'prop("Price") * 2' } });
    expect(prop(tasks, "Label")).toMatchObject({ type: "formula", config: { expression: 'upper(prop("Name"))' } });
    expect(prop(tasks, "Weird").type).toBe("text");
    expect(tasks.properties.find((p) => p.name === "Button")).toBeUndefined();
    expect(prop(tasks, "Phone").type).toBe("phone");
    expect(prop(tasks, "Ref")).toMatchObject({ type: "unique_id", config: { prefix: "TASK" } });
    expect(prop(tasks, "Editor").type).toBe("last_edited_by");

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
    expect(v("Weird")).toBe("Buy paint");
    expect(v("Phone")).toBe("+33 6 12 34 56 78");
    // Notion's numbers are kept; a row without one gets the next.
    expect(v("Ref")).toBe(7);
    expect(tasks.rows.find((r) => r.title === "Call plumber")!.values[prop(tasks, "Ref").id]).toBe(8);
    // Last edited by Ada in Notion, who is Boris here.
    expect(v("Editor")).toEqual([await boris.id()]);
    expect(prop(tasks, "TagList")).toMatchObject({ type: "formula", config: { expression: 'join(map(prop("Tags"), name(current)), ",")' } });
    expect(v("TagList")).toEqual({ kind: "text", value: "paint,urgent" });
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
    // Only "Call plumber" is done.
    expect(prop(projects, "Spent")).toMatchObject({
      type: "formula",
      config: { expression: 'sum(map(filter(prop("Tasks"), current.prop("Done")), current.prop("Price")))' },
    });
    expect(house.values[prop(projects, "Spent").id]).toEqual({ kind: "number", value: 80 });
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

  it("turns status columns imported as selects by older versions into status columns", async () => {
    await runImport();
    let tasks = await getDb((await tree()).find((p) => p.title === "Tasks")!.id);
    const status = prop(tasks, "Status");
    const doing = tasks.rows.find((r) => r.values[status.id] === "s2")!;
    // As an older version left it: a select, without categories; phones and IDs as texts.
    app.db
      .update(databaseProperties)
      .set({ type: "select", config: { options: status.config.options!.map(({ group: _g, ...o }) => o) } })
      .where(eq(databaseProperties.id, status.id))
      .run();
    const ref = prop(tasks, "Ref");
    for (const name of ["Phone", "Ref"]) app.db.update(databaseProperties).set({ type: "text", config: {} }).where(eq(databaseProperties.id, prop(tasks, name).id)).run();
    for (const r of tasks.rows) {
      const props = { ...(app.db.select({ props: pages.props }).from(pages).where(eq(pages.id, r.id)).get()!.props ?? {}) };
      props[ref.id] = `TASK-${r.values[ref.id]}`;
      app.db.update(pages).set({ props }).where(eq(pages.id, r.id)).run();
    }
    await runImport({});
    tasks = await getDb(tasks.id);
    expect(prop(tasks, "Status")).toMatchObject({ id: status.id, type: "status" });
    expect(prop(tasks, "Status").config.options!.map((o) => o.group)).toEqual(["todo", "in_progress", "done"]);
    expect(tasks.rows.find((r) => r.id === doing.id)!.values[status.id]).toBe("s2");
    expect(prop(tasks, "Phone").type).toBe("phone");
    expect(prop(tasks, "Ref")).toMatchObject({ type: "unique_id", config: { prefix: "TASK" } });
    expect(tasks.rows.map((r) => r.values[ref.id]).sort()).toEqual([7, 8]);
  });

  it("imports unchanged pages again when asked, reusing their icons", async () => {
    await runImport();
    const home = (await tree()).find((p) => p.title === "Home")!;
    // Content flattened by an older version of the import.
    app.db
      .update(pages)
      .set({ contentJson: { type: "doc", content: [{ type: "paragraph" }] } })
      .where(eq(pages.id, home.id))
      .run();
    const again = await runImport({});
    expect(again.job.report).toMatchObject({ updated: 0 });
    const refreshed = await runImport({ refresh: true });
    expect(refreshed.job.report.unchanged).toBe(0);
    expect(refreshed.job.report.updated).toBeGreaterThan(0);
    expect(types(content(home.id))).toContain("columns");
    // The same image isn't stored twice.
    const icons = (await boris.get("/api/icons")).json().icons;
    expect(icons).toHaveLength(1);
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

  it("keeps updating pages moved to another space, unless whoever imports can't edit them there", async () => {
    ws = (await boris.post("/api/workspaces", { name: "Startup" })).json().workspace.id;
    const alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
    await boris.put(`/api/workspaces/${ws}/members`, { userId: await alice.id(), role: "editor" });
    await runImport();
    const personal = await boris.personalWorkspace();
    const notes = (await tree()).find((p) => p.title === "Notes")!;
    const count = (await tree()).length;

    // Moved to Boris's private space: the next import updates it there, without a copy in the shared space.
    expect((await boris.post(`/api/pages/${notes.id}/move`, { workspaceId: personal, parentId: null })).statusCode).toBe(200);
    notion.editNotes("Second notes.");
    expect((await runImport({})).job.report).toMatchObject({ updated: 1 });
    expect(JSON.stringify(content(notes.id))).toContain("Second notes.");
    expect((await tree()).length).toBe(count - 1);
    expect((await tree()).some((p) => p.title === "Notes")).toBe(false);

    // Alice imports too, but can't see Boris's private space: the page is left alone, and not imported again.
    notion.editNotes("Third notes.");
    const status = await runImport({ refresh: true }, "done", alice);
    expect(status.job.report.updated).toBeGreaterThan(0);
    expect(JSON.stringify(content(notes.id))).toContain("Second notes.");
    expect((await tree()).length).toBe(count - 1);
    expect((await boris.get(`/api/pages/${notes.id}`)).json().page.workspaceId).toBe(personal);
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
