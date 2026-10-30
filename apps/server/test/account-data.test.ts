import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { attachments, pages, users, workspaces } from "../src/db/schema.js";
import { uploadsDir } from "../src/attachments.js";
import { ADMIN, Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let dataDir = "";
let boris: Client;
let alice: Client;

beforeEach(async () => {
  app = await makeApp((d) => (dataDir = d));
  boris = await setupAdmin(app);
  alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
});

const sharedSpace = async (c: Client, name: string) => (await c.post("/api/workspaces", { name })).json().workspace.id as string;
const pageCount = (workspaceId: string) => app.db.select().from(pages).where(eq(pages.workspaceId, workspaceId)).all().length;

describe("emptying a space", () => {
  it("deletes every page of the space, trash included, for its owners only", async () => {
    const ws = await boris.personalWorkspace();
    const a = await boris.createPage(ws, "A");
    await boris.createPage(ws, "B", a);
    const trashed = await boris.createPage(ws, "C");
    await boris.delete(`/api/pages/${trashed}`);
    const db = await boris.post("/api/databases", { workspaceId: ws, parentId: null, title: "Bills" });
    await boris.post(`/api/databases/${db.json().database.id}/rows`, { values: {} });
    expect(pageCount(ws)).toBe(5);
    const file = path.join(uploadsDir(dataDir), "file-1");
    fs.mkdirSync(uploadsDir(dataDir), { recursive: true });
    fs.writeFileSync(file, "pdf");
    app.db.insert(attachments).values({ id: "file-1", pageId: a, filename: "a.pdf", mimeType: "application/pdf", size: 3 }).run();

    expect((await alice.delete(`/api/workspaces/${ws}/content`)).statusCode).toBe(404);
    const res = await boris.delete(`/api/workspaces/${ws}/content`);
    expect(res.statusCode, res.body).toBe(200);
    expect(pageCount(ws)).toBe(0);
    // The attached files go too.
    expect(fs.existsSync(file)).toBe(false);
    // The space is still there, empty.
    expect((await boris.get("/api/workspaces")).json().workspaces.map((w: { id: string }) => w.id)).toContain(ws);

    // In a shared space, editors can't.
    const shared = await sharedSpace(boris, "Family");
    await boris.put(`/api/workspaces/${shared}/members`, { userId: await alice.id(), role: "editor" });
    await alice.createPage(shared, "Groceries");
    expect((await alice.delete(`/api/workspaces/${shared}/content`)).statusCode).toBe(404);
    expect(pageCount(shared)).toBe(1);
  });
});

describe("deleting one's account", () => {
  it("asks for the password, then deletes the account and what only it had", async () => {
    const aliceId = await alice.id();
    const personal = await alice.personalWorkspace();
    await alice.createPage(personal, "Diary");
    const alone = await sharedSpace(alice, "Alone");
    await alice.createPage(alone, "Notes");
    // A space with Boris: it stays, with what Alice wrote.
    const family = await sharedSpace(boris, "Family");
    await boris.put(`/api/workspaces/${family}/members`, { userId: aliceId, role: "editor" });
    const recipe = await alice.createPage(family, "Recipe");

    expect((await alice.request("DELETE", "/api/auth/me", { password: "wrong-password" })).statusCode).toBe(400);
    const res = await alice.request("DELETE", "/api/auth/me", { password: "alice-password" });
    expect(res.statusCode, res.body).toBe(200);

    expect(app.db.select().from(users).where(eq(users.id, aliceId)).get()).toBeUndefined();
    expect(app.db.select().from(workspaces).where(eq(workspaces.id, personal)).get()).toBeUndefined();
    expect(app.db.select().from(workspaces).where(eq(workspaces.id, alone)).get()).toBeUndefined();
    expect(pageCount(personal) + pageCount(alone)).toBe(0);
    expect((await boris.get(`/api/pages/${recipe}`)).statusCode).toBe(200);
    // Signed out.
    expect((await alice.get("/api/auth/me")).statusCode).toBe(401);
    expect((await new Client(app).post("/api/auth/login", { email: "alice@example.com", password: "alice-password" })).statusCode).toBe(401);
  });

  it("refuses while others depend on the account", async () => {
    // Sole owner of a space others work in.
    const family = await sharedSpace(alice, "Family");
    await alice.put(`/api/workspaces/${family}/members`, { userId: await boris.id(), role: "editor" });
    const res = await alice.request("DELETE", "/api/auth/me", { password: "alice-password" });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toContain("Family");
    await alice.put(`/api/workspaces/${family}/members`, { userId: await boris.id(), role: "owner" });
    expect((await alice.request("DELETE", "/api/auth/me", { password: "alice-password" })).statusCode).toBe(200);

    // The last administrator, while other people use the server.
    const eve = await inviteUser(app, boris, { name: "Eve", email: "eve@example.com", password: "eve-password" });
    expect((await boris.request("DELETE", "/api/auth/me", { password: ADMIN.password })).statusCode).toBe(409);
    expect((await eve.request("DELETE", "/api/auth/me", { password: "eve-password" })).statusCode).toBe(200);
    // Alone on the server: the server goes back to its first setup.
    expect((await boris.request("DELETE", "/api/auth/me", { password: ADMIN.password })).statusCode).toBe(200);
    expect((await new Client(app).get("/api/setup")).json()).toMatchObject({ needsSetup: true });
  });
});
