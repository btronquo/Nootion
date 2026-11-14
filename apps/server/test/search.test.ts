import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { pages } from "../src/db/schema.js";
import { ftsQuery } from "../src/routes/search.js";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let boris: Client;
let alice: Client;

beforeEach(async () => {
  app = await makeApp();
  boris = await setupAdmin(app);
  alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
});

const search = async (c: Client, q: string) => (await c.get(`/api/search?q=${encodeURIComponent(q)}`)).json().results;
const setText = (id: string, text: string) => app.db.update(pages).set({ contentText: text }).where(eq(pages.id, id)).run();

describe("search", () => {
  it("searches titles and content, ignoring accents and unfinished words", async () => {
    const ws = await boris.personalWorkspace();
    const maison = await boris.createPage(ws, "Maison");
    const travaux = await boris.createPage(ws, "Travaux de la toiture", maison);
    setText(travaux, "Devis de l'entreprise Dupont pour la réfection complète.");
    setText(maison, ""); // Without the link to its subpage.
    const autre = await boris.createPage(ws, "Recettes");
    setText(autre, "Gâteau au chocolat");

    expect((await search(boris, "toiture")).map((r: { id: string }) => r.id)).toEqual([travaux]);
    const [hit] = await search(boris, "refection dup");
    expect(hit).toMatchObject({ id: travaux, title: "Travaux de la toiture", path: ["Maison"], kind: "page" });
    expect(hit.snippet).toContain("\u0001réfection\u0002");
    expect(await search(boris, "gateau")).toHaveLength(1);
    // A title match ranks before a content match.
    setText(maison, "Toiture à refaire");
    expect((await search(boris, "toiture")).map((r: { id: string }) => r.id)).toEqual([travaux, maison]);
    // Renaming and trashing are followed.
    await boris.patch(`/api/pages/${autre}`, { title: "Desserts" });
    expect(await search(boris, "dessert")).toHaveLength(1);
    await boris.delete(`/api/pages/${autre}`);
    expect(await search(boris, "dessert")).toHaveLength(0);
    expect(await search(boris, "  ")).toEqual([]);
    expect(await search(boris, '"*) OR (')).toEqual([]);
  });

  it("only shows pages the user can read", async () => {
    const ws = await boris.personalWorkspace();
    const root = await boris.createPage(ws, "Secret budget");
    const child = await boris.createPage(ws, "Budget vacances", root);
    expect(await search(alice, "budget")).toEqual([]);
    await boris.put(`/api/pages/${child}/shares`, { userId: await alice.id(), role: "viewer" });
    const results = await search(alice, "budget");
    // The parent stays hidden, also in the path.
    expect(results).toEqual([expect.objectContaining({ id: child, path: [] })]);
    expect((await new Client(app).get("/api/search?q=budget")).statusCode).toBe(401);
  });

  it("turns the input into a safe query", () => {
    expect(ftsQuery("Café  au lait")).toBe('"Café" "au" "lait"*');
    expect(ftsQuery('a" OR b')).toBe('"a" "OR" "b"*');
    expect(ftsQuery("--")).toBeNull();
  });
});

