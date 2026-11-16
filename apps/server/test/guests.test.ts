import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let boris: Client;
let alice: Client;
let mails: { to: string; subject: string; text: string }[];

beforeEach(async () => {
  mails = [];
  app = await makeApp(undefined, {}, { mailSender: async (m) => void mails.push(m) });
  boris = await setupAdmin(app);
  alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
});

/** A shared space with a page, a subpage, and another page the guest must never see. */
async function team() {
  const ws = (await boris.post("/api/workspaces", { name: "Équipe" })).json().workspace.id as string;
  await boris.put(`/api/workspaces/${ws}/members`, { userId: await alice.id(), role: "editor" });
  const page = await boris.createPage(ws, "Projet client");
  const sub = await boris.createPage(ws, "Compte rendu", page);
  const secret = await boris.createPage(ws, "Budget interne");
  return { ws, page, sub, secret };
}

/** Invites a guest on the page and accepts the invitation; returns the guest's client and the invitation link. */
async function inviteGuest(pageId: string, role = "editor", by: Client = boris) {
  const res = await by.post(`/api/pages/${pageId}/guests`, { email: "gina@dehors.fr", role });
  expect(res.statusCode, res.body).toBe(200);
  const { url } = res.json();
  const token = url.split("/invite/")[1];
  const gina = new Client(app);
  const accepted = await gina.post(`/api/invitations/${token}/accept`, { name: "Gina", email: "gina@dehors.fr", password: "gina-password", locale: "fr" });
  expect(accepted.statusCode, accepted.body).toBe(200);
  expect(accepted.json().user.role).toBe("guest");
  return { gina, token, url };
}

describe("inviting a guest from a page", () => {
  it("sends a link by e-mail, lists it as pending, and shares the page once the account is made", async () => {
    const { page } = await team();
    const smtp = { host: "smtp.example.com", port: 587, security: "starttls", user: "nootion", password: "s3cret" };
    expect((await boris.put("/api/admin/mail", { provider: "smtp", from: "Nootion <nootion@example.com>", smtp })).statusCode).toBe(200);
    const res = await boris.post(`/api/pages/${page}/guests`, { email: "Gina@Dehors.fr", role: "commenter" });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ shared: false, invitation: { email: "gina@dehors.fr", role: "commenter" } });
    expect(body.emailed).toBe(true);
    await app.mailer.idle();
    expect(mails[0]).toMatchObject({ to: "gina@dehors.fr", subject: "Boris partage « Projet client » avec vous" });
    expect(mails[0]!.text).toContain(body.url);

    const sharing = (await boris.get(`/api/pages/${page}/shares`)).json();
    expect(sharing.pendingGuests).toEqual([expect.objectContaining({ email: "gina@dehors.fr", role: "commenter" })]);
    expect(sharing.guestsAllowed).toBe(true);

    const token = body.url.split("/invite/")[1];
    const info = (await new Client(app).get(`/api/invitations/${token}`)).json();
    expect(info).toMatchObject({ email: "gina@dehors.fr", guest: true, pageTitle: "Projet client" });

    const gina = new Client(app);
    const accepted = await gina.post(`/api/invitations/${token}/accept`, { name: "Gina", email: "gina@dehors.fr", password: "gina-password" });
    expect(accepted.statusCode, accepted.body).toBe(200);

    const after = (await boris.get(`/api/pages/${page}/shares`)).json();
    expect(after.pendingGuests).toEqual([]);
    expect(after.shares).toEqual([expect.objectContaining({ name: "Gina", role: "commenter", guest: true, inheritedFrom: null })]);
  });

  it("shares at once with someone who already has an account", async () => {
    const { page } = await team();
    const res = await boris.post(`/api/pages/${page}/guests`, { email: "alice@example.com", role: "viewer" });
    expect(res.json()).toEqual({ shared: true });
    const shares = (await boris.get(`/api/pages/${page}/shares`)).json().shares;
    expect(shares).toEqual([expect.objectContaining({ name: "Alice", role: "viewer", guest: false })]);
  });

  it("only lets those who manage the page invite, and never with full access", async () => {
    const { page, ws } = await team();
    // Alice only reads in the space: managing the page's sharing needs full access.
    await boris.put(`/api/workspaces/${ws}/members`, { userId: await alice.id(), role: "viewer" });
    expect((await alice.post(`/api/pages/${page}/guests`, { email: "x@dehors.fr" })).statusCode).toBe(404);
    expect((await boris.post(`/api/pages/${page}/guests`, { email: "x@dehors.fr", role: "full" })).statusCode).toBe(400);
  });

  it("can be cancelled before it is used", async () => {
    const { page } = await team();
    const { invitation, url } = (await boris.post(`/api/pages/${page}/guests`, { email: "gina@dehors.fr" })).json();
    expect((await boris.delete(`/api/pages/${page}/guests/${invitation.id}`)).statusCode).toBe(200);
    const token = url.split("/invite/")[1];
    expect((await new Client(app).get(`/api/invitations/${token}`)).statusCode).toBe(404);
  });

  it("stops working when the page is put in the trash", async () => {
    const { page } = await team();
    const { url } = (await boris.post(`/api/pages/${page}/guests`, { email: "gina@dehors.fr" })).json();
    await boris.delete(`/api/pages/${page}`);
    const token = url.split("/invite/")[1];
    const res = await new Client(app).post(`/api/invitations/${token}/accept`, { name: "Gina", email: "gina@dehors.fr", password: "gina-password" });
    expect(res.statusCode).toBe(404);
  });
});

