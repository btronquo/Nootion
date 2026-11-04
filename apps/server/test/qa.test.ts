import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let boris: Client;
let team: string;
let page: string;

beforeEach(async () => {
  app = await makeApp();
  boris = await setupAdmin(app);
  team = (await boris.post("/api/workspaces", { name: "Studio" })).json().workspace.id;
  page = (await boris.post("/api/pages", { workspaceId: team, parentId: null, title: "QA MSFS" })).json().page.id;
  expect((await boris.patch("/api/admin/plugins/qa", { enabled: true })).statusCode).toBe(200);
});

afterEach(async () => {
  await app.close();
});

const Q = "/api/plugins/qa";

interface SetSummary {
  id: string;
  databases: { cases: string; products: string; runs: string; results: string };
  suites: { id: string; name: string }[];
  priorities: { id: string; name: string }[];
  cases: { id: string; title: string; suite: string | null }[];
  products: { id: string; title: string }[];
}

/** Creates the four databases, then fills them: two suites, three cases, three products. */
async function makeSet() {
  const res = await boris.post(`${Q}/sets`, { pageId: page });
  expect(res.statusCode).toBe(200);
  const set = res.json().set as SetSummary;
  const { cases, products } = set.databases;
  const props = (await boris.get(`/api/databases/${cases}`)).json().database.properties as { id: string; name: string; type: string; config: any }[];
  const suite = props.find((p) => p.name === "Suite")!;
  await boris.patch(`/api/databases/${cases}/properties/${suite.id}`, {
    config: { options: [{ id: "menus", name: "Menus", color: "blue" }, { id: "vol", name: "Vol", color: "green" }] },
  });
  const add = async (db: string, title: string, values: Record<string, unknown> = {}) =>
    (await boris.post(`/api/databases/${db}/rows`, { title, values, templateId: null })).json().row.id as string;
  const c1 = await add(cases, "Démarrer une partie", { Suite: "Menus", Priorité: "Haute" });
  const c2 = await add(cases, "Décoller de LFPG", { Suite: "Vol", Priorité: "Critique" });
  const c3 = await add(cases, "Changer la langue", { Suite: "Menus", Priorité: "Basse" });
  const pc = await add(products, "PC");
  const xbox = await add(products, "Xbox");
  const ps = await add(products, "PS5");
  return { set, cases: { c1, c2, c3 }, products: { pc, xbox, ps } };
}

