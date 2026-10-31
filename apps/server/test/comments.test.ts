import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let boris: Client;
let alice: Client;
let eve: Client;
let sent: { endpoint: string; payload: string }[];
let ws: string;
let page: string;
let aliceId: string;
let eveId: string;

const ANCHOR = { start: "AQIDBA==", end: "BQYHCA==" };

beforeEach(async () => {
  sent = [];
  app = await makeApp(undefined, {}, { pushSender: async (sub, payload) => void sent.push({ endpoint: sub.endpoint, payload }) });
  boris = await setupAdmin(app);
  alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password", locale: "en" });
  eve = await inviteUser(app, boris, { name: "Eve", email: "eve@example.com", password: "eve-password" });
  aliceId = await alice.id();
  eveId = await eve.id();
  ws = await boris.personalWorkspace();
  page = await boris.createPage(ws, "Budget");
  await boris.put(`/api/pages/${page}/shares`, { userId: aliceId, role: "commenter" });
  await boris.put(`/api/pages/${page}/shares`, { userId: eveId, role: "viewer" });
  await alice.post("/api/reminders/push-subscriptions", { endpoint: "https://push.example.com/alice", keys: { p256dh: "k", auth: "a" } });
});

const threads = async (c: Client) => (await c.get(`/api/pages/${page}/comments`)).json().threads;

