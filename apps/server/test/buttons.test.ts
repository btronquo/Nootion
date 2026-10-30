import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { ButtonConfigInput } from "@nootion/shared";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let boris: Client;
let team: string;
let db: string;
let col: Record<string, string>;
const NOW = "2026-11-02T08:30";

beforeEach(async () => {
  app = await makeApp();
  boris = await setupAdmin(app);
  team = (await boris.post("/api/workspaces", { name: "Maison" })).json().workspace.id;
  const database = (await boris.post("/api/databases", { workspaceId: team, parentId: null, title: "Dépenses" })).json().database;
  db = database.id;
  col = { Nom: database.properties.find((p: { type: string }) => p.type === "title").id };
  for (const [name, type, config] of [
    ["Montant", "number", {}],
    [
      "Statut",
      "select",
      {
        options: [
          { id: "a", name: "À payer" },
          { id: "b", name: "Payé" },
        ],
      },
    ],
    ["Date", "date", {}],
    ["Qui", "person", {}],
    ["Fait", "checkbox", {}],
  ] as const) {
    col[name] = (await boris.post(`/api/databases/${db}/properties`, { name, type, config })).json().property.id;
  }
});

afterEach(async () => {
  await app.close();
});

/** A page holding one button block. */
async function pageWithButton(config: ButtonConfigInput, title = "Tableau de bord") {
  const page = await boris.createPage(team, title);
  const content = { type: "doc", content: [{ type: "buttonBlock", attrs: { id: "btn-1", config: { label: "Ajouter", ...config } } }] };
  expect((await boris.put(`/api/pages/${page}/content`, { content })).statusCode).toBe(200);
  return page;
}

const run = (c: Client, body: Record<string, unknown>) => c.post("/api/buttons/run", { now: NOW, ...body });

