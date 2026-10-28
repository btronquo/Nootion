import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { DatabaseData, DatabaseProperty } from "@nootion/shared";
import { eq } from "drizzle-orm";
import { pages } from "../src/db/schema.js";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let boris: Client;
let alice: Client;

beforeEach(async () => {
  app = await makeApp();
  boris = await setupAdmin(app);
  alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
});

async function createDb(c: Client, title = "Factures", parentId: string | null = null): Promise<DatabaseData> {
  const res = await c.post("/api/databases", { workspaceId: await c.personalWorkspace(), parentId, title });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().database;
}
async function addProp(c: Client, dbId: string, name: string, type: string, config = {}): Promise<DatabaseProperty> {
  const res = await c.post(`/api/databases/${dbId}/properties`, { name, type, config });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().property;
}
const getDb = async (c: Client, id: string): Promise<DatabaseData> => (await c.get(`/api/databases/${id}`)).json().database;

describe("databases", () => {
  it("crée une database avec une colonne titre et une vue tableau", async () => {
    const d = await createDb(boris);
    expect(d.properties.map((p) => p.type)).toEqual(["title", "multi_select"]);
    expect(d.views).toHaveLength(1);
    expect(d.rows).toEqual([]);
    // It shows in the sidebar, as a database.
    const pages = (await boris.get(`/api/workspaces/${await boris.personalWorkspace()}/pages`)).json().pages;
    expect(pages).toEqual([expect.objectContaining({ id: d.id, kind: "database", title: "Factures" })]);
  });

  it("ajoute des lignes typées, et les lignes n'apparaissent pas dans l'arborescence", async () => {
    const d = await createDb(boris);
    const titleId = d.properties[0].id;
    const ht = await addProp(boris, d.id, "Montant HT", "currency");
    expect(ht.config).toEqual({ currency: "EUR", decimals: 2 });
    const date = await addProp(boris, d.id, "Date", "date");
    const paid = await addProp(boris, d.id, "Payée", "checkbox");

    const res = await boris.post(`/api/databases/${d.id}/rows`, {
      values: { [titleId]: "Facture EDF", [ht.id]: 120.5, [date.id]: { start: "2026-10-01" }, [paid.id]: true },
    });
    expect(res.statusCode, res.body).toBe(200);
    const row = res.json().row;
    expect(row.title).toBe("Facture EDF");
    expect(row.values[ht.id]).toBe(120.5);

    const data = await getDb(boris, d.id);
    expect(data.rows).toHaveLength(1);
    const pages = (await boris.get(`/api/workspaces/${await boris.personalWorkspace()}/pages`)).json().pages;
    expect(pages).toHaveLength(1);

    // A row is a page: it opens and can hold content.
    expect((await boris.get(`/api/pages/${row.id}`)).json().page).toMatchObject({ kind: "row", title: "Facture EDF" });
  });

  it("refuse les valeurs invalides", async () => {
    const d = await createDb(boris);
    const n = await addProp(boris, d.id, "Montant", "number");
    const s = await addProp(boris, d.id, "Statut", "select", { options: [{ id: "a", name: "Payée", color: "green" }] });
    const created = await addProp(boris, d.id, "Créée le", "created_time");
    const bad = [
      { [n.id]: "douze" },
      { [s.id]: "inconnue" },
      { [created.id]: "2020-01-01" },
      { nimportequoi: 1 },
    ];
    for (const values of bad) {
      expect((await boris.post(`/api/databases/${d.id}/rows`, { values })).statusCode).toBe(400);
    }
    expect((await boris.post(`/api/databases/${d.id}/rows`, { values: { [s.id]: "a" } })).statusCode).toBe(200);
  });

  it("met à jour une cellule sans toucher aux autres", async () => {
    const d = await createDb(boris);
    const a = await addProp(boris, d.id, "A", "text");
    const b = await addProp(boris, d.id, "B", "number");
    const row = (await boris.post(`/api/databases/${d.id}/rows`, { values: { [a.id]: "x", [b.id]: 1 } })).json().row;
    const upd = await boris.patch(`/api/databases/${d.id}/rows/${row.id}`, { values: { [b.id]: 2 } });
    expect(upd.json().row.values).toMatchObject({ [a.id]: "x", [b.id]: 2 });
    const cleared = await boris.patch(`/api/databases/${d.id}/rows/${row.id}`, { values: { [a.id]: "" } });
    expect(cleared.json().row.values[a.id]).toBeNull();
  });

  it("convertit les valeurs quand une colonne change de type", async () => {
    const d = await createDb(boris);
    const col = await addProp(boris, d.id, "Montant", "text");
    for (const v of ["12,50 €", "abc", "1 000"]) await boris.post(`/api/databases/${d.id}/rows`, { values: { [col.id]: v } });
    await boris.patch(`/api/databases/${d.id}/properties/${col.id}`, { type: "currency" });
    let data = await getDb(boris, d.id);
    expect(data.rows.map((r) => r.values[col.id])).toEqual([12.5, null, 1000]);

    const cat = await addProp(boris, d.id, "Catégorie", "text");
    for (const [i, v] of ["Énergie", "Internet", "énergie"].entries()) {
      await boris.patch(`/api/databases/${d.id}/rows/${data.rows[i].id}`, { values: { [cat.id]: v } });
    }
    const converted = (await boris.patch(`/api/databases/${d.id}/properties/${cat.id}`, { type: "select" })).json().property;
    expect(converted.config.options.map((o: { name: string }) => o.name)).toEqual(["Énergie", "Internet"]);
    data = await getDb(boris, d.id);
    expect(data.rows[0].values[cat.id]).toBe(data.rows[2].values[cat.id]);

    expect((await boris.patch(`/api/databases/${d.id}/properties/${d.properties[0].id}`, { type: "text" })).statusCode).toBe(400);
  });

  it("supprimer une option vide les cellules qui l'utilisaient", async () => {
    const d = await createDb(boris);
    const s = await addProp(boris, d.id, "Statut", "multi_select", {
      options: [
        { id: "a", name: "A", color: "red" },
        { id: "b", name: "B", color: "blue" },
      ],
    });
    const row = (await boris.post(`/api/databases/${d.id}/rows`, { values: { [s.id]: ["a", "b"] } })).json().row;
    await boris.patch(`/api/databases/${d.id}/properties/${s.id}`, { config: { options: [{ id: "b", name: "B", color: "blue" }] } });
    const data = await getDb(boris, d.id);
    expect(data.rows.find((r) => r.id === row.id)!.values[s.id]).toEqual(["b"]);
  });

  it("supprime une colonne et ses valeurs, mais jamais le titre", async () => {
    const d = await createDb(boris);
    const a = await addProp(boris, d.id, "A", "text");
    await boris.post(`/api/databases/${d.id}/rows`, { values: { [a.id]: "x" } });
    expect((await boris.delete(`/api/databases/${d.id}/properties/${a.id}`)).statusCode).toBe(200);
    const data = await getDb(boris, d.id);
    expect(data.properties.find((p) => p.id === a.id)).toBeUndefined();
    expect((await boris.delete(`/api/databases/${d.id}/properties/${d.properties[0].id}`)).statusCode).toBe(400);
  });

  it("met des lignes à la corbeille", async () => {
    const d = await createDb(boris);
    const r1 = (await boris.post(`/api/databases/${d.id}/rows`, {})).json().row;
    const r2 = (await boris.post(`/api/databases/${d.id}/rows`, {})).json().row;
    await boris.post(`/api/databases/${d.id}/rows/delete`, { ids: [r1.id] });
    expect((await getDb(boris, d.id)).rows.map((r) => r.id)).toEqual([r2.id]);
    await boris.post(`/api/pages/${r1.id}/restore`);
    expect((await getDb(boris, d.id)).rows).toHaveLength(2);
  });

  it("personnes et fichiers sont vérifiés", async () => {
    const d = await createDb(boris);
    const who = await addProp(boris, d.id, "Responsable", "person");
    const file = await addProp(boris, d.id, "PDF", "file");
    const aliceId = await alice.id();
    const row = (await boris.post(`/api/databases/${d.id}/rows`, { values: { [who.id]: [aliceId] } })).json().row;
    expect((await getDb(boris, d.id)).people[aliceId]).toBe("Alice");
    expect((await boris.patch(`/api/databases/${d.id}/rows/${row.id}`, { values: { [who.id]: ["inconnu"] } })).statusCode).toBe(400);
    const fake = "00000000-0000-4000-8000-000000000000";
    expect((await boris.patch(`/api/databases/${d.id}/rows/${row.id}`, { values: { [file.id]: [{ id: fake, name: "x.pdf" }] } })).statusCode).toBe(400);
  });
});

