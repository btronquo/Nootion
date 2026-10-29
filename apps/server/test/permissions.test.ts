import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let boris: Client;
let alice: Client;
let eve: Client;
let anon: Client;

beforeEach(async () => {
  app = await makeApp();
  boris = await setupAdmin(app);
  alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
  eve = await inviteUser(app, boris, { name: "Eve", email: "eve@example.com", password: "eve-password" });
  anon = new Client(app);
});

/** Every way to read or change a page; all must answer 404 to someone without access. */
async function expectNoAccess(c: Client, pageId: string, workspaceId: string) {
  const attempts = [
    c.get(`/api/pages/${pageId}`),
    c.patch(`/api/pages/${pageId}`, { title: "piraté" }),
    c.post(`/api/pages/${pageId}/move`, { parentId: null }),
    c.delete(`/api/pages/${pageId}`),
    c.post(`/api/pages/${pageId}/restore`),
    c.delete(`/api/pages/${pageId}/permanent`),
    c.get(`/api/pages/${pageId}/shares`),
    c.put(`/api/pages/${pageId}/shares`, { userId: await c.id().catch(() => "x"), role: "full" }),
    c.get(`/api/pages/${pageId}/public-link`),
    c.put(`/api/pages/${pageId}/public-link`, { includeSubpages: true }),
    c.post("/api/pages", { workspaceId, parentId: pageId, title: "intrus" }),
    c.post("/api/pages", { workspaceId, parentId: null, title: "intrus" }),
    c.get(`/api/workspaces/${workspaceId}/pages`),
    c.get(`/api/workspaces/${workspaceId}/members`),
  ];
  for (const res of await Promise.all(attempts)) {
    expect([401, 404], `${res.raw.req.method} ${res.raw.req.url} -> ${res.statusCode}`).toContain(res.statusCode);
  }
}

describe("pages privées par défaut", () => {
  it("un autre utilisateur ne voit rien, même avec l'URL", async () => {
    const ws = await boris.personalWorkspace();
    const root = await boris.createPage(ws, "Factures");
    const child = await boris.createPage(ws, "2026", root);

    for (const c of [alice, anon]) {
      await expectNoAccess(c, root, ws);
      await expectNoAccess(c, child, ws);
    }
    expect((await alice.get("/api/pages/shared")).json().pages).toEqual([]);
    // Nothing was changed by the attempts.
    expect((await boris.get(`/api/pages/${root}`)).json().page.title).toBe("Factures");
    expect((await boris.get(`/api/workspaces/${ws}/pages`)).json().pages).toHaveLength(2);
  });

  it("le propriétaire a l'accès complet à son espace personnel", async () => {
    const ws = await boris.personalWorkspace();
    const root = await boris.createPage(ws, "Notes");
    const page = (await boris.get(`/api/pages/${root}`)).json().page;
    expect(page.role).toBe("full");
  });
});

describe("partage d'une page à un utilisateur", () => {
  it("donne accès à la page et à ses sous-pages, pas au reste", async () => {
    const ws = await boris.personalWorkspace();
    const factures = await boris.createPage(ws, "Factures");
    const y2026 = await boris.createPage(ws, "2026", factures);
    const secret = await boris.createPage(ws, "Journal intime");
    const aliceId = await alice.id();

    expect((await boris.put(`/api/pages/${factures}/shares`, { userId: aliceId, role: "viewer" })).statusCode).toBe(200);

    expect((await alice.get(`/api/pages/${factures}`)).json().page.role).toBe("viewer");
    const sub = (await alice.get(`/api/pages/${y2026}`)).json().page;
    expect(sub.role).toBe("viewer");
    // The breadcrumb stops at the shared page.
    expect(sub.breadcrumb.map((b: { id: string }) => b.id)).toEqual([factures]);

    const shared = (await alice.get("/api/pages/shared")).json().pages;
    expect(shared.map((p: { id: string }) => p.id).sort()).toEqual([factures, y2026].sort());

    await expectNoAccess(alice, secret, ws);
    await expectNoAccess(eve, factures, ws);
    await expectNoAccess(eve, y2026, ws);
  });

  it("un lecteur ne peut ni modifier ni repartager", async () => {
    const ws = await boris.personalWorkspace();
    const page = await boris.createPage(ws, "Factures");
    await boris.put(`/api/pages/${page}/shares`, { userId: await alice.id(), role: "viewer" });

    expect((await alice.patch(`/api/pages/${page}`, { title: "x" })).statusCode).toBe(404);
    expect((await alice.put(`/api/pages/${page}/shares`, { userId: await eve.id(), role: "viewer" })).statusCode).toBe(404);
    expect((await alice.post("/api/pages", { workspaceId: ws, parentId: page, title: "x" })).statusCode).toBe(404);
    expect((await alice.delete(`/api/pages/${page}`)).statusCode).toBe(404);
  });

  it("un éditeur modifie et crée des sous-pages, mais ne partage pas", async () => {
    const ws = await boris.personalWorkspace();
    const page = await boris.createPage(ws, "Factures");
    await boris.put(`/api/pages/${page}/shares`, { userId: await alice.id(), role: "editor" });

    expect((await alice.patch(`/api/pages/${page}`, { title: "Factures 2026" })).statusCode).toBe(200);
    const sub = await alice.createPage(ws, "Janvier", page);
    expect((await boris.get(`/api/pages/${sub}`)).statusCode).toBe(200);
    expect((await alice.put(`/api/pages/${page}/shares`, { userId: await eve.id(), role: "viewer" })).statusCode).toBe(404);
    // Cannot create pages at the root of someone else's workspace.
    expect((await alice.post("/api/pages", { workspaceId: ws, parentId: null, title: "x" })).statusCode).toBe(404);
  });

  it("retirer le partage coupe l'accès", async () => {
    const ws = await boris.personalWorkspace();
    const page = await boris.createPage(ws, "Factures");
    const aliceId = await alice.id();
    await boris.put(`/api/pages/${page}/shares`, { userId: aliceId, role: "editor" });
    expect((await alice.get(`/api/pages/${page}`)).statusCode).toBe(200);
    await boris.delete(`/api/pages/${page}/shares/${aliceId}`);
    await expectNoAccess(alice, page, ws);
  });

  it("liste les partages, y compris hérités", async () => {
    const ws = await boris.personalWorkspace();
    const page = await boris.createPage(ws, "Factures");
    const sub = await boris.createPage(ws, "2026", page);
    await boris.put(`/api/pages/${page}/shares`, { userId: await alice.id(), role: "viewer" });
    const shares = (await boris.get(`/api/pages/${sub}/shares`)).json().shares;
    expect(shares).toHaveLength(1);
    expect(shares[0]).toMatchObject({ email: "alice@example.com", role: "viewer", inheritedFrom: { id: page } });
  });
});

