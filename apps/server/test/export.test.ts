import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import yauzl from "yauzl";
import { eq } from "drizzle-orm";
import { attachments, pages } from "../src/db/schema.js";
import { parseCsv } from "../src/import.js";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let boris: Client;
let alice: Client;

beforeEach(async () => {
  app = await makeApp();
  boris = await setupAdmin(app);
  alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
});

/** Files of a zip, as text (binary files too: tests only use small text files). */
function unzip(buf: Buffer): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      const out: Record<string, string> = {};
      zip.on("entry", (entry: yauzl.Entry) => {
        zip.openReadStream(entry, (e, stream) => {
          if (e) return reject(e);
          const chunks: Buffer[] = [];
          stream.on("data", (c: Buffer) => chunks.push(c));
          stream.on("end", () => {
            out[entry.fileName] = Buffer.concat(chunks).toString("utf8");
            zip.readEntry();
          });
        });
      });
      zip.on("end", () => resolve(out));
      zip.readEntry();
    });
  });
}

const setContent = (id: string, content: unknown[]) =>
  app.db
    .update(pages)
    .set({ contentJson: { type: "doc", content } })
    .where(eq(pages.id, id))
    .run();

async function invoices(c: Client, parentId: string | null = null) {
  const ws = await c.personalWorkspace();
  const d = (await c.post("/api/databases", { workspaceId: ws, parentId, title: "Factures" })).json().database;
  const prop = async (name: string, type: string, config = {}) =>
    (await c.post(`/api/databases/${d.id}/properties`, { name, type, config })).json().property;
  const amount = await prop("Montant", "currency");
  const paid = await prop("Payée", "checkbox");
  const due = await prop("Échéance", "date");
  const ttc = await prop("TTC", "formula", { expression: 'prop("Montant") * 1.2' });
  const row = async (title: string, values: Record<string, unknown>) =>
    (await c.post(`/api/databases/${d.id}/rows`, { values: { [d.properties[0].id]: title, ...values } })).json().row;
  await row("EDF, octobre", { [amount.id]: 100, [paid.id]: true, [due.id]: { start: "2026-10-15" } });
  await row('Free "box"', { [amount.id]: 29.99 });
  return { d, amount, paid, due, ttc };
}