describe("databases et droits", () => {
  it("rien n'est visible ni modifiable sans partage", async () => {
    const d = await createDb(boris);
    const row = (await boris.post(`/api/databases/${d.id}/rows`, {})).json().row;
    const attempts = [
      alice.get(`/api/databases/${d.id}`),
      alice.post(`/api/databases/${d.id}/rows`, {}),
      alice.patch(`/api/databases/${d.id}/rows/${row.id}`, { values: {} }),
      alice.get(`/api/databases/${d.id}/rows/${row.id}`),
      alice.post(`/api/databases/${d.id}/properties`, { name: "x", type: "text" }),
      alice.patch(`/api/databases/${d.id}/properties/${d.properties[1].id}`, { name: "x" }),
      alice.delete(`/api/databases/${d.id}/properties/${d.properties[1].id}`),
      alice.patch(`/api/databases/${d.id}/views/${d.views[0].id}`, { name: "x" }),
      alice.post(`/api/databases/${d.id}/rows/delete`, { ids: [row.id] }),
      alice.post("/api/databases", { workspaceId: await boris.personalWorkspace(), parentId: null, title: "x" }),
      alice.post("/api/databases", { workspaceId: await boris.personalWorkspace(), parentId: d.id, title: "x" }),
    ];
    for (const res of await Promise.all(attempts)) expect(res.statusCode).toBe(404);
  });

  it("un lecteur voit les lignes mais ne modifie rien", async () => {
    const d = await createDb(boris);
    const row = (await boris.post(`/api/databases/${d.id}/rows`, {})).json().row;
    await boris.put(`/api/pages/${d.id}/shares`, { userId: await alice.id(), role: "viewer" });
    const data = await getDb(alice, d.id);
    expect(data.role).toBe("viewer");
    expect(data.rows).toHaveLength(1);
    expect((await alice.get(`/api/databases/${d.id}/rows/${row.id}`)).statusCode).toBe(200);
    expect((await alice.post(`/api/databases/${d.id}/rows`, {})).statusCode).toBe(404);
    expect((await alice.patch(`/api/databases/${d.id}/rows/${row.id}`, { values: {} })).statusCode).toBe(404);
    expect((await alice.post(`/api/databases/${d.id}/properties`, { name: "x", type: "text" })).statusCode).toBe(404);
  });

  it("un éditeur ajoute et modifie des lignes", async () => {
    const d = await createDb(boris);
    await boris.put(`/api/pages/${d.id}/shares`, { userId: await alice.id(), role: "editor" });
    const row = (await alice.post(`/api/databases/${d.id}/rows`, { values: { [d.properties[0].id]: "De Alice" } })).json().row;
    expect((await getDb(boris, d.id)).rows[0].title).toBe("De Alice");
    expect((await alice.patch(`/api/databases/${d.id}/rows/${row.id}`, { values: { [d.properties[0].id]: "Modifiée" } })).statusCode).toBe(200);
  });

  it("une ligne ne se déplace pas et une page ne va pas dans une database", async () => {
    const d = await createDb(boris);
    const row = (await boris.post(`/api/databases/${d.id}/rows`, {})).json().row;
    const page = await boris.createPage(await boris.personalWorkspace(), "Page");
    expect((await boris.post(`/api/pages/${row.id}/move`, { parentId: null })).statusCode).toBe(400);
    expect((await boris.post(`/api/pages/${page}/move`, { parentId: d.id })).statusCode).toBe(400);
    expect((await boris.post("/api/pages", { workspaceId: await boris.personalWorkspace(), parentId: d.id, title: "x" })).statusCode).toBe(400);
  });

  it("lien public : database intégrée à la page visible, database simple sous-page non", async () => {
    const page = await boris.createPage(await boris.personalWorkspace(), "Compta");
    const inline = await createDb(boris, "Factures", page);
    const separate = await createDb(boris, "Secret", page);
    const tag = inline.properties[1];
    const row = (await boris.post(`/api/databases/${inline.id}/rows`, { values: { [inline.properties[0].id]: "F1" } })).json().row;
    await boris.post(`/api/databases/${inline.id}/properties`, { name: "Responsable", type: "person" });
    // Content as the editor stores it: the page embeds the first database, and only links to the second.
    app.db
      .update(pages)
      .set({ contentJson: { type: "doc", content: [{ type: "databaseBlock", attrs: { pageId: inline.id } }, { type: "databaseBlock", attrs: { pageId: "autre" } }] } })
      .where(eq(pages.id, page))
      .run();
    // Without subpages: only what is part of the page itself is published.
    const link = (await boris.put(`/api/pages/${page}/public-link`, { includeSubpages: false })).json().link;
    const anon = new Client(app);

    const content = (await anon.get(`/api/public/${link.token}/pages/${page}`)).json().page.content;
    expect(content.content.map((n: { attrs: { pageId: string | null } }) => n.attrs.pageId)).toEqual([inline.id, null]);

    const pub = await anon.get(`/api/public/${link.token}/databases/${inline.id}`);
    expect(pub.statusCode).toBe(200);
    expect(pub.json().database.rows[0].title).toBe("F1");
    expect(pub.json().database.people).toEqual({});
    expect(tag.type).toBe("multi_select");
    const pubRow = (await anon.get(`/api/public/${link.token}/pages/${row.id}`)).json().page;
    expect(pubRow.row.properties.length).toBeGreaterThan(1);

    expect((await anon.get(`/api/public/${link.token}/databases/${separate.id}`)).statusCode).toBe(404);
    // Rows of private databases can't be read either.
    const secretRow = (await boris.post(`/api/databases/${separate.id}/rows`, {})).json().row;
    expect((await anon.get(`/api/public/${link.token}/pages/${secretRow.id}`)).statusCode).toBe(404);
  });
});