describe("search in database values", () => {
  type Hit = { id: string; title: string; kind: string; path: string[]; snippet: string; match?: string };
  const find = async (c: Client, params: Record<string, string>) =>
    (await c.get(`/api/search?${new URLSearchParams(params)}`)).json().results as Hit[];

  async function invoices(c: Client = boris) {
    const ws = await c.personalWorkspace();
    const d = (await c.post("/api/databases", { workspaceId: ws, parentId: null, title: "Invoices" })).json().database;
    const prop = async (name: string, type: string, config = {}) => (await c.post(`/api/databases/${d.id}/properties`, { name, type, config })).json().property;
    const customer = await prop("Customer", "text");
    const status = await prop("Status", "select", { options: [{ id: "paid", name: "Paid", color: "green" }] });
    const owner = await prop("Owner", "person");
    const total = await prop("Total", "formula", { expression: 'prop("Customer") + " Zorglub"' });
    const row = async (title: string, values: Record<string, unknown>) =>
      (await c.post(`/api/databases/${d.id}/rows`, { values: { [d.properties[0].id]: title, ...values } })).json().row.id as string;
    return { ws, d, customer, status, owner, total, row };
  }

  it("finds a row by the value of a cell, and follows changes to cells and options", async () => {
    const { d, customer, status, owner, row } = await invoices();
    const inv12 = await row("INV-12", { [customer.id]: "Dupont et fils", [status.id]: "paid", [owner.id]: [await alice.id()] });
    await row("INV-13", { [customer.id]: "Martin" });

    const [hit, ...rest] = await search(boris, "dupont");
    expect(rest).toEqual([]);
    expect(hit).toMatchObject({ id: inv12, title: "INV-12", kind: "row", path: ["Invoices"], match: "cells" });
    expect(hit.snippet).toContain("Customer: \u0001Dupont\u0002 et fils");
    // Options and people by their names; words from the title and from the cells together.
    expect((await search(boris, "paid")).map((r: Hit) => r.id)).toEqual([inv12]);
    expect((await search(boris, "alice")).map((r: Hit) => r.id)).toEqual([inv12]);
    expect((await search(boris, "inv dupont")).map((r: Hit) => r.id)).toEqual([inv12]);
    // Computed values are left out.
    expect(await search(boris, "zorglub")).toEqual([]);

    // A cell changed, an option renamed: found under the new words.
    await boris.patch(`/api/databases/${d.id}/rows/${inv12}`, { values: { [customer.id]: "Durand" } });
    expect(await search(boris, "dupont")).toEqual([]);
    expect((await search(boris, "durand")).map((r: Hit) => r.id)).toEqual([inv12]);
    await boris.patch(`/api/databases/${d.id}/properties/${status.id}`, { config: { options: [{ id: "paid", name: "Settled", color: "green" }] } });
    expect(await search(boris, "paid")).toEqual([]);
    expect((await search(boris, "settled")).map((r: Hit) => r.id)).toEqual([inv12]);
    // A renamed column too.
    await boris.patch(`/api/databases/${d.id}/properties/${customer.id}`, { name: "Client" });
    expect((await search(boris, "client durand"))[0].snippet).toContain("\u0001Client\u0002: \u0001Durand\u0002");
  });

  it("keeps the permissions of the database", async () => {
    const { row, customer } = await invoices();
    await row("INV-1", { [customer.id]: "Dupont" });
    expect(await search(alice, "dupont")).toEqual([]);
  });

  it("narrows the results with filters, also without words", async () => {
    const { ws, d, customer, row } = await invoices();
    const inv = await row("INV-1", { [customer.id]: "Dupont" });
    const page = await boris.createPage(ws, "Dupont meeting");
    const shared = (await boris.post("/api/workspaces", { name: "Team" })).json().workspace.id as string;
    const other = await boris.createPage(shared, "Dupont visit");
    const alicePage = await alice.createPage(await alice.personalWorkspace(), "Dupont for Alice");

    const ids = async (params: Record<string, string>) => (await find(boris, { q: "dupont", ...params })).map((r) => r.id).sort();
    expect(await ids({})).toEqual([inv, page, other].sort());
    expect(await ids({ kind: "row" })).toEqual([inv]);
    expect(await ids({ kind: "page" })).toEqual([page, other].sort());
    expect(await ids({ kind: "file" })).toEqual([]);
    expect(await ids({ databaseId: d.id })).toEqual([inv]);
    expect(await ids({ workspaceId: shared })).toEqual([other]);
    expect(await ids({ authorId: await alice.id() })).toEqual([]);
    expect((await find(alice, { q: "dupont", authorId: await alice.id() })).map((r) => r.id)).toEqual([alicePage]);
    // Edited since: a number of days or a date.
    app.db.update(pages).set({ updatedAt: new Date("2020-01-01") }).where(eq(pages.id, page)).run();
    expect(await ids({ editedSince: "7d" })).toEqual([inv, other].sort());
    expect(await ids({ editedSince: "2019-12-31" })).toEqual([inv, page, other].sort());
    // Without words: the most recently changed first.
    expect((await find(boris, { databaseId: d.id })).map((r) => r.id)).toEqual([inv]);
    expect((await find(boris, { workspaceId: shared })).map((r) => r.id)).toEqual([other]);
    // Wrong values are refused.
    expect((await boris.get("/api/search?q=a&kind=nope")).statusCode).toBe(400);
    expect((await boris.get("/api/search?q=a&editedSince=yesterday")).statusCode).toBe(400);
  });

  it("lists the databases the user can read", async () => {
    const { d } = await invoices();
    expect((await boris.get("/api/search/databases")).json().databases).toEqual([expect.objectContaining({ id: d.id, title: "Invoices" })]);
    expect((await alice.get("/api/search/databases")).json().databases).toEqual([]);
  });

  it("indexes rows written without the API (imports, sync) and existing rows", async () => {
    const { d, customer, row } = await invoices();
    const id = await row("INV-9", {});
    app.db.update(pages).set({ props: { [customer.id]: "Lefebvre" } }).where(eq(pages.id, id)).run();
    expect((await search(boris, "lefebvre")).map((r: Hit) => r.id)).toEqual([id]);
    expect(d.id).toBeTruthy();
  });
});

describe("saved searches", () => {
  it("saves, lists, renames and deletes a user's searches", async () => {
    const ws = await boris.personalWorkspace();
    const created = await boris.post("/api/search/saved", { name: "Unpaid invoices", query: "unpaid", filters: { kind: "row", workspaceId: ws, editedSince: "30d" } });
    expect(created.statusCode, created.body).toBe(201);
    const saved = created.json();
    expect(saved).toMatchObject({ name: "Unpaid invoices", query: "unpaid", filters: { kind: "row", workspaceId: ws, editedSince: "30d" } });
    // The same name replaces it.
    const again = (await boris.post("/api/search/saved", { name: "unpaid invoices", query: "late", filters: {} })).json();
    expect(again.id).toBe(saved.id);
    await boris.post("/api/search/saved", { name: "A first one", query: "x" });
    expect((await boris.get("/api/search/saved")).json().searches.map((s: { name: string }) => s.name)).toEqual(["A first one", "unpaid invoices"]);
    // Each user has their own.
    expect((await alice.get("/api/search/saved")).json().searches).toEqual([]);
    expect((await alice.delete(`/api/search/saved/${saved.id}`)).statusCode).toBe(404);
    expect((await alice.patch(`/api/search/saved/${saved.id}`, { name: "Mine" })).statusCode).toBe(404);

    expect((await boris.patch(`/api/search/saved/${saved.id}`, { name: "Late" })).json()).toMatchObject({ name: "Late", query: "late" });
    expect((await boris.post("/api/search/saved", { name: " ", query: "x" })).statusCode).toBe(400);
    expect((await boris.post("/api/search/saved", { name: "Bad", filters: { kind: "nope" } })).statusCode).toBe(400);
    expect((await boris.delete(`/api/search/saved/${saved.id}`)).statusCode).toBe(204);
    expect((await boris.get("/api/search/saved")).json().searches).toHaveLength(1);
  });
});