describe("qa plugin", () => {
  it("creates linked test databases under the page", async () => {
    const { set } = await makeSet();
    const tree = (await boris.get(`/api/databases/${set.databases.results}`)).json().database;
    const names = tree.properties.map((p: { name: string }) => p.name);
    expect(names).toEqual(expect.arrayContaining(["Run", "Cas", "Produit", "Statut", "Testeur", "Testé le", "Commentaire", "Bug"]));
    expect(names).not.toContain("Étiquettes");
    // Each case lists its results (two-way relation).
    const caseProps = (await boris.get(`/api/databases/${set.databases.cases}`)).json().database.properties.map((p: { name: string }) => p.name);
    expect(caseProps).toEqual(expect.arrayContaining(["Suite", "Priorité", "Préconditions", "Résultat attendu", "Résultats"]));
    for (const id of Object.values(set.databases)) {
      expect((await boris.get(`/api/pages/${id}`)).json().page.parentId).toBe(page);
    }
    expect((await boris.get(`${Q}/sets`)).json().sets).toEqual([{ id: set.id, title: "Cas de test", pageId: page }]);
  });

  it("runs cases on several products and records results", async () => {
    const { set, cases, products } = await makeSet();
    const created = await boris.post(`${Q}/sets/${set.id}/runs`, {
      title: "Recette 1.4",
      version: "1.4.0",
      suites: [],
      priorities: [],
      products: [products.pc, products.xbox],
    });
    expect(created.statusCode).toBe(200);
    const run = created.json().run;
    expect(run.run).toMatchObject({ title: "Recette 1.4", version: "1.4.0", status: "open" });
    expect(run.products.map((p: { title: string }) => p.title)).toEqual(["PC", "Xbox"]);
    // Cases come by suite, in the suite's order.
    expect(run.cases.map((c: { title: string }) => c.title)).toEqual(["Démarrer une partie", "Changer la langue", "Décoller de LFPG"]);
    expect(run.results).toHaveLength(6);
    expect(run.results.every((r: { status: string }) => r.status === "untested")).toBe(true);

    const target = run.results.find((r: { case: string; product: string }) => r.case === cases.c2 && r.product === products.xbox);
    const res = await boris.patch(`${Q}/sets/${set.id}/results/${target.id}`, { status: "failed", comment: "Crash au roulage", bug: "https://jira.example.com/MSFS-12" });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toMatchObject({ status: "failed", tester: "Boris", comment: "Crash au roulage", bug: "https://jira.example.com/MSFS-12" });
    expect(res.json().result.testedAt).toBeTruthy();

    // It is an ordinary row of the results database.
    const rows = (await boris.get(`/api/databases/${set.databases.results}`)).json().database.rows as { id: string; title: string }[];
    expect(rows.find((r) => r.id === target.id)!.title).toBe("Décoller de LFPG · Xbox");

    // Back to untested: who and when are cleared.
    const back = (await boris.patch(`${Q}/sets/${set.id}/results/${target.id}`, { status: "untested" })).json().result;
    expect(back).toMatchObject({ status: "untested", tester: null, testedAt: null, comment: "Crash au roulage" });
    expect((await boris.patch(`${Q}/sets/${set.id}/results/${target.id}`, { status: "nope" })).statusCode).toBe(400);

    // Finishing, then opening again.
    const done = (await boris.patch(`${Q}/sets/${set.id}/runs/${run.run.id}`, { status: "done" })).json().run.run;
    expect(done.status).toBe("done");
    expect(done.finished).toBeTruthy();
    expect((await boris.patch(`${Q}/sets/${set.id}/runs/${run.run.id}`, { status: "open" })).json().run.run).toMatchObject({ status: "open", finished: null });
  });

  it("limits a run to some suites, and adds cases created later", async () => {
    const { set, products } = await makeSet();
    const run = (await boris.post(`${Q}/sets/${set.id}/runs`, { title: "Menus", suites: ["menus"], products: [products.ps] })).json().run;
    expect(run.cases.map((c: { title: string }) => c.title)).toEqual(["Démarrer une partie", "Changer la langue"]);
    expect(run.results).toHaveLength(2);

    // Without products: one result per case.
    const plain = (await boris.post(`${Q}/sets/${set.id}/runs`, { title: "Smoke", priorities: ["critical"] })).json().run;
    expect(plain.products).toEqual([]);
    expect(plain.results).toEqual([expect.objectContaining({ product: null, status: "untested" })]);

    await boris.post(`/api/databases/${set.databases.cases}/rows`, { title: "Quitter le jeu", values: { Suite: "Menus" }, templateId: null });
    await boris.post(`/api/databases/${set.databases.cases}/rows`, { title: "Atterrir", values: { Suite: "Vol" }, templateId: null });
    const synced = (await boris.post(`${Q}/sets/${set.id}/runs/${run.run.id}/sync`, { suites: ["menus"] })).json();
    expect(synced.added).toBe(1);
    expect(synced.run.cases.map((c: { title: string }) => c.title)).toContain("Quitter le jeu");
    expect(synced.run.cases.map((c: { title: string }) => c.title)).not.toContain("Atterrir");
    expect((await boris.post(`${Q}/sets/${set.id}/runs/${run.run.id}/sync`, { suites: ["menus"] })).json().added).toBe(0);

    // A run needs at least one case.
    const none = await boris.post(`${Q}/sets/${set.id}/runs`, { title: "Vide", priorities: ["medium"] });
    expect(none.statusCode).toBe(400);
  });

  it("only shows sets and runs to people who can open the databases", async () => {
    const { set, products } = await makeSet();
    const run = (await boris.post(`${Q}/sets/${set.id}/runs`, { title: "R", products: [products.pc] })).json().run;
    const alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
    expect((await alice.get(`${Q}/sets`)).json().sets).toEqual([]);
    expect((await alice.get(`${Q}/sets/${set.id}`)).statusCode).toBe(404);
    expect((await alice.get(`${Q}/sets/${set.id}/runs/${run.run.id}`)).statusCode).toBe(404);
    expect((await alice.patch(`${Q}/sets/${set.id}/results/${run.results[0].id}`, { status: "passed" })).statusCode).toBe(404);
    expect((await alice.post(`${Q}/sets`, { pageId: page })).statusCode).toBe(403);

    // Shared for reading: Alice sees the run but can't record results.
    const aliceId = (await alice.get("/api/auth/me")).json().user.id;
    expect((await boris.put(`/api/pages/${page}/shares`, { userId: aliceId, role: "viewer" })).statusCode).toBe(200);
    const seen = await alice.get(`${Q}/sets/${set.id}/runs/${run.run.id}`);
    expect(seen.statusCode).toBe(200);
    expect(seen.json().run.canEdit).toBe(false);
    expect([403, 404]).toContain((await alice.patch(`${Q}/sets/${set.id}/results/${run.results[0].id}`, { status: "passed" })).statusCode);
    expect((await boris.get(`${Q}/sets/${set.id}/runs/${run.run.id}`)).json().run.results[0].status).toBe("untested");
  });

  it("needs to be signed in", async () => {
    const anon = new Client(app);
    expect((await anon.get(`${Q}/sets`)).statusCode).toBe(401);
  });

  it("links results to Azure DevOps tickets by their number", async () => {
    const seen: { url: string; auth: string | undefined }[] = [];
    const fake = http.createServer((req, res) => {
      seen.push({ url: req.url!, auth: req.headers.authorization });
      const ids = new URL(req.url!, "http://x").searchParams.get("ids")!.split(",").map(Number);
      const known: Record<number, { title: string; state: string }> = { 1203: { title: "Crash au roulage", state: "Active" } };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ count: ids.length, value: ids.map((id) => (known[id] ? { id, fields: { "System.Title": known[id].title, "System.State": known[id].state, "System.WorkItemType": "Bug" } } : null)) }));
    });
    await new Promise<void>((ok) => fake.listen(0, "127.0.0.1", ok));
    const ado = `http://127.0.0.1:${(fake.address() as AddressInfo).port}/studio`;
    try {
      const { set, products } = await makeSet();
      const run = (await boris.post(`${Q}/sets/${set.id}/runs`, { title: "R", products: [products.pc] })).json().run;
      expect(run.ado).toEqual({ enabled: false, details: false });
      const id = run.results[0].id;

      await boris.patch("/api/admin/plugins/qa", { enabled: true, values: { adoUrl: `${ado}/`, adoProject: "MSFS 2024", adoToken: "pat-secret" } });
      expect((await boris.get(`${Q}/sets/${set.id}/runs/${run.run.id}`)).json().run.ado).toEqual({ enabled: true, details: true });
      for (const ticket of ["#1203", "1203", 1203, `${ado}/MSFS%202024/_workitems/edit/1203`]) {
        const res = (await boris.patch(`${Q}/sets/${set.id}/results/${id}`, { status: "failed", ticket })).json().result;
        expect(res).toMatchObject({ ticket: 1203, ticketUrl: `${ado}/MSFS%202024/_workitems/edit/1203` });
      }
      expect((await boris.patch(`${Q}/sets/${set.id}/results/${id}`, { ticket: "abc" })).statusCode).toBe(400);
      // A number column of the results database, like any other.
      const props = (await boris.get(`/api/databases/${set.databases.results}`)).json().database.properties as { name: string; type: string }[];
      expect(props.find((p) => p.name === "Ticket")?.type).toBe("number");

      const tickets = (await boris.get(`${Q}/tickets?ids=1203,99`)).json().tickets;
      expect(tickets).toEqual({ 1203: { title: "Crash au roulage", state: "Active", type: "Bug" }, 99: null });
      expect(seen[0]!.url).toContain("/studio/MSFS%202024/_apis/wit/workitems?ids=1203,99");
      expect(seen[0]!.auth).toBe(`Basic ${Buffer.from(":pat-secret").toString("base64")}`);
      // Kept a few minutes.
      await boris.get(`${Q}/tickets?ids=1203`);
      expect(seen).toHaveLength(1);

      expect((await boris.patch(`${Q}/sets/${set.id}/results/${id}`, { ticket: null })).json().result).toMatchObject({ ticket: null, ticketUrl: null });
    } finally {
      fake.close();
    }
  });
});
