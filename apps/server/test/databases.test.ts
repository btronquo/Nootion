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
  it("creates a database with a title column and a table view", async () => {
    const d = await createDb(boris);
    expect(d.properties.map((p) => p.type)).toEqual(["title", "multi_select"]);
    expect(d.views).toHaveLength(1);
    expect(d.rows).toEqual([]);
    // It shows in the sidebar, as a database.
    const pages = (await boris.get(`/api/workspaces/${await boris.personalWorkspace()}/pages`)).json().pages;
    expect(pages).toEqual([expect.objectContaining({ id: d.id, kind: "database", title: "Factures" })]);
  });

  it("adds typed rows, and rows don't appear in the page tree", async () => {
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

  it("refuses invalid values", async () => {
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

  it("updates a cell without touching the others", async () => {
    const d = await createDb(boris);
    const a = await addProp(boris, d.id, "A", "text");
    const b = await addProp(boris, d.id, "B", "number");
    const row = (await boris.post(`/api/databases/${d.id}/rows`, { values: { [a.id]: "x", [b.id]: 1 } })).json().row;
    const upd = await boris.patch(`/api/databases/${d.id}/rows/${row.id}`, { values: { [b.id]: 2 } });
    expect(upd.json().row.values).toMatchObject({ [a.id]: "x", [b.id]: 2 });
    const cleared = await boris.patch(`/api/databases/${d.id}/rows/${row.id}`, { values: { [a.id]: "" } });
    expect(cleared.json().row.values[a.id]).toBeNull();
  });

  it("converts values when a column changes type", async () => {
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

  it("deleting an option empties the cells that used it", async () => {
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

  it("deletes a column and its values, but never the title", async () => {
    const d = await createDb(boris);
    const a = await addProp(boris, d.id, "A", "text");
    await boris.post(`/api/databases/${d.id}/rows`, { values: { [a.id]: "x" } });
    expect((await boris.delete(`/api/databases/${d.id}/properties/${a.id}`)).statusCode).toBe(200);
    const data = await getDb(boris, d.id);
    expect(data.properties.find((p) => p.id === a.id)).toBeUndefined();
    expect((await boris.delete(`/api/databases/${d.id}/properties/${d.properties[0].id}`)).statusCode).toBe(400);
  });

  it("moves rows to the trash", async () => {
    const d = await createDb(boris);
    const r1 = (await boris.post(`/api/databases/${d.id}/rows`, {})).json().row;
    const r2 = (await boris.post(`/api/databases/${d.id}/rows`, {})).json().row;
    await boris.post(`/api/databases/${d.id}/rows/delete`, { ids: [r1.id] });
    expect((await getDb(boris, d.id)).rows.map((r) => r.id)).toEqual([r2.id]);
    await boris.post(`/api/pages/${r1.id}/restore`);
    expect((await getDb(boris, d.id)).rows).toHaveLength(2);
  });

  it("people and files are checked", async () => {
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

describe("databases and access", () => {
  it("nothing is visible or editable without a share", async () => {
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

  it("a viewer sees the rows but changes nothing", async () => {
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

  it("an editor adds and edits rows", async () => {
    const d = await createDb(boris);
    await boris.put(`/api/pages/${d.id}/shares`, { userId: await alice.id(), role: "editor" });
    const row = (await alice.post(`/api/databases/${d.id}/rows`, { values: { [d.properties[0].id]: "De Alice" } })).json().row;
    expect((await getDb(boris, d.id)).rows[0].title).toBe("De Alice");
    expect((await alice.patch(`/api/databases/${d.id}/rows/${row.id}`, { values: { [d.properties[0].id]: "Modifiée" } })).statusCode).toBe(200);
  });

  it("a row can't be moved and a page can't go into a database", async () => {
    const d = await createDb(boris);
    const row = (await boris.post(`/api/databases/${d.id}/rows`, {})).json().row;
    const page = await boris.createPage(await boris.personalWorkspace(), "Page");
    expect((await boris.post(`/api/pages/${row.id}/move`, { parentId: null })).statusCode).toBe(400);
    expect((await boris.post(`/api/pages/${page}/move`, { parentId: d.id })).statusCode).toBe(400);
    expect((await boris.post("/api/pages", { workspaceId: await boris.personalWorkspace(), parentId: d.id, title: "x" })).statusCode).toBe(400);
  });

  it("public link: a database embedded in the page is visible, a database subpage is not", async () => {
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

describe("relations and rollups", () => {
  async function setup() {
    const fournisseurs = await createDb(boris, "Fournisseurs");
    const factures = await createDb(boris, "Factures");
    const montant = await addProp(boris, factures.id, "Montant", "currency");
    const payee = await addProp(boris, factures.id, "Payée", "checkbox");
    const res = await boris.post(`/api/databases/${factures.id}/properties`, {
      name: "Fournisseur",
      type: "relation",
      config: { databaseId: fournisseurs.id },
      twoWay: true,
    });
    expect(res.statusCode, res.body).toBe(200);
    const relation: DatabaseProperty = res.json().property;
    const twin = (await getDb(boris, fournisseurs.id)).properties.find((p) => p.type === "relation")!;
    expect(twin.name).toBe("Factures");
    expect(twin.config).toMatchObject({ databaseId: factures.id, twinPropertyId: relation.id });
    expect(relation.config.twinPropertyId).toBe(twin.id);
    const title = (d: DatabaseData) => d.properties[0].id;
    const free = (await boris.post(`/api/databases/${fournisseurs.id}/rows`, { values: { [title(fournisseurs)]: "Free" } })).json().row;
    const edf = (await boris.post(`/api/databases/${fournisseurs.id}/rows`, { values: { [title(fournisseurs)]: "EDF" } })).json().row;
    const add = async (name: string, amount: number, paid: boolean, to: string) =>
      (
        await boris.post(`/api/databases/${factures.id}/rows`, {
          values: { [title(factures)]: name, [montant.id]: amount, [payee.id]: paid, [relation.id]: [to] },
        })
      ).json();
    return { fournisseurs, factures, montant, payee, relation, twin, free, edf, add };
  }

  it("two-way relation, kept up to date on both sides", async () => {
    const s = await setup();
    const f1 = await s.add("F1", 29.99, true, s.free.id);
    expect(f1.related[s.free.id].title).toBe("Free");
    await s.add("F2", 30, false, s.free.id);
    let fournisseurs = await getDb(boris, s.fournisseurs.id);
    expect(fournisseurs.rows.find((r) => r.id === s.free.id)!.values[s.twin.id]).toHaveLength(2);
    expect(fournisseurs.related[f1.row.id].title).toBe("F1");

    // Moving F1 to EDF updates both suppliers.
    await boris.patch(`/api/databases/${s.factures.id}/rows/${f1.row.id}`, { values: { [s.relation.id]: [s.edf.id] } });
    fournisseurs = await getDb(boris, s.fournisseurs.id);
    expect(fournisseurs.rows.find((r) => r.id === s.free.id)!.values[s.twin.id]).toHaveLength(1);
    expect(fournisseurs.rows.find((r) => r.id === s.edf.id)!.values[s.twin.id]).toEqual([f1.row.id]);

    // A row of another database is refused.
    const other = await createDb(boris, "Autre");
    const stranger = (await boris.post(`/api/databases/${other.id}/rows`, {})).json().row;
    expect((await boris.patch(`/api/databases/${s.factures.id}/rows/${f1.row.id}`, { values: { [s.relation.id]: [stranger.id] } })).statusCode).toBe(400);

    // Trashed rows disappear from relations.
    await boris.post(`/api/databases/${s.factures.id}/rows/delete`, { ids: [f1.row.id] });
    fournisseurs = await getDb(boris, s.fournisseurs.id);
    expect(fournisseurs.rows.find((r) => r.id === s.edf.id)!.values[s.twin.id]).toBeNull();

    // Deleting one side keeps the other as a one-way relation.
    await boris.delete(`/api/databases/${s.factures.id}/properties/${s.relation.id}`);
    const twin = (await getDb(boris, s.fournisseurs.id)).properties.find((p) => p.id === s.twin.id)!;
    expect(twin.config.twinPropertyId).toBeNull();
  });

  it("rollups: sum, % checked, original values", async () => {
    const s = await setup();
    await s.add("F1", 29.99, true, s.free.id);
    await s.add("F2", 30.01, false, s.free.id);
    await s.add("F3", 84.5, true, s.edf.id);
    const rollup = async (name: string, targetPropertyId: string, rollupFunction: string) => {
      const res = await boris.post(`/api/databases/${s.fournisseurs.id}/properties`, {
        name,
        type: "rollup",
        config: { relationPropertyId: s.twin.id, targetPropertyId, rollupFunction },
      });
      expect(res.statusCode, res.body).toBe(200);
      return res.json().property as DatabaseProperty;
    };
    const total = await rollup("Total", s.montant.id, "sum");
    const pct = await rollup("Payées", s.payee.id, "percent_checked");
    const names = await rollup("Noms", s.factures.properties[0].id, "show_original");
    const d = await getDb(boris, s.fournisseurs.id);
    const free = d.rows.find((r) => r.id === s.free.id)!;
    expect(free.values[total.id]).toEqual({ kind: "number", value: 60 });
    expect(free.values[pct.id]).toEqual({ kind: "percent", value: 50 });
    expect(free.values[names.id]).toEqual({ kind: "list", values: ["F1", "F2"] });
    expect(d.rollupTargets[total.id]?.type).toBe("currency");
    // Rollup values can't be written, and a rollup must follow a relation.
    expect((await boris.patch(`/api/databases/${s.fournisseurs.id}/rows/${s.free.id}`, { values: { [total.id]: 1 } })).statusCode).toBe(400);
    expect(
      (await boris.post(`/api/databases/${s.fournisseurs.id}/properties`, { name: "x", type: "rollup", config: { relationPropertyId: d.properties[0].id } }))
        .statusCode,
    ).toBe(400);
    // Relations and rollups don't convert to other types.
    expect((await boris.patch(`/api/databases/${s.fournisseurs.id}/properties/${total.id}`, { type: "number" })).statusCode).toBe(400);
  });

  it("access: no relation to an invisible database, nothing leaks when reading", async () => {
    const s = await setup();
    await s.add("F1", 29.99, true, s.free.id);
    // Alice can see the invoices but not the suppliers.
    await boris.put(`/api/pages/${s.factures.id}/shares`, { userId: await alice.id(), role: "editor" });
    const seen = await getDb(alice, s.factures.id);
    expect(seen.rows[0].values[s.relation.id]).toBeNull();
    expect(Object.keys(seen.related)).toHaveLength(0);
    // She can't link to rows she can't see.
    expect((await alice.patch(`/api/databases/${s.factures.id}/rows/${seen.rows[0].id}`, { values: { [s.relation.id]: [s.edf.id] } })).statusCode).toBe(404);
    // Nor create a relation to a database she can't see.
    const mine = await createDb(alice, "Mes notes");
    expect((await alice.post(`/api/databases/${mine.id}/properties`, { name: "r", type: "relation", config: { databaseId: s.fournisseurs.id } })).statusCode).toBe(404);
    expect((await alice.get("/api/databases")).json().databases.map((d: { id: string }) => d.id)).not.toContain(s.fournisseurs.id);
  });
});

describe("formula columns", () => {
  const formula = (dbId: string, name: string, expression: string) => boris.post(`/api/databases/${dbId}/properties`, { name, type: "formula", config: { expression } });

  it("computes, chains formulas, follows renames and reports errors", async () => {
    const d = await createDb(boris);
    const ht = await addProp(boris, d.id, "HT", "currency");
    const payee = await addProp(boris, d.id, "Payée", "checkbox");
    const row = (await boris.post(`/api/databases/${d.id}/rows`, { values: { [d.properties[0].id]: "F1", [ht.id]: 100 } })).json().row;
    const ttc = (await formula(d.id, "TTC", 'prop("HT") * 1.2')).json().property as DatabaseProperty;
    const label = (await formula(d.id, "Libellé", 'prop("Nom") + " : " + prop("TTC") + if(prop("Payée"), " (payée)", "")')).json().property as DatabaseProperty;
    let data = await getDb(boris, d.id);
    expect(data.rows[0].values[ttc.id]).toEqual({ kind: "number", value: 120 });
    expect(data.rows[0].values[label.id]).toEqual({ kind: "text", value: "F1 : 120" });

    // Editing a cell recomputes the formulas in the response.
    const res = await boris.patch(`/api/databases/${d.id}/rows/${row.id}`, { values: { [payee.id]: true } });
    expect(res.json().row.values[label.id]).toEqual({ kind: "text", value: "F1 : 120 (payée)" });

    // Renaming a column rewrites the formulas that use it.
    await boris.patch(`/api/databases/${d.id}/properties/${ht.id}`, { name: "Montant HT" });
    data = await getDb(boris, d.id);
    expect(data.properties.find((p) => p.id === ttc.id)!.config.expression).toBe('prop("Montant HT") * 1.2');
    expect(data.rows[0].values[ttc.id]).toEqual({ kind: "number", value: 120 });

    // Invalid formulas are refused when saved…
    expect((await formula(d.id, "X", 'prop("Nope") + 1')).statusCode).toBe(400);
    expect((await formula(d.id, "X", "1 +")).statusCode).toBe(400);
    expect((await boris.patch(`/api/databases/${d.id}/properties/${ttc.id}`, { config: { expression: 'prop("Libellé")' } })).statusCode).toBe(400);
    // …and errors at run time stay in their cell.
    const ratio = (await formula(d.id, "Ratio", 'prop("Montant HT") / 0')).json().property as DatabaseProperty;
    data = await getDb(boris, d.id);
    expect(data.rows[0].values[ratio.id]).toEqual({ kind: "error", value: "Division par zéro." });
    // Formula cells can't be written.
    expect((await boris.patch(`/api/databases/${d.id}/rows/${row.id}`, { values: { [ttc.id]: 1 } })).statusCode).toBe(400);
  });

  it("formulas on relations, and rollup of a formula", async () => {
    const fournisseurs = await createDb(boris, "Fournisseurs");
    const factures = await createDb(boris, "Factures");
    const ht = await addProp(boris, factures.id, "HT", "currency");
    const rel = (
      await boris.post(`/api/databases/${factures.id}/properties`, { name: "Fournisseur", type: "relation", config: { databaseId: fournisseurs.id }, twoWay: true })
    ).json().property as DatabaseProperty;
    const twin = (await getDb(boris, fournisseurs.id)).properties.find((p) => p.type === "relation")!;
    const ttc = (await formula(factures.id, "TTC", 'prop("HT") * 1.2')).json().property as DatabaseProperty;
    const who = (await formula(factures.id, "Chez", 'join(prop("Fournisseur"), ", ")')).json().property as DatabaseProperty;
    const free = (await boris.post(`/api/databases/${fournisseurs.id}/rows`, { values: { [fournisseurs.properties[0].id]: "Free" } })).json().row;
    for (const amount of [10, 20]) await boris.post(`/api/databases/${factures.id}/rows`, { values: { [ht.id]: amount, [rel.id]: [free.id] } });
    expect((await getDb(boris, factures.id)).rows[0].values[who.id]).toEqual({ kind: "text", value: "Free" });
    const total = (
      await boris.post(`/api/databases/${fournisseurs.id}/properties`, {
        name: "Total TTC",
        type: "rollup",
        config: { relationPropertyId: twin.id, targetPropertyId: ttc.id, rollupFunction: "sum" },
      })
    ).json().property as DatabaseProperty;
    const count = (await formula(fournisseurs.id, "Résumé", 'format(length(prop("Factures"))) + " factures, " + prop("Total TTC") + " €"')).json()
      .property as DatabaseProperty;
    const data = await getDb(boris, fournisseurs.id);
    expect(data.rows[0].values[total.id]).toEqual({ kind: "number", value: 36 });
    expect(data.rows[0].values[count.id]).toEqual({ kind: "text", value: "2 factures, 36 €" });
  });

  it("views: create, duplicate, configure, delete", async () => {
    const d = await createDb(boris);
    const first = d.views[0];
    const tag = d.properties[1];
    const config = { filters: [{ propertyId: tag.id, operator: "is_not_empty" }], sorts: [{ propertyId: d.properties[0].id, direction: "desc" }], groupBy: tag.id };
    expect((await boris.patch(`/api/databases/${d.id}/views/${first.id}`, { config })).statusCode).toBe(200);
    // Bad settings are refused.
    const bad = await boris.patch(`/api/databases/${d.id}/views/${first.id}`, { config: { filters: [{ propertyId: tag.id, operator: "nope" }] } });
    expect(bad.statusCode).toBe(400);

    const board = await boris.post(`/api/databases/${d.id}/views`, { name: "Kanban", type: "board" });
    expect(board.statusCode, board.body).toBe(200);
    const copy = (await boris.post(`/api/databases/${d.id}/views`, { name: "Copie", duplicateOf: first.id })).json().view;
    expect(copy.config).toEqual(config);
    expect((await boris.post(`/api/databases/${d.id}/views`, { name: "x", type: "timeline" })).statusCode).toBe(400);
    // Alice can't touch the views of a database she can't see.
    expect((await alice.post(`/api/databases/${d.id}/views`, { name: "x" })).statusCode).toBe(404);

    let data = await getDb(boris, d.id);
    expect(data.views.map((v) => [v.name, v.type])).toEqual([
      ["Tableau", "table"],
      ["Kanban", "board"],
      ["Copie", "table"],
    ]);
    expect((await boris.delete(`/api/databases/${d.id}/views/${first.id}`)).statusCode).toBe(200);
    expect((await boris.delete(`/api/databases/${d.id}/views/${copy.id}`)).statusCode).toBe(200);
    // The last view stays.
    expect((await boris.delete(`/api/databases/${d.id}/views/${board.json().view.id}`)).statusCode).toBe(400);
    data = await getDb(boris, d.id);
    expect(data.views.map((v) => v.name)).toEqual(["Kanban"]);
  });

  it("gallery cards show the row's cover, or else the first image of its content", async () => {
    const d = await createDb(boris);
    const row = async (title: string) => (await boris.post(`/api/databases/${d.id}/rows`, { values: { [d.properties[0].id]: title } })).json().row.id as string;
    const [withCover, withImage, plain] = [await row("A"), await row("B"), await row("C")];
    await boris.patch(`/api/pages/${withCover}`, { cover: "gradient:ocean" });
    const content = [
      { type: "paragraph", content: [{ type: "text", text: "src" }] },
      { type: "image", attrs: { src: "https://example.org/first.png", alt: null } },
      { type: "image", attrs: { src: "https://example.org/second.png" } },
    ];
    app.db.update(pages).set({ contentJson: { type: "doc", content } }).where(eq(pages.id, withImage)).run();
    const covers = async () => Object.fromEntries((await getDb(boris, d.id)).rows.map((r) => [r.title, r.cover]));
    // Without a gallery, content isn't read.
    expect(await covers()).toEqual({ A: "gradient:ocean", B: null, C: null });
    const gallery = await boris.post(`/api/databases/${d.id}/views`, { name: "Galerie", type: "gallery" });
    expect(gallery.statusCode).toBe(200);
    expect(await covers()).toEqual({ A: "gradient:ocean", B: "https://example.org/first.png", C: null });
    expect(plain).toBeTruthy();

    const calendar = await boris.post(`/api/databases/${d.id}/views`, { name: "Agenda", type: "calendar" });
    const id = calendar.json().view.id;
    expect((await boris.patch(`/api/databases/${d.id}/views/${id}`, { config: { calendarMode: "week", dateProperty: "x" } })).statusCode).toBe(200);
    expect((await boris.patch(`/api/databases/${d.id}/views/${id}`, { config: { calendarMode: "year" } })).statusCode).toBe(400);
  });
});
