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
  await boris.put(`/api/pages/${page}/shares`, { userId: aliceId, role: "viewer" });
  await alice.post("/api/reminders/push-subscriptions", { endpoint: "https://push.example.com/alice", keys: { p256dh: "k", auth: "a" } });
});

const mention = (id: string, userId: string, name: string) => ({ type: "userMention", attrs: { id, userId, name } });
const write = (...inline: unknown[]) =>
  boris.put(`/api/pages/${page}/content`, { content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Voir avec " }, ...inline] }] } });
const settle = () => new Promise((r) => setTimeout(r, 20));

describe("mentions of people in pages", () => {
  it("tells the people mentioned once, if they can read the page", async () => {
    expect((await write(mention("m1", aliceId, "Alice"), { type: "text", text: " et " }, mention("m2", eveId, "Eve"))).statusCode).toBe(200);
    await settle();
    const list = (await alice.get("/api/comments/notifications")).json().notifications;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: "page_mention", pageId: page, threadId: null, actorName: "Boris", excerpt: "Voir avec @Alice et @Eve", read: false });
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!.payload)).toMatchObject({ title: "Boris mentioned you in Budget", url: `/page/${page}` });
    // Eve can't read the page.
    expect((await eve.get("/api/comments/notifications")).json().notifications).toEqual([]);

    // The same mention saved again tells nobody; a new one does.
    await write(mention("m1", aliceId, "Alice"));
    await write(mention("m1", aliceId, "Alice"), mention("m3", aliceId, "Alice"));
    await settle();
    expect((await alice.get("/api/comments/notifications")).json().notifications).toHaveLength(2);

    await alice.post("/api/comments/notifications/read", {});
    expect((await alice.get("/api/comments/notifications")).json().notifications.every((n: { read: boolean }) => n.read)).toBe(true);
  });

  it("shows as @name in Markdown and search, and tells nobody from a template", async () => {
    await write(mention("m1", aliceId, "Alice"), { type: "tableOfContents" });
    expect((await boris.get(`/api/pages/${page}/content`)).json().markdown).toContain("Voir avec @Alice");
    const tpl = await boris.createPage(ws, "Modèle");
    await boris.patch(`/api/pages/${tpl}`, { template: true });
    await boris.put(`/api/pages/${tpl}/shares`, { userId: eveId, role: "viewer" });
    await boris.put(`/api/pages/${tpl}/content`, { content: { type: "doc", content: [{ type: "paragraph", content: [mention("t1", eveId, "Eve")] }] } });
    await settle();
    expect((await eve.get("/api/comments/notifications")).json().notifications).toEqual([]);
  });
});
