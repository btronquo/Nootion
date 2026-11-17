import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { ServerResponse } from "node:http";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";
import { startFakeOidc, type FakeOidc } from "./oidc-fake.js";

let app: FastifyInstance;
let boris: Client;
let alice: Client;
let eve: Client;
let aliceId: string;
let eveId: string;
let sent: { payload: string }[];

beforeEach(async () => {
  sent = [];
  app = await makeApp(undefined, {}, { pushSender: async (_sub, payload) => void sent.push({ payload }) });
  boris = await setupAdmin(app);
  alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password", locale: "en" });
  eve = await inviteUser(app, boris, { name: "Eve", email: "eve@example.com", password: "eve-password" });
  aliceId = await alice.id();
  eveId = await eve.id();
});
afterEach(() => app.close());

async function makeGroup(name: string, members: string[] = []) {
  const res = await boris.post("/api/admin/groups", { name });
  expect(res.statusCode, res.body).toBe(200);
  const id = res.json().group.id as string;
  for (const userId of members) expect((await boris.put(`/api/admin/groups/${id}/members`, { userId })).statusCode).toBe(200);
  return id;
}

async function space(name = "Marketing") {
  return (await boris.post("/api/workspaces", { name })).json().workspace.id as string;
}

describe("administrators make groups", () => {
  it("creates, renames, fills, empties and deletes a group", async () => {
    const id = await makeGroup("Marketing", [aliceId]);
    // Two groups can't share a name, whatever the case.
    expect((await boris.post("/api/admin/groups", { name: "marketing" })).statusCode).toBe(409);
    expect((await boris.patch(`/api/admin/groups/${id}`, { name: "Communication", description: "Les gens de la com" })).statusCode).toBe(200);
    await boris.put(`/api/admin/groups/${id}/members`, { userId: eveId });

    let groups = (await boris.get("/api/admin/groups")).json().groups;
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ name: "Communication", description: "Les gens de la com", memberCount: 2, scim: false });
    expect(groups[0].members.map((m: { name: string }) => m.name)).toEqual(["Alice", "Eve"]);

    await boris.delete(`/api/admin/groups/${id}/members/${eveId}`);
    groups = (await boris.get("/api/admin/groups")).json().groups;
    expect(groups[0].memberCount).toBe(1);

    expect((await boris.delete(`/api/admin/groups/${id}`)).statusCode).toBe(200);
    expect((await boris.get("/api/admin/groups")).json().groups).toEqual([]);
    expect((await boris.put(`/api/admin/groups/${id}/members`, { userId: eveId })).statusCode).toBe(404);
  });

  it("is for administrators only; members list the groups to share with them", async () => {
    await makeGroup("Marketing", [aliceId]);
    expect((await alice.get("/api/admin/groups")).statusCode).toBe(403);
    expect((await alice.post("/api/admin/groups", { name: "Pirates" })).statusCode).toBe(403);
    const list = (await alice.get("/api/groups")).json().groups;
    expect(list).toEqual([expect.objectContaining({ name: "Marketing", memberCount: 1, mine: true })]);
    expect((await eve.get("/api/groups")).json().groups[0].mine).toBe(false);
  });

  it("never puts a guest in a group, and guests can't see groups", async () => {
    const ws = await space();
    const page = await boris.createPage(ws, "Projet");
    const res = await boris.post(`/api/pages/${page}/guests`, { email: "gina@dehors.fr", role: "viewer" });
    const token = res.json().url.split("/invite/")[1];
    const gina = new Client(app);
    await gina.post(`/api/invitations/${token}/accept`, { name: "Gina", email: "gina@dehors.fr", password: "gina-password", locale: "fr" });
    const group = await makeGroup("Marketing");
    expect((await boris.put(`/api/admin/groups/${group}/members`, { userId: await gina.id() })).statusCode).toBe(400);
    expect((await gina.get("/api/groups")).statusCode).toBe(403);
    expect((await gina.put(`/api/pages/${page}/group-shares`, { groupId: group, role: "viewer" })).statusCode).toBe(403);
    // A guest doesn't see which groups the page is shared with.
    await boris.put(`/api/pages/${page}/group-shares`, { groupId: group, role: "viewer" });
    expect((await gina.get(`/api/pages/${page}/shares`)).json().groupShares).toEqual([]);
  });
});

