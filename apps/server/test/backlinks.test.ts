import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { pages } from "../src/db/schema.js";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let boris: Client;

beforeEach(async () => {
  app = await makeApp();
  boris = await setupAdmin(app);
});

const setContent = (pageId: string, content: unknown[]) =>
  app.db
    .update(pages)
    .set({ contentJson: { type: "doc", content } })
    .where(eq(pages.id, pageId))
    .run();
const text = (t: string) => ({ type: "text", text: t });
const backlinks = async (c: Client, id: string) => (await c.get(`/api/pages/${id}/backlinks`)).json().pages as { id: string; title: string; excerpt: string }[];

describe("backlinks", () => {
  it("lists the pages that link to or mention a page, with the text around", async () => {
    const ws = await boris.personalWorkspace();
    const target = await boris.createPage(ws, "Voiture");
    const mention = await boris.createPage(ws, "Budget");
    const link = await boris.createPage(ws, "Garage");
    const textLink = await boris.createPage(ws, "Notes");
    const embed = await boris.createPage(ws, "Tableau");
    const unrelated = await boris.createPage(ws, "Autre");

    setContent(mention, [
      { type: "heading", attrs: { level: 1 }, content: [text("Dépenses")] },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [text("Assurance de la "), { type: "pageLink", attrs: { pageId: target, title: "Voiture" } }, text(" : 600 €")] },
            ],
          },
        ],
      },
    ]);
    setContent(link, [{ type: "pageLink", attrs: { pageId: target, title: "Voiture" } }]);
    setContent(textLink, [
      { type: "paragraph", content: [{ type: "text", text: "voir la fiche", marks: [{ type: "link", attrs: { href: `/page/${target}` } }] }] },
    ]);
    // An id that appears without a link (a database embed, plain text) doesn't count.
    setContent(embed, [{ type: "databaseBlock", attrs: { pageId: target } }]);
    setContent(unrelated, [{ type: "paragraph", content: [text(`id ${target}`)] }]);

    const list = await backlinks(boris, target);
    expect(list.map((p) => p.title).sort()).toEqual(["Budget", "Garage", "Notes"]);
    expect(list.find((p) => p.title === "Budget")!.excerpt).toBe("Assurance de la Voiture : 600 €");
    expect(list.find((p) => p.title === "Notes")!.excerpt).toBe("voir la fiche");

    // Trashed pages drop out.
    await boris.delete(`/api/pages/${link}`);
    expect((await backlinks(boris, target)).map((p) => p.title).sort()).toEqual(["Budget", "Notes"]);
  });

  it("only shows pages the reader can open", async () => {
    const ws = await boris.personalWorkspace();
    const target = await boris.createPage(ws, "Projet");
    const secret = await boris.createPage(ws, "Journal");
    setContent(secret, [{ type: "paragraph", content: [{ type: "pageLink", attrs: { pageId: target, title: "Projet" } }] }]);
    const alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "motdepasse-alice" });
    await boris.put(`/api/pages/${target}/shares`, { userId: await alice.id(), role: "viewer" });
    expect(await backlinks(alice, target)).toEqual([]);
    expect((await backlinks(boris, target)).map((p) => p.title)).toEqual(["Journal"]);
    expect((await alice.get(`/api/pages/${secret}/backlinks`)).statusCode).toBe(404);
  });
});
