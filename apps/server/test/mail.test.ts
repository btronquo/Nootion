import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let boris: Client;
let alice: Client;
let mails: { from: string; to: string; subject: string; text: string; html: string }[];

const SMTP = { provider: "smtp", from: "Nootion <nootion@example.com>", smtp: { host: "smtp.example.com", port: 587, security: "starttls", user: "nootion", password: "s3cret" } };

beforeEach(async () => {
  mails = [];
  app = await makeApp(undefined, {}, { mailSender: async (m) => void mails.push(m) });
  boris = await setupAdmin(app);
  alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password", locale: "en" });
});

describe("e-mail", () => {
  it("is set by administrators, never shows its secret, and sends a test", async () => {
    expect((await alice.get("/api/admin/mail")).statusCode).toBe(403);
    expect((await boris.get("/api/admin/mail")).json().settings).toBeNull();
    expect((await boris.post("/api/admin/mail/test", {})).statusCode).toBe(400);

    const saved = (await boris.put("/api/admin/mail", SMTP)).json().settings;
    expect(saved).toEqual({ provider: "smtp", from: SMTP.from, smtp: { host: "smtp.example.com", port: 587, security: "starttls", user: "nootion" }, hasSecret: true });
    expect(JSON.stringify(app.db.$client.prepare("SELECT * FROM mail_settings").all())).not.toContain("s3cret");
    // Saved again without the password: it is kept.
    expect((await boris.put("/api/admin/mail", { ...SMTP, smtp: { ...SMTP.smtp, password: undefined } })).json().settings.hasSecret).toBe(true);
    // Resend needs its key.
    expect((await boris.put("/api/admin/mail", { provider: "resend", from: SMTP.from })).statusCode).toBe(400);

    const test = await boris.post("/api/admin/mail/test", {});
    expect(test.json()).toMatchObject({ ok: true, to: "boris@example.com" });
    expect(mails[0]).toMatchObject({ from: SMTP.from, to: "boris@example.com", subject: "Nootion : e-mail de test" });
    expect(mails[0]!.html).toContain("http://localhost:3000");
    expect((await app.inject({ method: "GET", url: "/api/setup" })).json().mail).toBe(true);
  });

  it("e-mails mentions and replies, unless turned off", async () => {
    await boris.put("/api/admin/mail", SMTP);
    const aliceId = await alice.id();
    const ws = await boris.personalWorkspace();
    const page = await boris.createPage(ws, "Budget");
    await boris.put(`/api/pages/${page}/shares`, { userId: aliceId, role: "commenter" });
    await boris.post(`/api/pages/${page}/comments`, { body: `<@${aliceId}> can you check?` });
    await app.mailer.idle();
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ to: "alice@example.com", subject: "Boris mentioned you in Budget" });
    expect(mails[0]!.text).toContain(`http://localhost:3000/page/${page}?comment=`);

    expect((await alice.get("/api/account/email")).json()).toEqual({ enabled: true, prefs: { reminders: true, mentions: true, replies: true } });
    expect((await alice.put("/api/account/email", { mentions: false })).json().prefs).toEqual({ reminders: true, mentions: false, replies: true });
    await boris.post(`/api/pages/${page}/comments`, { body: `<@${aliceId}> again` });
    await app.mailer.idle();
    expect(mails).toHaveLength(1);
  });

  it("sends invitations to the address given", async () => {
    const res = (await boris.post("/api/admin/invitations", { role: "member", email: "carol@example.com" })).json();
    expect(res.emailed).toBe(false);
    await boris.put("/api/admin/mail", SMTP);
    const sent = (await boris.post("/api/admin/invitations", { role: "member", email: "carol@example.com" })).json();
    expect(sent.emailed).toBe(true);
    expect(mails[0]).toMatchObject({ to: "carol@example.com", subject: "Boris vous invite sur Nootion" });
    expect(mails[0]!.text).toContain(sent.url);
  });

  it("resets a forgotten password with a link that works once", async () => {
    await boris.put("/api/admin/mail", SMTP);
    const anon = new Client(app);
    expect((await anon.post("/api/auth/forgot", { email: "nobody@example.com" })).json()).toEqual({ ok: true });
    expect(mails).toHaveLength(0);
    await anon.post("/api/auth/forgot", { email: "alice@example.com" });
    expect(mails[0]).toMatchObject({ to: "alice@example.com", subject: "Reset your Nootion password" });
    const token = /\/reset\/([\w-]+)/.exec(mails[0]!.text)![1]!;
    expect((await anon.get(`/api/auth/reset/${token}`)).json()).toEqual({ email: "alice@example.com" });
    expect((await anon.post("/api/auth/reset", { token, password: "short" })).statusCode).toBe(400);
    expect((await anon.post("/api/auth/reset", { token, password: "a-brand-new-password" })).statusCode).toBe(200);
    // Alice was signed out, and the link is spent.
    expect((await alice.get("/api/auth/me")).statusCode).toBe(401);
    expect((await anon.post("/api/auth/reset", { token, password: "another-password" })).statusCode).toBe(404);
    expect((await anon.post("/api/auth/login", { email: "alice@example.com", password: "a-brand-new-password" })).statusCode).toBe(200);
  });
});