describe("a space opened to a group", () => {
  it("gives everyone in the group the role, and takes it back when they leave the group", async () => {
    const ws = await space();
    const page = await boris.createPage(ws, "Plan média");
    const group = await makeGroup("Marketing", [aliceId]);

    expect((await alice.get(`/api/pages/${page}`)).statusCode).toBe(404);
    expect((await boris.put(`/api/workspaces/${ws}/groups`, { groupId: group, role: "editor" })).statusCode).toBe(200);

    expect((await alice.get("/api/workspaces")).json().workspaces).toContainEqual({ id: ws, name: "Marketing", kind: "shared", role: "editor" });
    expect((await alice.get(`/api/pages/${page}`)).json().page.role).toBe("full");
    expect((await alice.patch(`/api/pages/${page}`, { title: "Plan média 2027" })).statusCode).toBe(200);
    expect((await alice.get(`/api/workspaces/${ws}/pages`)).statusCode).toBe(200);
    expect((await eve.get(`/api/pages/${page}`)).statusCode).toBe(404);

    // The space's members list shows the group.
    const members = (await alice.get(`/api/workspaces/${ws}/members`)).json();
    expect(members.groups).toEqual([{ groupId: group, name: "Marketing", memberCount: 1, role: "editor" }]);

    // Someone added to the group later gets in at once.
    await boris.put(`/api/admin/groups/${group}/members`, { userId: eveId });
    expect((await eve.get(`/api/pages/${page}`)).statusCode).toBe(200);
    // And loses it when taken out.
    await boris.delete(`/api/admin/groups/${group}/members/${eveId}`);
    expect((await eve.get(`/api/pages/${page}`)).statusCode).toBe(404);
    expect((await eve.get("/api/workspaces")).json().workspaces.map((w: { id: string }) => w.id)).not.toContain(ws);
  });

  it("takes the best of the person's own role and their groups'", async () => {
    const ws = await space();
    const page = await boris.createPage(ws, "Budget");
    const group = await makeGroup("Marketing", [aliceId]);
    await boris.put(`/api/workspaces/${ws}/members`, { userId: aliceId, role: "viewer" });
    await boris.put(`/api/workspaces/${ws}/groups`, { groupId: group, role: "commenter" });
    expect((await alice.get(`/api/pages/${page}`)).json().page.role).toBe("commenter");
    await boris.put(`/api/workspaces/${ws}/groups`, { groupId: group, role: "editor" });
    expect((await alice.get(`/api/pages/${page}`)).json().page.role).toBe("full");
    await boris.delete(`/api/workspaces/${ws}/groups/${group}`);
    expect((await alice.get(`/api/pages/${page}`)).json().page.role).toBe("viewer");
  });

  it("is managed by the space's owners, never as owner, never on a personal space", async () => {
    const ws = await space();
    const group = await makeGroup("Marketing", [aliceId]);
    expect((await boris.put(`/api/workspaces/${ws}/groups`, { groupId: group, role: "owner" })).statusCode).toBe(400);
    await boris.put(`/api/workspaces/${ws}/groups`, { groupId: group, role: "editor" });
    // An editor through the group can't manage the space.
    expect((await alice.put(`/api/workspaces/${ws}/groups`, { groupId: group, role: "viewer" })).statusCode).toBe(404);
    expect((await alice.put(`/api/workspaces/${ws}/members`, { userId: eveId, role: "viewer" })).statusCode).toBe(404);
    expect((await boris.put(`/api/workspaces/${await boris.personalWorkspace()}/groups`, { groupId: group, role: "viewer" })).statusCode).toBe(400);
    expect((await boris.put(`/api/workspaces/${ws}/groups`, { groupId: "nope", role: "viewer" })).statusCode).toBe(404);
    // Someone in through a group leaves by leaving the group.
    expect((await alice.delete(`/api/workspaces/${ws}/members/${aliceId}`)).statusCode).toBe(409);
  });

  it("deleting the group closes what it opened", async () => {
    const ws = await space();
    const page = await boris.createPage(ws, "Plan");
    const group = await makeGroup("Marketing", [aliceId]);
    await boris.put(`/api/workspaces/${ws}/groups`, { groupId: group, role: "viewer" });
    expect((await alice.get(`/api/pages/${page}`)).statusCode).toBe(200);
    await boris.delete(`/api/admin/groups/${group}`);
    expect((await alice.get(`/api/pages/${page}`)).statusCode).toBe(404);
  });

  it("puts people of the same group and space in each other's directory", async () => {
    const group = await makeGroup("Marketing", [aliceId, eveId]);
    const names = async (c: Client) => (await c.get("/api/users")).json().users.map((u: { name: string }) => u.name);
    expect(await names(alice)).toEqual(["Alice", "Eve"]);
    await boris.delete(`/api/admin/groups/${group}/members/${eveId}`);
    expect(await names(alice)).toEqual(["Alice"]);
    const ws = await space();
    await boris.put(`/api/workspaces/${ws}/groups`, { groupId: group, role: "viewer" });
    expect(await names(alice)).toEqual(["Alice", "Boris"]);
  });

  it("tells the group's members at once that their spaces changed", async () => {
    const got: unknown[] = [];
    app.liveEvents.connect(aliceId, { write: (c: string) => void got.push(JSON.parse(c.replace(/^data: /, ""))), end() {} } as unknown as ServerResponse);
    const ws = await space();
    const group = await makeGroup("Marketing", [aliceId]);
    app.liveEvents.flush();
    got.length = 0;
    await boris.put(`/api/workspaces/${ws}/groups`, { groupId: group, role: "viewer" });
    app.liveEvents.flush();
    expect(got).toContainEqual({ type: "access" });
    got.length = 0;
    await boris.createPage(ws, "Nouvelle page");
    app.liveEvents.flush();
    expect(got).toContainEqual({ type: "pages", workspaceId: ws });
  });
});