describe("comments", () => {
  it("starts threads on a passage or the page, answers them, and resolves them", async () => {
    const res = await boris.post(`/api/pages/${page}/comments`, { body: "Le loyer a augmenté ?", anchor: ANCHOR, quote: "Loyer : 800 €" });
    expect(res.statusCode).toBe(200);
    const thread = res.json().thread;
    expect(thread).toMatchObject({
      pageId: page,
      anchor: ANCHOR,
      quote: "Loyer : 800 €",
      resolvedAt: null,
      comments: [{ authorName: "Boris", body: "Le loyer a augmenté ?" }],
    });

    // A commenter answers; a viewer reads but can't write.
    expect((await alice.post(`/api/comments/threads/${thread.id}/replies`, { body: "Oui, de 20 €" })).statusCode).toBe(200);
    expect((await eve.post(`/api/comments/threads/${thread.id}/replies`, { body: "Moi aussi" })).statusCode).toBe(403);
    expect((await eve.post(`/api/pages/${page}/comments`, { body: "Moi aussi" })).statusCode).toBe(403);
    expect((await threads(eve))[0].comments.map((c: { body: string }) => c.body)).toEqual(["Le loyer a augmenté ?", "Oui, de 20 €"]);

    // A comment on the whole page has no anchor nor quote.
    const pageThread = (await alice.post(`/api/pages/${page}/comments`, { body: "Bien vu", quote: "ignored" })).json().thread;
    expect(pageThread).toMatchObject({ anchor: null, quote: "" });

    const resolved = (await alice.post(`/api/comments/threads/${thread.id}/resolve`, { resolved: true })).json().thread;
    expect(resolved.resolvedByName).toBe("Alice");
    // Open threads come first.
    expect((await threads(boris)).map((th: { id: string }) => th.id)).toEqual([pageThread.id, thread.id]);
    // Answering a resolved thread opens it again.
    const reopened = (await boris.post(`/api/comments/threads/${thread.id}/replies`, { body: "Merci" })).json().thread;
    expect(reopened.resolvedAt).toBeNull();

    // Nobody outside the page sees anything.
    const outsider = await inviteUser(app, boris, { name: "Zoé", email: "zoe@example.com", password: "zoe-password" });
    expect((await outsider.get(`/api/pages/${page}/comments`)).statusCode).toBe(404);
    expect((await outsider.post(`/api/comments/threads/${thread.id}/replies`, { body: "?" })).statusCode).toBe(404);
  });

  it("lets only the author change or delete a comment; the last one takes its thread", async () => {
    const thread = (await boris.post(`/api/pages/${page}/comments`, { body: "Premier" })).json().thread;
    const reply = (await alice.post(`/api/comments/threads/${thread.id}/replies`, { body: "Second" })).json().thread.comments[1];
    expect((await boris.patch(`/api/comments/${reply.id}`, { body: "Changé" })).statusCode).toBe(403);
    const edited = (await alice.patch(`/api/comments/${reply.id}`, { body: "Second, corrigé" })).json().thread.comments[1];
    expect(edited).toMatchObject({ body: "Second, corrigé" });
    expect(edited.editedAt).not.toBeNull();

    expect((await boris.delete(`/api/comments/${reply.id}`)).statusCode).toBe(403);
    expect((await boris.delete(`/api/comments/${thread.comments[0].id}`)).json().thread.comments).toHaveLength(1);
    expect((await alice.delete(`/api/comments/${reply.id}`)).json().thread).toBeNull();
    expect(await threads(boris)).toEqual([]);
  });

  it("tells the people mentioned and the thread's participants, in their language", async () => {
    const thread = (await boris.post(`/api/pages/${page}/comments`, { body: `<@${aliceId}> tu peux vérifier ?`, anchor: ANCHOR, quote: "x" })).json().thread;
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!.payload)).toMatchObject({
      title: "Boris mentioned you in Budget",
      body: "@Alice tu peux vérifier ?",
      url: `/page/${page}?comment=${thread.id}`,
    });

    let alices = (await alice.get("/api/comments/notifications")).json().notifications;
    expect(alices).toMatchObject([
      { kind: "mention", pageId: page, pageTitle: "Budget", threadId: thread.id, actorName: "Boris", excerpt: "@Alice tu peux vérifier ?", read: false },
    ]);

    // Alice answers: Boris hears of it (not Alice herself).
    await alice.post(`/api/comments/threads/${thread.id}/replies`, { body: "C'est fait" });
    const boriss = (await boris.get("/api/comments/notifications")).json().notifications;
    expect(boriss).toMatchObject([{ kind: "reply", actorName: "Alice", excerpt: "C'est fait" }]);
    expect((await alice.get("/api/comments/notifications")).json().notifications).toHaveLength(1);

    // Mentioning someone who can't read the page tells them nothing; mentioning a viewer does.
    const outsider = await inviteUser(app, boris, { name: "Zoé", email: "zoe@example.com", password: "zoe-password" });
    await boris.post(`/api/comments/threads/${thread.id}/replies`, { body: `<@${await outsider.id()}> <@${eveId}> regardez` });
    expect((await outsider.get("/api/comments/notifications")).json().notifications).toEqual([]);
    expect((await eve.get("/api/comments/notifications")).json().notifications).toMatchObject([{ kind: "mention" }]);
    // Alice took part: the reply reaches her too.
    expect((await alice.get("/api/comments/notifications")).json().notifications.map((n: { kind: string }) => n.kind)).toEqual(["reply", "mention"]);

    // An edit only tells the people newly mentioned.
    const pageThread = (await boris.post(`/api/pages/${page}/comments`, { body: `Pour <@${eveId}>` })).json().thread;
    await boris.patch(`/api/comments/${pageThread.comments[0].id}`, { body: `Pour <@${eveId}> et <@${aliceId}>` });
    expect((await eve.get("/api/comments/notifications")).json().notifications).toHaveLength(2);
    expect((await alice.get("/api/comments/notifications")).json().notifications).toHaveLength(3);

    // Read once seen.
    alices = (await alice.get("/api/comments/notifications")).json().notifications;
    await alice.post("/api/comments/notifications/read", { ids: [alices[0].id] });
    expect((await alice.get("/api/comments/notifications")).json().notifications.map((n: { read: boolean }) => n.read)).toEqual([true, false, false]);
    await alice.post("/api/comments/notifications/read", {});
    expect((await alice.get("/api/comments/notifications")).json().notifications.every((n: { read: boolean }) => n.read)).toBe(true);

    // A page moved to the trash takes its notifications out of the list.
    await boris.delete(`/api/pages/${page}`);
    expect((await alice.get("/api/comments/notifications")).json().notifications).toEqual([]);
  });

  it("keeps comments off databases", async () => {
    const db = (await boris.post("/api/databases", { workspaceId: ws, parentId: null, title: "Dépenses" })).json().database;
    expect((await boris.post(`/api/pages/${db.id}/comments`, { body: "?" })).statusCode).toBe(400);
  });
});