describe("what a guest sees", () => {
  it("only the pages shared with them, with their subpages, and no space at all", async () => {
    const { page, sub, secret, ws } = await team();
    const { gina } = await inviteGuest(page, "editor");

    expect((await gina.get("/api/workspaces")).json().workspaces).toEqual([]);
    const shared = (await gina.get("/api/pages/shared")).json().pages.map((p: { title: string }) => p.title);
    expect(shared).toEqual(["Projet client", "Compte rendu"]);
    expect((await gina.get(`/api/pages/${page}`)).json().page.role).toBe("editor");
    expect((await gina.get(`/api/pages/${sub}`)).statusCode).toBe(200);
    expect((await gina.get(`/api/pages/${secret}`)).statusCode).toBe(404);
    expect((await gina.get(`/api/workspaces/${ws}/pages`)).statusCode).toBe(404);
    expect((await gina.get(`/api/workspaces/${ws}/members`)).statusCode).toBe(404);

    // They work in the page they were given: edit it, add a subpage.
    expect((await gina.patch(`/api/pages/${page}`, { title: "Projet client (v2)" })).statusCode).toBe(200);
    const child = await gina.post("/api/pages", { workspaceId: ws, parentId: page, title: "Mes notes" });
    expect(child.statusCode, child.body).toBe(200);

    const titles = (await gina.get("/api/search?q=Budget")).json();
    expect(JSON.stringify(titles)).not.toContain("Budget interne");
  });

  it("sees in the directory only the people of the pages shared with them", async () => {
    const { page } = await team();
    const { gina } = await inviteGuest(page);
    // Alice is in the space but the page isn't shared with her by name: Gina doesn't see her.
    const names = (await gina.get("/api/users")).json().users.map((u: { name: string }) => u.name);
    expect(names.sort()).toEqual(["Boris", "Gina"]);
    await boris.put(`/api/pages/${page}/shares`, { userId: await alice.id(), role: "viewer" });
    const again = (await gina.get("/api/users")).json().users.map((u: { name: string }) => u.name);
    expect(again.sort()).toEqual(["Alice", "Boris", "Gina"]);
  });

  it("is refused everything only members may do", async () => {
    const { page, ws } = await team();
    const { gina } = await inviteGuest(page, "editor");
    const ginaId = await gina.id();
    // Even given full access by mistake, a guest can't manage a page.
    expect((await boris.put(`/api/pages/${page}/shares`, { userId: ginaId, role: "full" })).statusCode).toBe(400);

    const refused = [
      gina.post("/api/workspaces", { name: "À moi" }),
      gina.get("/api/home"),
      gina.get("/api/inbox"),
      gina.post("/api/inbox", { text: "note" }),
      gina.post("/api/demo"),
      gina.get("/api/tokens"),
      gina.post("/api/tokens", { name: "script" }),
      gina.get("/api/users/lookup?email=alice@example.com"),
      gina.put(`/api/pages/${page}/shares`, { userId: await alice.id(), role: "viewer" }),
      gina.delete(`/api/pages/${page}/shares/${ginaId}`),
      gina.put(`/api/pages/${page}/public-link`, { includeSubpages: true }),
      gina.post(`/api/pages/${page}/guests`, { email: "ami@dehors.fr" }),
      gina.post("/api/oauth/authorize", {}),
      gina.post("/api/import/files", {}),
    ];
    for (const res of await Promise.all(refused)) {
      expect(res.statusCode, `${res.raw.req.method} ${res.raw.req.url}`).toBe(403);
      expect(res.json().error).toBe("guest_forbidden");
    }
    expect((await gina.post("/api/pages", { workspaceId: ws, parentId: null, title: "À la racine" })).statusCode).toBe(404);
    // Nobody can put a guest in a space.
    const added = await boris.put(`/api/workspaces/${ws}/members`, { userId: ginaId, role: "viewer" });
    expect(added.statusCode).toBe(400);
    expect(added.json().error).toBe("guest_not_member");
  });
});

