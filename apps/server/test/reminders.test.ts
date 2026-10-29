import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { pushSubscriptions, reminders } from "../src/db/schema.js";
import { writeContent, type ProseMirrorNode } from "../src/collab.js";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let boris: Client;
let borisId: string;
let ws: string;
const sent: { endpoint: string; payload: string }[] = [];
let failWith: number | null = null;

beforeEach(async () => {
  sent.length = 0;
  failWith = null;
  app = await makeApp(
    undefined,
    {},
    {
      pushSender: async (sub, payload) => {
        if (failWith) throw Object.assign(new Error("push failed"), { statusCode: failWith });
        sent.push({ endpoint: sub.endpoint, payload });
      },
    },
  );
  boris = await setupAdmin(app);
  borisId = await boris.id();
  ws = await boris.personalWorkspace();
});

afterEach(async () => {
  await app.close();
});

const mention = (id: string, date: string, remindAt: Date | null, userId: string | null = borisId) => ({
  type: "dateMention",
  attrs: { id, date, reminder: remindAt ? 0 : null, remindAt: remindAt?.toISOString() ?? null, remindUser: remindAt ? userId : null },
});
const doc = (...paragraphs: ProseMirrorNode[][]): ProseMirrorNode => ({ type: "doc", content: paragraphs.map((content) => ({ type: "paragraph", content })) });
const soon = new Date(Date.now() + 3600_000);
const past = new Date(Date.now() - 60_000);

describe("reminders", () => {
  it("follows the dates of a page", async () => {
    const page = await boris.createPage(ws, "Projet");
    await writeContent(
      app.collab,
      app.db,
      page,
      doc([{ type: "text", text: "Appeler le garage " }, mention("m1", "2026-11-02T09:00", soon)], [mention("m2", "2026-11-03", null)]),
    );
    let list = (await boris.get("/api/reminders")).json().reminders;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ pageId: page, pageTitle: "Projet", date: "2026-11-02T09:00", text: "Appeler le garage", due: false });

    // Search finds the page by its date.
    const found = (await boris.get(`/api/search?q=${encodeURIComponent("2026-11-02")}`)).json();
    expect(JSON.stringify(found)).toContain(page);

    // A date removed from the page takes its reminder away; a changed date starts again.
    await writeContent(app.collab, app.db, page, doc([mention("m2", "2026-11-03", past)]));
    list = (await boris.get("/api/reminders")).json().reminders;
    expect(list.map((r: { date: string; due: boolean }) => [r.date, r.due])).toEqual([["2026-11-03", true]]);

    expect((await boris.post(`/api/reminders/${list[0].id}/dismiss`)).statusCode).toBe(200);
    expect((await boris.get("/api/reminders")).json().reminders).toEqual([]);
    // Same date, same time: stays done.
    await writeContent(app.collab, app.db, page, doc([{ type: "text", text: "Rendez-vous " }, mention("m2", "2026-11-03", past)]));
    expect((await boris.get("/api/reminders")).json().reminders).toEqual([]);
    await writeContent(app.collab, app.db, page, doc([mention("m2", "2026-11-04", soon)]));
    expect((await boris.get("/api/reminders")).json().reminders).toHaveLength(1);
  });

  it("is private, and follows access to the page", async () => {
    const team = (await boris.post("/api/workspaces", { name: "Équipe" })).json().workspace.id;
    const alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "motdepasse-alice" });
    const aliceId = await alice.id();
    await boris.put(`/api/workspaces/${team}/members`, { userId: aliceId, role: "editor" });
    const page = await boris.createPage(team, "Réunion");
    await writeContent(app.collab, app.db, page, doc([mention("a", "2026-11-02", soon, aliceId), mention("b", "2026-11-02", soon)]));
    const own = (await alice.get("/api/reminders")).json().reminders;
    expect(own).toHaveLength(1);
    expect((await boris.get("/api/reminders")).json().reminders).toHaveLength(1);
    expect((await boris.post(`/api/reminders/${own[0].id}/dismiss`)).statusCode).toBe(404);

    await boris.request("DELETE", `/api/workspaces/${team}/members/${aliceId}`);
    expect((await alice.get("/api/reminders")).json().reminders).toEqual([]);
    // Trashed pages remind nobody.
    await boris.delete(`/api/pages/${page}`);
    expect((await boris.get("/api/reminders")).json().reminders).toEqual([]);
  });

  it("templates and their copies have no reminders", async () => {
    const page = await boris.createPage(ws, "Modèle");
    await writeContent(app.collab, app.db, page, doc([mention("t", "2026-11-02", soon)]));
    expect((await boris.get("/api/reminders")).json().reminders).toHaveLength(1);
    await boris.patch(`/api/pages/${page}`, { template: true });
    expect((await boris.get("/api/reminders")).json().reminders).toEqual([]);
    const target = await boris.createPage(ws, "");
    expect((await boris.post(`/api/pages/${target}/apply-template`, { templateId: page })).statusCode).toBe(200);
    expect((await boris.get("/api/reminders")).json().reminders).toEqual([]);
    const copied = app.db.select().from(reminders).all();
    expect(copied).toEqual([]);
  });

  it("sends due reminders to the user's devices once", async () => {
    expect((await boris.get("/api/reminders/push-key")).json().publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    const sub = { endpoint: "https://push.example.com/abc", keys: { p256dh: "key", auth: "secret" } };
    expect((await boris.post("/api/reminders/push-subscriptions", sub)).statusCode).toBe(200);
    expect((await boris.post("/api/reminders/push-subscriptions", { endpoint: "not a url", keys: sub.keys })).statusCode).toBe(400);

    const page = await boris.createPage(ws, "Factures");
    await writeContent(
      app.collab,
      app.db,
      page,
      doc([{ type: "text", text: "Payer le loyer " }, mention("p", "2026-11-01", past)], [mention("q", "2026-12-01", soon)]),
    );
    await app.notifier.tick();
    await app.notifier.tick();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.endpoint).toBe(sub.endpoint);
    expect(JSON.parse(sent[0]!.payload)).toMatchObject({ title: "Factures", body: "Payer le loyer", url: `/page/${page}` });

    // Long overdue (the server was stopped): marked, not sent.
    await writeContent(app.collab, app.db, page, doc([mention("r", "2026-01-01", new Date(Date.now() - 3 * 86400_000))]));
    await app.notifier.tick();
    expect(sent).toHaveLength(1);

    // A device that unsubscribed is forgotten.
    failWith = 410;
    await writeContent(app.collab, app.db, page, doc([mention("s", "2026-01-01", past)]));
    await app.notifier.tick();
    expect(app.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, sub.endpoint)).all()).toEqual([]);

    expect((await boris.post("/api/reminders/push-subscriptions", sub)).statusCode).toBe(200);
    expect((await boris.request("DELETE", "/api/reminders/push-subscriptions", { endpoint: sub.endpoint })).statusCode).toBe(200);
    expect(app.db.select().from(pushSubscriptions).all()).toEqual([]);
  });
});
