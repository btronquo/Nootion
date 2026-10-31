import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { attachments, databaseProperties, databaseViews, pages } from "../src/db/schema.js";
import type { ProseMirrorNode } from "../src/collab.js";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let boris: Client;

beforeEach(async () => {
  app = await makeApp();
  boris = await setupAdmin(app);
});

const setContent = (pageId: string, content: unknown[]) => app.db.update(pages).set({ contentJson: { type: "doc", content } }).where(eq(pages.id, pageId)).run();
const content = (pageId: string) => app.db.select({ c: pages.contentJson }).from(pages).where(eq(pages.id, pageId)).get()!.c as ProseMirrorNode;
const upload = async (pageId: string) => {
  const boundary = "----nootion";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="plan.png"\r\nContent-Type: image/png\r\n\r\n`),
    Buffer.from("89504e470d0a1a0a", "hex"),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return (await boris.request("POST", `/api/pages/${pageId}/attachments`, body, { "content-type": `multipart/form-data; boundary=${boundary}` })).json().attachment as {
    id: string;
    url: string;
  };
};

async function invoices() {
  const ws = await boris.personalWorkspace();
  const d = (await boris.post("/api/databases", { workspaceId: ws, parentId: null, title: "Factures" })).json().database;
  const status = (
    await boris.post(`/api/databases/${d.id}/properties`, {
      name: "Statut",
      type: "select",
      config: {
        options: [
          { id: "todo", name: "À payer", color: "red" },
          { id: "paid", name: "Payée", color: "green" },
        ],
      },
    })
  ).json().property;
  return { id: d.id as string, title: d.properties[0].id as string, status: status.id as string };
}

describe("row templates", () => {
  it("start new rows with the template's values and content, and can be the default", async () => {
    const db = await invoices();
    const tpl = (await boris.post(`/api/databases/${db.id}/templates`)).json().template;
    await boris.patch(`/api/databases/${db.id}/rows/${tpl.id}`, { values: { [db.title]: "Facture EDF", [db.status]: "todo" } });
    const file = await upload(tpl.id);
    setContent(tpl.id, [{ type: "paragraph", content: [{ type: "text", text: "Montant :" }] }, { type: "image", attrs: { src: file.url } }]);

    let data = (await boris.get(`/api/databases/${db.id}`)).json().database;
    expect(data.rows).toEqual([]);
    expect(data.templates).toEqual([{ id: tpl.id, title: "Facture EDF", icon: null }]);
    expect(data.defaultTemplateId).toBeNull();

    // No default: a blank row.
    const blank = (await boris.post(`/api/databases/${db.id}/rows`, { values: {} })).json().row;
    expect(blank.title).toBe("");

    const row = (await boris.post(`/api/databases/${db.id}/rows`, { values: { [db.status]: "paid" }, templateId: tpl.id })).json().row;
    expect(row.id).not.toBe(tpl.id);
    expect(row.title).toBe("Facture EDF");
    expect(row.values[db.status]).toBe("paid");
    const body = content(row.id);
    expect(body.content![0]!.content![0]!.text).toBe("Montant :");
    const src = body.content![1]!.attrs!.src as string;
    expect(src).not.toBe(file.url);
    const copied = app.db.select().from(attachments).where(eq(attachments.id, src.split("/").pop()!)).get();
    expect(copied?.pageId).toBe(row.id);
    expect((await boris.get(src)).statusCode).toBe(200);

    expect((await boris.put(`/api/databases/${db.id}/default-template`, { templateId: tpl.id })).statusCode).toBe(200);
    expect((await boris.post(`/api/databases/${db.id}/rows`, { values: {} })).json().row.title).toBe("Facture EDF");
    expect((await boris.post(`/api/databases/${db.id}/rows`, { values: {}, templateId: null })).json().row.title).toBe("");

    data = (await boris.get(`/api/databases/${db.id}`)).json().database;
    expect(data.rows).toHaveLength(4);
    expect(data.defaultTemplateId).toBe(tpl.id);

    await boris.post(`/api/databases/${db.id}/rows/delete`, { ids: [tpl.id] });
    data = (await boris.get(`/api/databases/${db.id}`)).json().database;
    expect(data.templates).toEqual([]);
    expect(data.defaultTemplateId).toBeNull();
    expect((await boris.post(`/api/databases/${db.id}/rows`, { values: {} })).json().row.title).toBe("");
    expect((await boris.post(`/api/databases/${db.id}/rows`, { values: {}, templateId: tpl.id })).statusCode).toBe(404);
  });
});

describe("page templates", () => {
  it("copy a page with its databases and subpages into an empty page, ids renewed", async () => {
    const ws = await boris.personalWorkspace();
    const project = await boris.createPage(ws, "Projet");
    await boris.patch(`/api/pages/${project}`, { icon: "🚀" });
    const tasks = (await boris.post("/api/databases", { workspaceId: ws, parentId: project, title: "Tâches" })).json().database;
    const done = (await boris.post(`/api/databases/${tasks.id}/properties`, { name: "Fait", type: "checkbox", config: {} })).json().property;
    const view = tasks.views[0];
    await boris.patch(`/api/databases/${tasks.id}/views/${view.id}`, { config: { filters: [{ propertyId: done.id, operator: "unchecked" }] } });
    await boris.post(`/api/databases/${tasks.id}/rows`, { values: { [tasks.properties[0].id]: "Cadrage", [done.id]: false } });
    const notes = await boris.createPage(ws, "Notes", project);
    setContent(project, [
      { type: "databaseBlock", attrs: { pageId: tasks.id } },
      { type: "paragraph", content: [{ type: "pageLink", attrs: { pageId: notes, title: "Notes" } }] },
      { type: "calendarBlock", attrs: { id: "cal1", sources: [{ databaseId: tasks.id, propertyId: null, color: "blue" }] } },
    ]);

    expect((await boris.patch(`/api/pages/${project}`, { template: true })).statusCode).toBe(200);
    expect((await boris.get(`/api/pages/${project}`)).json().page.template).toBe(true);
    expect((await boris.get("/api/pages/templates")).json().pages.map((p: { id: string }) => p.id)).toEqual([project]);

    const fresh = await boris.createPage(ws, "");
    expect((await boris.post(`/api/pages/${fresh}/apply-template`, { templateId: project })).statusCode).toBe(200);
    const page = (await boris.get(`/api/pages/${fresh}`)).json().page;
    expect(page).toMatchObject({ title: "Projet", icon: "🚀", template: false });

    const children = app.db.select().from(pages).where(eq(pages.parentId, fresh)).all();
    const newTasks = children.find((c) => c.kind === "database")!;
    const newNotes = children.find((c) => c.kind === "page")!;
    expect(newTasks.title).toBe("Tâches");
    expect(newNotes.title).toBe("Notes");
    const body = content(fresh).content!;
    expect(body[0]!.attrs!.pageId).toBe(newTasks.id);
    expect(body[1]!.content![0]!.attrs!.pageId).toBe(newNotes.id);
    expect(body[2]!.attrs!.sources).toEqual([{ databaseId: newTasks.id, propertyId: null, color: "blue" }]);
    expect(body[2]!.attrs!.id).not.toBe("cal1");

    const newProps = app.db.select().from(databaseProperties).where(eq(databaseProperties.databaseId, newTasks.id)).all();
    const newDone = newProps.find((p) => p.name === "Fait")!;
    expect(newDone.id).not.toBe(done.id);
    const newView = app.db.select().from(databaseViews).where(eq(databaseViews.databaseId, newTasks.id)).get()!;
    expect(newView.config).toEqual({ filters: [{ propertyId: newDone.id, operator: "unchecked" }] });
    const copied = (await boris.get(`/api/databases/${newTasks.id}`)).json().database;
    expect(copied.rows).toHaveLength(1);
    expect(copied.rows[0].values[newDone.id]).toBe(false);
    // The original is untouched.
    expect((await boris.get(`/api/databases/${tasks.id}`)).json().database.rows).toHaveLength(1);
  });

  it("refuses rows, a page inside the template, and templates the user can't read", async () => {
    const ws = await boris.personalWorkspace();
    const tpl = await boris.createPage(ws, "Modèle");
    await boris.patch(`/api/pages/${tpl}`, { template: true });
    const inside = await boris.createPage(ws, "", tpl);
    expect((await boris.post(`/api/pages/${inside}/apply-template`, { templateId: tpl })).statusCode).toBe(400);
    const notTemplate = await boris.createPage(ws, "Autre");
    const target = await boris.createPage(ws, "");
    expect((await boris.post(`/api/pages/${target}/apply-template`, { templateId: notTemplate })).statusCode).toBe(400);

    const db = await invoices();
    const row = (await boris.post(`/api/databases/${db.id}/rows`, { values: {} })).json().row;
    expect((await boris.patch(`/api/pages/${row.id}`, { template: true })).statusCode).toBe(400);

    const alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "motdepasse-alice" });
    expect((await alice.get("/api/pages/templates")).json().pages).toEqual([]);
    const own = await alice.createPage(await alice.personalWorkspace(), "");
    expect((await alice.post(`/api/pages/${own}/apply-template`, { templateId: tpl })).statusCode).toBe(404);
  });
});

describe("duplicating a page", () => {
  it("copies it with its subpages right after it, and its link in the parent", async () => {
    const ws = await boris.personalWorkspace();
    const parent = await boris.createPage(ws, "Projets");
    const page = (await boris.post("/api/pages", { workspaceId: ws, parentId: parent, title: "Cuisine", linkInParent: true })).json().page.id;
    await boris.createPage(ws, "Devis", page);
    await boris.createPage(ws, "Salle de bain", parent);
    const res = await boris.post(`/api/pages/${page}/duplicate`);
    expect(res.statusCode, res.body).toBe(200);
    const copy = res.json().page;
    expect(copy).toMatchObject({ title: "Cuisine (copie)", parentId: parent });
    const tree = (await boris.get(`/api/workspaces/${ws}/pages`)).json().pages as { id: string; title: string; parentId: string | null }[];
    expect(tree.filter((p) => p.parentId === parent).map((p) => p.title)).toEqual(["Cuisine", "Cuisine (copie)", "Salle de bain"]);
    expect(tree.filter((p) => p.parentId === copy.id).map((p) => p.title)).toEqual(["Devis"]);
    const links = JSON.stringify(content(parent));
    expect(links).toContain(copy.id);

    const alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
    await boris.put(`/api/pages/${page}/shares`, { userId: await alice.id(), role: "viewer" });
    expect((await alice.post(`/api/pages/${page}/duplicate`)).statusCode).toBe(404);
  });
});