describe("administrators and guests", () => {
  it("list guests apart, with their pages, and turn one into a member with a space of their own", async () => {
    const { page } = await team();
    const { gina } = await inviteGuest(page, "viewer");
    const guests = (await boris.get("/api/admin/guests")).json().guests;
    expect(guests).toEqual([expect.objectContaining({ name: "Gina", role: "guest", pages: [{ id: page, title: "Projet client", role: "viewer" }] })]);

    const ginaId = await gina.id();
    const res = await boris.patch(`/api/admin/users/${ginaId}`, { role: "member" });
    expect(res.json().user.role).toBe("member");
    expect((await boris.get("/api/admin/guests")).json().guests).toEqual([]);
    const spaces = (await gina.get("/api/workspaces")).json().workspaces;
    expect(spaces).toEqual([expect.objectContaining({ kind: "personal", role: "owner" })]);
    expect((await gina.get("/api/home")).statusCode).toBe(200);
    expect((await gina.get(`/api/pages/${page}`)).statusCode).toBe(200);
  });

  it("can't make someone a guest from the user list, nor invite one without a page", async () => {
    expect((await boris.patch(`/api/admin/users/${await alice.id()}`, { role: "guest" })).statusCode).toBe(400);
    expect((await boris.post("/api/admin/invitations", { role: "guest" })).statusCode).toBe(400);
  });

  it("can forbid guests: no new invitations, pending ones stop working, guests are signed out", async () => {
    const { page } = await team();
    const { gina } = await inviteGuest(page);
    const pending = (await boris.post(`/api/pages/${page}/guests`, { email: "hugo@dehors.fr" })).json();

    const settings = (await boris.get("/api/admin/settings")).json().settings;
    expect(settings.allowGuests).toBe(true);
    await boris.put("/api/admin/settings", { ...settings, allowGuests: false });

    expect((await gina.get("/api/auth/me")).statusCode).toBe(401);
    const login = await new Client(app).post("/api/auth/login", { email: "gina@dehors.fr", password: "gina-password" });
    expect(login.statusCode).toBe(403);
    expect(login.json().error).toBe("guests_off");
    const invite = await boris.post(`/api/pages/${page}/guests`, { email: "ines@dehors.fr" });
    expect(invite.json().error).toBe("guests_off");
    expect((await boris.get(`/api/pages/${page}/shares`)).json().guestsAllowed).toBe(false);
    const token = pending.url.split("/invite/")[1];
    expect((await new Client(app).get(`/api/invitations/${token}`)).statusCode).toBe(404);

    // Another setting saved alone leaves this one as it is.
    await boris.put("/api/admin/settings", { webhookPrivateNetworks: true });
    expect((await boris.get("/api/admin/settings")).json().settings).toEqual({ webhookPrivateNetworks: true, allowGuests: false });

    // Turned on again, the guest's session works as before.
    await boris.put("/api/admin/settings", { allowGuests: true });
    expect((await gina.get("/api/auth/me")).json().user.role).toBe("guest");
  });
});