describe("a page shared with a group", () => {
  it("is open to the group's members with its subpages, and listed in their shared pages", async () => {
    const ws = await boris.personalWorkspace();
    const page = await boris.createPage(ws, "Compte rendu");
    const sub = await boris.createPage(ws, "Annexe", page);
    const other = await boris.createPage(ws, "Privé");
    const group = await makeGroup("Marketing", [aliceId]);

    expect((await boris.put(`/api/pages/${page}/group-shares`, { groupId: group, role: "commenter" })).statusCode).toBe(200);
    expect((await alice.get(`/api/pages/${sub}`)).json().page.role).toBe("commenter");
    expect((await alice.get(`/api/pages/${other}`)).statusCode).toBe(404);
    expect((await alice.get("/api/pages/shared")).json().pages.map((p: { id: string }) => p.id)).toContain(page);
    // Commenter: no editing.
    expect((await alice.patch(`/api/pages/${page}`, { title: "x" })).statusCode).toBe(404);

    const shares = (await boris.get(`/api/pages/${sub}/shares`)).json();
    expect(shares.groupShares).toEqual([
      { groupId: group, name: "Marketing", memberCount: 1, role: "commenter", inheritedFrom: { id: page, title: "Compte rendu" } },
    ]);

    // Full access through the group lets them manage the page's sharing.
    await boris.put(`/api/pages/${page}/group-shares`, { groupId: group, role: "full" });
    expect((await alice.put(`/api/pages/${page}/shares`, { userId: eveId, role: "viewer" })).statusCode).toBe(200);

    await boris.delete(`/api/pages/${page}/group-shares/${group}`);
    expect((await alice.get(`/api/pages/${page}`)).statusCode).toBe(404);
    expect((await boris.get(`/api/pages/${page}/shares`)).json().groupShares).toEqual([]);
  });

  it("needs full access to share with a group", async () => {
    const ws = await boris.personalWorkspace();
    const page = await boris.createPage(ws, "Compte rendu");
    const group = await makeGroup("Marketing", [aliceId]);
    await boris.put(`/api/pages/${page}/shares`, { userId: eveId, role: "editor" });
    expect((await eve.put(`/api/pages/${page}/group-shares`, { groupId: group, role: "viewer" })).statusCode).toBe(404);
    expect((await boris.put(`/api/pages/${page}/group-shares`, { groupId: "nope", role: "viewer" })).statusCode).toBe(404);
  });

  it("shows its to-dos to the group, and @group tells its members who can read the page", async () => {
    const ws = await boris.personalWorkspace();
    const page = await boris.createPage(ws, "Réunion");
    const group = await makeGroup("Marketing", [aliceId, eveId]);
    await alice.post("/api/reminders/push-subscriptions", { endpoint: "https://push.example.com/alice", keys: { p256dh: "k", auth: "a" } });
    await boris.put(`/api/pages/${page}/shares`, { userId: aliceId, role: "viewer" });
    const mention = { type: "userMention", attrs: { id: "m1", groupId: group, name: "Marketing" } };
    const content = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Pour " }, mention] },
        {
          type: "taskList",
          content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "Relire " }, mention] }] }],
        },
      ],
    };
    expect((await boris.put(`/api/pages/${page}/content`, { content })).statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    // Alice can read the page: told. Eve can't: not told.
    expect((await alice.get("/api/comments/notifications")).json().notifications).toHaveLength(1);
    expect((await eve.get("/api/comments/notifications")).json().notifications).toEqual([]);
    expect(JSON.parse(sent[0]!.payload)).toMatchObject({ title: "Boris mentioned Marketing in Réunion" });
    // The to-do mentions Alice through her group.
    const tasks = (await alice.get("/api/tasks?mine=1")).json().tasks;
    expect(tasks).toEqual([expect.objectContaining({ text: "Relire @Marketing", mentionsMe: true })]);

    // Saved again: nobody is told twice; Eve, now able to read, isn't told of an old mention.
    await boris.put(`/api/pages/${page}/group-shares`, { groupId: group, role: "viewer" });
    await boris.put(`/api/pages/${page}/content`, { content });
    await new Promise((r) => setTimeout(r, 20));
    expect((await alice.get("/api/comments/notifications")).json().notifications).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });
});