describe("espaces partagés", () => {
  it("les membres voient les pages selon leur rôle, les autres rien", async () => {
    const ws = (await boris.post("/api/workspaces", { name: "Maison" })).json().workspace.id;
    const page = await boris.createPage(ws, "Courses");
    await expectNoAccess(alice, page, ws);

    await boris.put(`/api/workspaces/${ws}/members`, { userId: await alice.id(), role: "viewer" });
    expect((await alice.get(`/api/workspaces/${ws}/pages`)).json().pages).toHaveLength(1);
    expect((await alice.get(`/api/pages/${page}`)).json().page.role).toBe("viewer");
    expect((await alice.patch(`/api/pages/${page}`, { title: "x" })).statusCode).toBe(404);
    expect((await alice.post("/api/pages", { workspaceId: ws, parentId: null, title: "x" })).statusCode).toBe(404);

    await boris.put(`/api/workspaces/${ws}/members`, { userId: await alice.id(), role: "editor" });
    expect((await alice.get(`/api/pages/${page}`)).json().page.role).toBe("full");
    expect((await alice.post("/api/pages", { workspaceId: ws, parentId: null, title: "Menus" })).statusCode).toBe(200);
    // An editor does not manage members.
    expect((await alice.put(`/api/workspaces/${ws}/members`, { userId: await eve.id(), role: "viewer" })).statusCode).toBe(404);

    await expectNoAccess(eve, page, ws);
  });

  it("un membre retiré perd l'accès ; le dernier propriétaire ne peut pas partir", async () => {
    const ws = (await boris.post("/api/workspaces", { name: "Asso" })).json().workspace.id;
    const page = await boris.createPage(ws, "PV");
    const aliceId = await alice.id();
    await boris.put(`/api/workspaces/${ws}/members`, { userId: aliceId, role: "editor" });
    await boris.delete(`/api/workspaces/${ws}/members/${aliceId}`);
    await expectNoAccess(alice, page, ws);

    expect((await boris.delete(`/api/workspaces/${ws}/members/${await boris.id()}`)).statusCode).toBe(409);
  });

  it("l'espace personnel ne peut pas recevoir de membres", async () => {
    const ws = await boris.personalWorkspace();
    expect((await boris.put(`/api/workspaces/${ws}/members`, { userId: await alice.id(), role: "viewer" })).statusCode).toBe(400);
  });
});