describe("buttons", () => {
  it("add a row from a form's answers, then open it", async () => {
    const page = await pageWithButton({
      form: {
        title: "Nouvelle dépense",
        fields: [
          { id: "f1", label: "Quoi", type: "text", required: true },
          { id: "f2", label: "Montant", type: "number", required: true },
          { id: "f3", label: "Payée", type: "checkbox", required: false },
        ],
      },
      steps: [
        {
          type: "add_row",
          databaseId: db,
          values: {
            [col.Nom!]: "{{form.Quoi}}",
            [col.Montant!]: "{{form.Montant}}",
            [col.Statut!]: "À payer",
            [col.Date!]: "{{today}}",
            [col.Qui!]: "me",
            [col.Fait!]: "{{form.Payée}}",
          },
          content: "Saisie par {{user}} depuis « {{page.title}} ».",
          open: true,
        },
      ],
    });

    const missing = await run(boris, { source: { kind: "block", pageId: page, blockId: "btn-1" }, form: { f2: 12 } });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().message).toBe("« Quoi » est obligatoire.");

    const res = await run(boris, { source: { kind: "block", pageId: page, blockId: "btn-1" }, form: { f1: "Boulangerie", f2: "4,20", f3: true } });
    expect(res.statusCode, res.body).toBe(200);
    const { created, open } = res.json();
    expect(created).toEqual([{ id: expect.any(String), title: "Boulangerie" }]);
    expect(open).toBe(`/page/${created[0].id}`);

    const row = (await boris.get(`/api/databases/${db}/rows/${created[0].id}`)).json().row;
    expect(row.values).toMatchObject({
      [col.Montant!]: 4.2,
      [col.Statut!]: "a",
      [col.Date!]: { start: "2026-11-02", end: null },
      [col.Qui!]: [await boris.id()],
      [col.Fait!]: true,
    });
    expect((await boris.get(`/api/pages/${created[0].id}/content`)).json().markdown).toBe("Saisie par Boris depuis « Tableau de bord ».");
  });

  it("change the current row, create a page and call a webhook from a button column", async () => {
    const received: unknown[] = [];
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push(JSON.parse(body));
        res.end("ok");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const hook = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
    try {
      const notes = await boris.createPage(team, "Notes");
      const button = (
        await boris.post(`/api/databases/${db}/properties`, {
          name: "Régler",
          type: "button",
          config: {
            button: {
              label: "Payer",
              steps: [
                { type: "update_row", values: { [col.Statut!]: "Payé", [col.Fait!]: "true" } },
                { type: "create_page", parentId: notes, title: "Reçu {{row.Nom}} ({{row.Montant}} €)", content: "Payé le {{today}}." },
                { type: "webhook", url: hook },
                { type: "webhook", url: hook, body: '{"text": "{{row.Nom}} payé par {{user}}"}' },
                { type: "open", url: "{{created.url}}" },
              ],
            },
          },
        })
      ).json().property;
      const row = (await boris.post(`/api/databases/${db}/rows`, { values: { Nom: 'Facture "EDF"', Montant: 80, Statut: "À payer" } })).json().row;

      const res = await run(boris, { source: { kind: "column", databaseId: db, propertyId: button.id, rowId: row.id } });
      expect(res.statusCode, res.body).toBe(200);
      const { created, open } = res.json();
      expect(created[0].title).toBe('Reçu Facture "EDF" (80 €)');
      expect(open).toBe(`/page/${created[0].id}`);
      expect((await boris.get(`/api/databases/${db}/rows/${row.id}`)).json().row.values).toMatchObject({ [col.Statut!]: "b", [col.Fait!]: true });
      expect((await boris.get(`/api/pages/${created[0].id}`)).json().page.parentId).toBe(notes);

      expect(received[0]).toMatchObject({
        button: "Payer",
        user: { name: "Boris" },
        row: { id: row.id, values: { Nom: 'Facture "EDF"', Montant: "80", Statut: "Payé" } },
        created: [{ id: created[0].id }],
      });
      // Values are escaped inside a JSON body.
      expect(received[1]).toEqual({ text: 'Facture "EDF" payé par Boris' });
    } finally {
      server.close();
    }
  });

  it("say which step failed, and run steps with the clicker's rights", async () => {
    const page = await pageWithButton({
      steps: [
        { type: "open", url: "/page/x" },
        { type: "update_row", values: {} },
      ],
    });
    const res = await run(boris, { source: { kind: "block", pageId: page, blockId: "btn-1" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/^Étape 2 : Cette étape modifie la ligne en cours/);

    const adder = await pageWithButton({ steps: [{ type: "add_row", databaseId: db, values: { [col.Nom!]: "Test" } }] }, "Ajouts");
    const alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
    await boris.put(`/api/workspaces/${team}/members`, { userId: await alice.id(), role: "viewer" });
    const denied = await run(alice, { source: { kind: "block", pageId: adder, blockId: "btn-1" } });
    expect(denied.statusCode).toBe(404);
    expect(denied.json().message).toMatch(/^Étape 1 : /);
    expect((await boris.post(`/api/databases/${db}/query`, {})).json().total).toBe(0);

    // Someone who can't see the page can't run its buttons.
    const carol = await inviteUser(app, boris, { name: "Carol", email: "carol@example.com", password: "carol-password" });
    expect((await run(carol, { source: { kind: "block", pageId: adder, blockId: "btn-1" } })).statusCode).toBe(404);
    expect((await run(boris, { source: { kind: "block", pageId: adder, blockId: "nope" } })).statusCode).toBe(404);
  });

  it("are published without what they do", async () => {
    const hook = "https://hooks.example.com/secret-123";
    const page = await pageWithButton({ steps: [{ type: "webhook", url: hook }] });
    await boris.post(`/api/databases/${db}/properties`, {
      name: "B",
      type: "button",
      config: { button: { label: "Go", steps: [{ type: "webhook", url: hook }] } },
    });
    await boris.post(`/api/pages/${db}/move`, { parentId: page });
    const link = (await boris.put(`/api/pages/${page}/public-link`, { includeSubpages: true })).json().link;
    const pub = new Client(app);
    const content = (await pub.get(`/api/public/${link.token}/pages/${page}`)).json().page.content;
    expect(content.content[0].attrs.config.label).toBe("Ajouter");
    expect(JSON.stringify(content)).not.toContain("secret-123");
    const database = await pub.get(`/api/public/${link.token}/databases/${db}`);
    expect(database.statusCode).toBe(200);
    expect(database.body).not.toContain("secret-123");
  });

  it("take answers from people without an account through a public form", async () => {
    const notes = await boris.createPage(team, "Notes");
    const page = await pageWithButton({ steps: [{ type: "add_row", databaseId: db, values: { [col.Nom!]: "x" } }] });
    expect((await boris.put("/api/buttons/public-link", { pageId: page, blockId: "btn-1" })).json().message).toBe("Ajoutez d'abord un formulaire au bouton.");

    const form = await pageWithButton(
      {
        label: "Proposer",
        form: { title: "Une idée de sortie ?", fields: [{ id: "f1", label: "Idée", type: "text", required: true }] },
        steps: [
          { type: "add_row", databaseId: db, values: { [col.Nom!]: "{{form.Idée}}", [col.Date!]: "{{today}}", [col.Qui!]: "me" } },
          { type: "create_page", parentId: notes, title: "Ne doit pas être créée" },
        ],
      },
      "Idées",
    );
    const { link } = (await boris.put("/api/buttons/public-link", { pageId: form, blockId: "btn-1" })).json();
    expect(link.url).toBe(`http://localhost:3000/f/${link.token}`);
    expect((await boris.put("/api/buttons/public-link", { pageId: form, blockId: "btn-1" })).json().link.token).toBe(link.token);

    const anon = new Client(app);
    expect((await anon.get(`/api/forms/${link.token}`)).json()).toEqual({
      title: "Une idée de sortie ?",
      submitLabel: "Proposer",
      color: "default",
      fields: [{ id: "f1", label: "Idée", type: "text", required: true }],
    });
    expect((await anon.post(`/api/forms/${link.token}`, { now: NOW, form: {} })).statusCode).toBe(400);
    const sent = await anon.post(`/api/forms/${link.token}`, { now: NOW, form: { f1: "Pique-nique" } });
    expect(sent.statusCode, sent.body).toBe(200);
    const rows = (await boris.post(`/api/databases/${db}/query`, {})).json().rows;
    expect(rows).toHaveLength(1);
    // "me" means nobody here: the person column stays empty; only the allowed steps ran.
    expect(rows[0]).toMatchObject({ title: "Pique-nique", createdBy: await boris.id(), values: { [col.Date!]: { start: "2026-11-02" } } });
    expect(rows[0].values[col.Qui!] ?? null).toBeNull();
    expect((await boris.get(`/api/workspaces/${team}/pages`)).json().pages.map((p: { title: string }) => p.title)).not.toContain("Ne doit pas être créée");

    // The internal headers can't be used from outside.
    const spoof = await anon.request("GET", "/api/auth/me", undefined, { "x-nootion-act-as": await boris.id(), "x-nootion-internal": "guess" });
    expect(spoof.statusCode).toBe(401);

    await boris.request("DELETE", "/api/buttons/public-link", { pageId: form, blockId: "btn-1" });
    expect((await anon.get(`/api/forms/${link.token}`)).statusCode).toBe(404);
  });
});