describe("export", () => {
  it("database as CSV and JSON, with computed formulas and a view's order", async () => {
    const { d } = await invoices(boris);
    const csv = await boris.get(`/api/databases/${d.id}/export`);
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-disposition"]).toContain("Factures.csv");
    expect(csv.body.startsWith("﻿")).toBe(true);
    expect(parseCsv(csv.body)).toEqual([
      ["Nom", "Étiquettes", "Montant", "Payée", "Échéance", "TTC"],
      ["EDF, octobre", "", "100", "Oui", "2026-10-15", "120"],
      ['Free "box"', "", "29.99", "Non", "", "35.988"],
    ]);
    const semi = (await boris.get(`/api/databases/${d.id}/export?sep=semicolon`)).body;
    expect(semi.split("\r\n")[0]).toBe("﻿Nom;Étiquettes;Montant;Payée;Échéance;TTC");
    expect(semi.split("\r\n")[2]).toBe('"Free ""box""";;29,99;Non;;35,988');

    const json = (await boris.get(`/api/databases/${d.id}/export?format=json`)).json();
    expect(json.rows[0].values).toEqual({
      Nom: "EDF, octobre",
      Étiquettes: [],
      Montant: 100,
      Payée: true,
      Échéance: { start: "2026-10-15", end: null },
      TTC: 120,
    });

    // A view's filters, sorts and hidden columns apply.
    const view = d.views[0];
    const props = (await boris.get(`/api/databases/${d.id}`)).json().database.properties;
    const byName = (n: string) => props.find((p: { name: string }) => p.name === n).id;
    await boris.patch(`/api/databases/${d.id}/views/${view.id}`, {
      config: {
        columns: [{ propertyId: byName("Étiquettes"), hidden: true }],
        filters: [{ propertyId: byName("Montant"), operator: "lt", value: 50 }],
      },
    });
    expect(parseCsv((await boris.get(`/api/databases/${d.id}/export?viewId=${view.id}`)).body)).toEqual([
      ["Nom", "Montant", "Payée", "Échéance", "TTC"],
      ['Free "box"', "29.99", "Non", "", "35.988"],
    ]);
    expect((await alice.get(`/api/databases/${d.id}/export`)).statusCode).toBe(404);
  });

  it("page as Markdown: subpages, database, files and relative links, without private pages", async () => {
    const ws = await boris.personalWorkspace();
    const root = await boris.createPage(ws, "Maison / 2026");
    const child = await boris.createPage(ws, "Travaux", root);
    const { d } = await invoices(boris, root);
    // A file attached to the root page.
    const fileId = "11111111-2222-3333-4444-555555555555";
    fs.mkdirSync(path.join(app.config.dataDir, "uploads"), { recursive: true });
    fs.writeFileSync(path.join(app.config.dataDir, "uploads", fileId), "%PDF-contenu");
    app.db.insert(attachments).values({ id: fileId, pageId: root, filename: "devis toit.pdf", mimeType: "application/pdf", size: 12 }).run();
    setContent(root, [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Budget" }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Voir " },
          { type: "text", text: "le devis", marks: [{ type: "bold" }, { type: "link", attrs: { href: "https://exemple.fr" } }] },
          { type: "text", text: " et " },
          { type: "pageLink", attrs: { pageId: child, title: "Travaux" } },
        ],
      },
      {
        type: "taskList",
        content: [{ type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "Toit" }] }] }],
      },
      { type: "fileAttachment", attrs: { url: `/api/attachments/${fileId}`, name: "devis toit.pdf", size: 12 } },
      { type: "databaseBlock", attrs: { pageId: d.id } },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: ["Poste", "Prix"].map((t) => ({ type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] })),
          },
          {
            type: "tableRow",
            content: ["Toit", "8 000 €"].map((t) => ({ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] })),
          },
        ],
      },
      { type: "plugin_embed__embed", attrs: { data: JSON.stringify({ url: "https://youtu.be/dQw4w9WgXcQ", title: "Vidéo" }) } },
      {
        type: "details",
        content: [
          { type: "detailsSummary", content: [{ type: "text", text: "Détails" }] },
          { type: "detailsContent", content: [{ type: "paragraph", content: [{ type: "text", text: "Caché" }] }] },
        ],
      },
      {
        type: "columns",
        content: ["Gauche", "Droite"].map((t) => ({ type: "column", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] })),
      },
    ]);
    setContent(child, [{ type: "codeBlock", attrs: { language: "js" }, content: [{ type: "text", text: "const a = 1;" }] }]);

    const res = await boris.get(`/api/pages/${root}/export`);
    expect(res.statusCode, res.body).toBe(200);
    const files = await unzip(res.rawPayload);
    expect(Object.keys(files).sort()).toEqual([
      "Maison 2026.md",
      "Maison 2026/Factures.csv",
      "Maison 2026/Factures.json",
      "Maison 2026/Factures/EDF, octobre.md",
      "Maison 2026/Factures/Free box.md",
      "Maison 2026/Travaux.md",
      `fichiers/11111111-devis toit.pdf`,
    ]);
    const md = files["Maison 2026.md"]!;
    expect(md).toMatch(/^---\ntitle: "Maison \/ 2026"\n/);
    expect(md).toContain("## Budget");
    expect(md).toContain("Voir [**le devis**](https://exemple.fr) et [Travaux](<Maison 2026/Travaux.md>)");
    expect(md).toContain("- [x] Toit");
    expect(md).toContain("[📎 devis toit.pdf](<fichiers/11111111-devis toit.pdf>)");
    expect(md).toContain("[🗃 Base de données](<Maison 2026/Factures.csv>)");
    expect(md).toContain("| Poste | Prix |\n| --- | --- |\n| Toit | 8 000 € |");
    expect(md).toContain("[Vidéo](https://youtu.be/dQw4w9WgXcQ)");
    expect(md).toContain("<details>\n<summary>Détails</summary>\n\nCaché\n\n</details>");
    expect(md).toContain("Gauche\n\nDroite");
    expect(files["Maison 2026/Travaux.md"]).toContain("```js\nconst a = 1;\n```");
    // Rows keep their properties in the front matter.
    expect(files["Maison 2026/Factures/EDF, octobre.md"]).toContain('Montant: "100"\nPayée: "Oui"');
    expect(files["fichiers/11111111-devis toit.pdf"]).toBe("%PDF-contenu");

    // Alice only gets what is shared with her: one subpage.
    expect((await alice.get(`/api/pages/${root}/export`)).statusCode).toBe(404);
    await boris.put(`/api/pages/${child}/shares`, { userId: await alice.id(), role: "viewer" });
    const shared = await unzip((await alice.get(`/api/pages/${child}/export`)).rawPayload);
    expect(Object.keys(shared)).toEqual(["Travaux.md"]);

    // The whole personal workspace.
    const all = await unzip((await boris.get(`/api/workspaces/${ws}/export`)).rawPayload);
    expect(Object.keys(all)).toContain("Maison 2026/Travaux.md");
    expect((await alice.get(`/api/workspaces/${ws}/export`)).statusCode).toBe(404);
  });

  it("full backup is for the admin only", async () => {
    await invoices(boris);
    expect((await alice.get("/api/admin/backup")).statusCode).toBe(403);
    const res = await boris.get("/api/admin/backup");
    expect(res.statusCode).toBe(200);
    const files = await unzip(res.rawPayload);
    expect(Object.keys(files)).toContain("nootion.db");
    expect(files["nootion.db"]!.startsWith("SQLite format 3")).toBe(true);
    // The temporary copy is gone.
    await new Promise((r) => setTimeout(r, 50));
    expect(fs.readdirSync(app.config.dataDir).filter((f) => f.startsWith(".backup-"))).toEqual([]);
  });
});

