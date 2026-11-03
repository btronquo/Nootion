import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
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

const link = (pageId: string) => ({ type: "paragraph", content: [{ type: "pageLink", attrs: { pageId, title: "" } }] });

describe("all pages and the graph", () => {
  it("lists what each person can read, with the links between pages", async () => {
    const ws = await boris.personalWorkspace();
    const projets = await boris.createPage(ws, "Projets");
    const cuisine = await boris.createPage(ws, "Cuisine", projets);
    const devis = await boris.createPage(ws, "Devis");
    const secret = await boris.createPage(ws, "Journal");
    app.db
      .update(pages)
      .set({
        contentJson: {
          type: "doc",
          content: [
            link(devis),
            { type: "paragraph", content: [{ type: "text", text: "voir", marks: [{ type: "link", attrs: { href: `http://x/page/${secret}` } }] }] },
          ],
        },
      })
      .where(eq(pages.id, cuisine))
      .run();
    await boris.delete(`/api/pages/${devis}`);

    const all = (await boris.get("/api/pages/all")).json().pages;
    expect(all.map((p: { title: string }) => p.title).sort()).toEqual(["Cuisine", "Journal", "Projets"]);
    expect(all.find((p: { id: string }) => p.id === cuisine)).toMatchObject({ path: ["Projets"], createdByName: "Boris", workspaceName: null });

    const graph = (await boris.get("/api/pages/graph")).json();
    expect(graph.nodes).toHaveLength(3);
    expect(graph.links).toEqual(
      expect.arrayContaining([
        { source: projets, target: cuisine, kind: "child" },
        { source: cuisine, target: secret, kind: "link" },
      ]),
    );
    // The page in the trash isn't there, nor links to it.
    expect(graph.links).toHaveLength(2);

    // Alice only sees what is shared with her.
    await boris.put(`/api/pages/${projets}/shares`, { userId: await alice.id(), role: "viewer" });
    const hers = (await alice.get("/api/pages/graph")).json();
    expect(hers.nodes.map((n: { title: string }) => n.title).sort()).toEqual(["Cuisine", "Projets"]);
    expect(hers.links).toEqual([{ source: projets, target: cuisine, kind: "child" }]);
  });
});