describe("corbeille", () => {
  it("une page à la corbeille disparaît pour tous, puis se restaure", async () => {
    const ws = await boris.personalWorkspace();
    const page = await boris.createPage(ws, "Factures");
    const sub = await boris.createPage(ws, "2026", page);
    await boris.put(`/api/pages/${page}/shares`, { userId: await alice.id(), role: "viewer" });

    await boris.delete(`/api/pages/${page}`);
    expect((await boris.get(`/api/pages/${sub}`)).statusCode).toBe(404);
    expect((await alice.get(`/api/pages/${page}`)).statusCode).toBe(404);
    expect((await alice.get("/api/pages/shared")).json().pages).toEqual([]);
    expect((await boris.get(`/api/workspaces/${ws}/pages`)).json().pages).toEqual([]);
    expect((await boris.get(`/api/workspaces/${ws}/trash`)).json().pages.map((p: { id: string }) => p.id)).toEqual([page]);
    expect((await alice.get(`/api/workspaces/${ws}/trash`)).json().pages).toEqual([]);

    await boris.post(`/api/pages/${page}/restore`);
    expect((await boris.get(`/api/pages/${sub}`)).statusCode).toBe(200);
  });

  it("la suppression définitive efface la page et ses sous-pages", async () => {
    const ws = await boris.personalWorkspace();
    const page = await boris.createPage(ws, "Brouillon");
    const sub = await boris.createPage(ws, "Sous-page", page);
    expect((await boris.delete(`/api/pages/${page}/permanent`)).statusCode).toBe(400);
    await boris.delete(`/api/pages/${page}`);
    expect((await boris.delete(`/api/pages/${page}/permanent`)).statusCode).toBe(200);
    expect((await boris.post(`/api/pages/${sub}/restore`)).statusCode).toBe(404);
  });
});

describe("déplacement", () => {
  it("réordonne et refuse les cycles", async () => {
    const ws = await boris.personalWorkspace();
    const a = await boris.createPage(ws, "A");
    const b = await boris.createPage(ws, "B");
    const c = await boris.createPage(ws, "C", a);

    await boris.post(`/api/pages/${b}/move`, { parentId: null, index: 0 });
    let list = (await boris.get(`/api/workspaces/${ws}/pages`)).json().pages.filter((p: { parentId: string | null }) => !p.parentId);
    expect(list.map((p: { title: string }) => p.title)).toEqual(["B", "A"]);

    expect((await boris.post(`/api/pages/${a}/move`, { parentId: c })).statusCode).toBe(400);
    expect((await boris.post(`/api/pages/${a}/move`, { parentId: a })).statusCode).toBe(400);

    await boris.post(`/api/pages/${b}/move`, { parentId: a });
    list = (await boris.get(`/api/workspaces/${ws}/pages`)).json().pages;
    expect(list.find((p: { id: string }) => p.id === b).parentId).toBe(a);
  });

  it("ne déplace pas une page vers l'espace d'un autre", async () => {
    const ws = await boris.personalWorkspace();
    const page = await boris.createPage(ws, "A");
    const alicePage = await alice.createPage(await alice.personalWorkspace(), "Chez Alice");
    expect((await boris.post(`/api/pages/${page}/move`, { parentId: alicePage })).statusCode).toBe(404);
  });
});

describe("lien public", () => {
  it("donne un accès en lecture seule, sans compte, et se révoque", async () => {
    const ws = await boris.personalWorkspace();
    const page = await boris.createPage(ws, "Recette");
    const sub = await boris.createPage(ws, "Variante", page);
    const other = await boris.createPage(ws, "Privé");

    const link = (await boris.put(`/api/pages/${page}/public-link`, { includeSubpages: true })).json().link;
    expect(link.url).toContain("/p/");

    const pub = (await anon.get(`/api/public/${link.token}`)).json();
    expect(pub.root.id).toBe(page);
    expect(pub.pages.map((p: { id: string }) => p.id)).toEqual([sub]);
    expect((await anon.get(`/api/public/${link.token}/pages/${sub}`)).statusCode).toBe(200);
    expect((await anon.get(`/api/public/${link.token}/pages/${other}`)).statusCode).toBe(404);
    // A public link grants nothing on the private API.
    expect((await anon.get(`/api/pages/${page}`)).statusCode).toBe(401);
    expect((await alice.get(`/api/pages/${page}`)).statusCode).toBe(404);

    await boris.put(`/api/pages/${page}/public-link`, { includeSubpages: false });
    expect((await anon.get(`/api/public/${link.token}/pages/${sub}`)).statusCode).toBe(404);

    await boris.delete(`/api/pages/${page}/public-link`);
    expect((await anon.get(`/api/public/${link.token}`)).statusCode).toBe(404);
  });

  it("un lien vers une page à la corbeille ne marche plus", async () => {
    const ws = await boris.personalWorkspace();
    const page = await boris.createPage(ws, "Recette");
    const link = (await boris.put(`/api/pages/${page}/public-link`, {})).json().link;
    await boris.delete(`/api/pages/${page}`);
    expect((await anon.get(`/api/public/${link.token}`)).statusCode).toBe(404);
  });

  it("un jeton inventé ne donne rien", async () => {
    expect((await anon.get("/api/public/nimportequoi")).statusCode).toBe(404);
  });
});

describe("options de page", () => {
  it("pleine largeur enregistrée", async () => {
    const app = await makeApp();
    const boris = await setupAdmin(app);
    const page = await boris.createPage(await boris.personalWorkspace(), "Large");
    expect((await boris.get(`/api/pages/${page}`)).json().page.fullWidth).toBe(false);
    expect((await boris.patch(`/api/pages/${page}`, { fullWidth: true })).statusCode).toBe(200);
    expect((await boris.get(`/api/pages/${page}`)).json().page.fullWidth).toBe(true);
  });
});