describe("CSV import", () => {
  it("adds the rows, creates missing columns and options", async () => {
    const { d, amount } = await invoices(boris);
    const csv =
      '﻿Nom;Montant;Payée;Échéance;Étiquettes;Fournisseur;TTC\n"Eau; avril";1 234,50 €;oui;15/04/2026;Maison, Eau;Veolia;999\nGaz;;non;2026-05-01 → 2026-05-31;Maison;;\n';
    const res = await boris.post(`/api/databases/${d.id}/import`, { csv });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ imported: 2, createdColumns: ["Fournisseur"], ignoredColumns: ["TTC"] });
    const data = (await boris.get(`/api/databases/${d.id}`)).json().database;
    const eau = data.rows.find((r: { title: string }) => r.title === "Eau; avril");
    const props = Object.fromEntries(data.properties.map((p: { name: string; id: string }) => [p.name, p]));
    expect(eau.values[amount.id]).toBe(1234.5);
    expect(eau.values[props["Payée"].id]).toBe(true);
    expect(eau.values[props["Échéance"].id]).toEqual({ start: "2026-04-15", end: null });
    expect(eau.values[props["Fournisseur"].id]).toBe("Veolia");
    expect(props["Étiquettes"].config.options.map((o: { name: string }) => o.name)).toEqual(["Maison", "Eau"]);
    expect(eau.values[props["TTC"].id]).toEqual({ kind: "number", value: 1481.4 });
    const gaz = data.rows.find((r: { title: string }) => r.title === "Gaz");
    expect(gaz.values[props["Échéance"].id]).toEqual({ start: "2026-05-01", end: "2026-05-31" });

    // New columns are typed after their values.
    const d2 = (await boris.post("/api/databases", { workspaceId: await boris.personalWorkspace(), parentId: null, title: "Vide" })).json().database;
    await boris.post(`/api/databases/${d2.id}/import`, { csv: "Nom;Prix;Payé;Le;Note\nA;12,50 €;oui;01/02/2026;x\nB;3 €;non;;y\n" });
    const d2data = (await boris.get(`/api/databases/${d2.id}`)).json().database;
    expect(d2data.properties.map((p: { name: string; type: string }) => [p.name, p.type])).toEqual([
      ["Nom", "title"],
      ["Étiquettes", "multi_select"],
      ["Prix", "currency"],
      ["Payé", "checkbox"],
      ["Le", "date"],
      ["Note", "text"],
    ]);
    const a = d2data.rows.find((r: { title: string }) => r.title === "A");
    expect(Object.values(a.values)).toEqual(expect.arrayContaining([12.5, true, { start: "2026-02-01", end: null }, "x"]));

    // A file exported by Nootion goes back in.
    const exported = (await boris.get(`/api/databases/${d.id}/export`)).body;
    const again = await boris.post(`/api/databases/${d.id}/import`, { csv: exported });
    expect(again.json().imported).toBe(4);
    expect((await alice.post(`/api/databases/${d.id}/import`, { csv })).statusCode).toBe(404);
    expect((await boris.post(`/api/databases/${d.id}/import`, { csv: "Nom\n" })).statusCode).toBe(400);
  });
});