describe("SCIM groups", () => {
  let idp: FakeOidc;
  let token: string;
  const scim = (method: string, url: string, body?: unknown) =>
    app.inject({
      method: method as "GET",
      url: `/api/scim/v2${url}`,
      headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/scim+json" } : {}) },
      payload: body ? JSON.stringify(body) : undefined,
    });
  const PATCH = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

  beforeEach(async () => {
    idp = await startFakeOidc();
    await boris.put("/api/admin/sso", { label: "Microsoft", issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret });
    token = (await boris.post("/api/admin/sso/scim-token", {})).json().token;
  });
  afterEach(() => idp.close());

  it("creates a group with its members, changes them, and deletes it", async () => {
    const created = await scim("POST", "/Groups", {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
      displayName: "Ventes",
      externalId: "grp-1",
      members: [{ value: aliceId }],
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id;
    expect(created.json()).toMatchObject({ displayName: "Ventes", externalId: "grp-1", members: [{ value: aliceId, display: "Alice" }] });

    // Found by name before being created again.
    const found = (await scim("GET", `/Groups?filter=${encodeURIComponent('displayName eq "ventes"')}&excludedAttributes=members`)).json();
    expect(found.totalResults).toBe(1);
    expect(found.Resources[0].members).toBeUndefined();
    expect((await scim("POST", "/Groups", { displayName: "Ventes" })).statusCode).toBe(409);

    // Entra ID's way: add, remove one, rename.
    await scim("PATCH", `/Groups/${id}`, { schemas: [PATCH], Operations: [{ op: "Add", path: "members", value: [{ value: eveId }] }] });
    expect((await scim("GET", `/Groups/${id}`)).json().members).toHaveLength(2);
    await scim("PATCH", `/Groups/${id}`, { schemas: [PATCH], Operations: [{ op: "Remove", path: `members[value eq "${aliceId}"]` }] });
    await scim("PATCH", `/Groups/${id}`, { schemas: [PATCH], Operations: [{ op: "Replace", value: { displayName: "Ventes France" } }] });
    const group = (await scim("GET", `/Groups/${id}`)).json();
    expect(group).toMatchObject({ displayName: "Ventes France", members: [{ value: eveId }] });

    // It works like any group, and administrators see where it comes from.
    const ws = await space("Commercial");
    await boris.put(`/api/workspaces/${ws}/groups`, { groupId: id, role: "viewer" });
    expect((await eve.get(`/api/workspaces/${ws}/pages`)).statusCode).toBe(200);
    expect((await boris.get("/api/admin/groups")).json().groups[0]).toMatchObject({ name: "Ventes France", scim: true });

    // PUT replaces the members.
    await scim("PUT", `/Groups/${id}`, { displayName: "Ventes France", members: [{ value: aliceId }] });
    expect((await eve.get(`/api/workspaces/${ws}/pages`)).statusCode).toBe(404);
    expect((await alice.get(`/api/workspaces/${ws}/pages`)).statusCode).toBe(200);

    expect((await scim("DELETE", `/Groups/${id}`)).statusCode).toBe(204);
    expect((await scim("GET", `/Groups/${id}`)).statusCode).toBe(404);
    expect((await alice.get(`/api/workspaces/${ws}/pages`)).statusCode).toBe(404);
  });
});
