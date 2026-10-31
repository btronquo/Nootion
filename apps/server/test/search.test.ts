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
