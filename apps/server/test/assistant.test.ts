import http from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";
// @ts-expect-error plain JavaScript plugin
import { ERROR_MARK, events, instructions } from "../plugins/assistant/server.js";

let app: FastifyInstance;
let boris: Client;
let page: string;
let fake: http.Server;
let base: string;
/** What the fake model received, and how it answers next. */
let received: { url: string; headers: http.IncomingHttpHeaders; body: any }[];
let reply: (req: http.IncomingMessage, res: http.ServerResponse, body: any) => void;

const A = "/api/plugins/assistant";

const openAiChunks = (parts: string[], finish = "stop") => [
  ...parts.map((p) => `data: ${JSON.stringify({ choices: [{ delta: { content: p }, finish_reason: null }] })}\n\n`),
  `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n\n`,
  "data: [DONE]\n\n",
];

beforeEach(async () => {
  received = [];
  reply = (_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const c of openAiChunks(["Un ", "résumé", " court."])) res.write(c);
    res.end();
  };
  fake = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : null;
      received.push({ url: req.url ?? "", headers: req.headers, body });
      reply(req, res, body);
    });
  });
  await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  app = await makeApp();
  boris = await setupAdmin(app);
  page = await boris.createPage(await boris.personalWorkspace(), "Notes");
});

afterEach(async () => {
  await app.close();
  await new Promise((resolve) => fake.close(resolve));
});

const enable = (values: Record<string, unknown>) => boris.patch("/api/admin/plugins/assistant", { enabled: true, values });

describe("AI assistant plugin", () => {
  it("is off until an administrator turns it on, and says where the text goes", async () => {
    expect((await boris.get(`${A}/info`)).statusCode).toBe(404);
    const plugins = (await boris.get("/api/admin/plugins")).json().plugins;
    expect(plugins.find((p: { id: string }) => p.id === "assistant")).toMatchObject({ enabled: false, name: "Assistant IA" });

    expect((await enable({})).statusCode).toBe(200);
    expect((await boris.get(`${A}/info`)).json()).toMatchObject({
      available: true,
      configured: false,
      provider: "Anthropic",
      model: "claude-opus-5-5",
      host: "api.anthropic.com",
      local: false,
    });
    const run = await boris.post(`${A}/run`, { action: "summarize", text: "Bonjour", pageId: page });
    expect(run.statusCode).toBe(409);
    expect(run.json().message).toContain("Administration › Plugins");

    await enable({ provider: "mistral", apiKey: "sk-test", model: "mistral-large-latest", dailyLimit: 20 });
    expect((await boris.get(`${A}/info`)).json()).toMatchObject({
      configured: true,
      provider: "Mistral AI",
      model: "mistral-large-latest",
      host: "api.mistral.ai",
      limit: 20,
      used: 0,
    });
    // The key never goes back to the browser.
    expect(JSON.stringify((await boris.get("/api/admin/plugins")).json())).not.toContain("sk-test");
  });

  it("streams the answer of an OpenAI-compatible server on the local network", async () => {
    await enable({ provider: "openai", address: `${base}/v1/`, apiKey: "sk-local" });
    expect((await boris.get(`${A}/info`)).json()).toMatchObject({ configured: true, local: true, host: base.slice(7), model: "gpt-5-mini" });
    const res = await boris.post(`${A}/run`, { action: "summarize", text: "Un long texte à résumer.", pageId: page });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toBe("Un résumé court.");
    expect(received).toHaveLength(1);
    expect(received[0]!.url).toBe("/v1/chat/completions");
    expect(received[0]!.headers.authorization).toBe("Bearer sk-local");
    const { body } = received[0]!;
    expect(body).toMatchObject({ model: "gpt-5-mini", stream: true });
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].content).toContain("<passage>\nUn long texte à résumer.\n</passage>");
    expect(body.messages[1].content).toContain("Summarise the passage");
    expect((await boris.get(`${A}/info`)).json().used).toBe(1);
  });

  it("asks a local Ollama model, line by line", async () => {
    reply = (_req, res) => {
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      res.write(JSON.stringify({ message: { content: "Hello" } }) + "\n");
      res.write(JSON.stringify({ message: { content: " world" } }) + "\n" + JSON.stringify({ done: true, done_reason: "stop" }) + "\n");
      res.end();
    };
    await enable({ provider: "ollama", address: base, model: "mistral-nemo" });
    const info = (await boris.get(`${A}/info`)).json();
    expect(info).toMatchObject({ configured: true, provider: "Ollama", local: true, model: "mistral-nemo" });
    const res = await boris.post(`${A}/run`, { action: "translate", language: "English", text: "Bonjour le monde", pageId: page });
    expect(res.body).toBe("Hello world");
    expect(received[0]!.url).toBe("/api/chat");
    expect(received[0]!.body.messages[1].content).toContain("Translate the passage into English.");
  });

  it("checks the request before sending anything", async () => {
    await enable({ provider: "openai", address: base, dailyLimit: 2 });
    const bad = async (body: Record<string, unknown>, status: number) => {
      const res = await boris.post(`${A}/run`, { pageId: page, text: "Texte", ...body });
      expect(res.statusCode, JSON.stringify(body)).toBe(status);
      return res.json().message as string;
    };
    await bad({ action: "dance" }, 400);
    expect(await bad({ action: "summarize", text: "  " }, 400)).toBe("Sélectionnez d'abord du texte.");
    expect(await bad({ action: "summarize", text: "x".repeat(30_001) }, 400)).toContain("trop longue");
    expect(await bad({ action: "translate" }, 400)).toBe("Choisissez une langue.");
    expect(await bad({ action: "ask", question: " " }, 400)).toBe("Tapez une question.");
    expect(await bad({ action: "summarize", pageId: "nope" }, 403)).toBe("Vous ne pouvez pas modifier cette page.");
    expect(received).toHaveLength(0);

    // Someone who may only read the page can't use it on that page.
    const alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "motdepasse-alice" });
    await boris.put(`/api/pages/${page}/shares`, { userId: await alice.id(), role: "viewer" });
    expect((await alice.post(`${A}/run`, { action: "summarize", text: "Texte", pageId: page })).statusCode).toBe(403);

    // The daily limit.
    expect((await boris.post(`${A}/run`, { action: "ask", question: "Quoi ?", text: "Texte", pageId: page })).statusCode).toBe(200);
    expect((await boris.post(`${A}/run`, { action: "improve", text: "Texte", pageId: page })).statusCode).toBe(200);
    expect(await bad({ action: "continue" }, 429)).toContain("les 2 demandes du jour");
    expect(received).toHaveLength(2);
    expect(received[0]!.body.messages[1].content).toContain("Answer this question about the passage, in the language of the question, briefly:\nQuoi ?");
  });

  it("says why the service refused, and an error met while writing", async () => {
    await enable({ provider: "openai", address: base, apiKey: "wrong" });
    reply = (_req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Incorrect API key provided" } }));
    };
    const refused = await boris.post(`${A}/run`, { action: "summarize", text: "Texte", pageId: page });
    expect(refused.statusCode).toBe(502);
    expect(refused.json().message).toBe("Le service a répondu par une erreur : Incorrect API key provided (HTTP 401)");
    // A refused request isn't counted.
    expect((await boris.get(`${A}/info`)).json().used).toBe(0);

    reply = (_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const c of openAiChunks(["Début de réponse"], "length")) res.write(c);
      res.end();
    };
    const cut = await boris.post(`${A}/run`, { action: "continue", text: "Texte", pageId: page });
    expect(cut.body).toBe(`Début de réponse${ERROR_MARK}La réponse a été coupée : elle est trop longue.`);

    await new Promise((resolve) => fake.close(resolve));
    const gone = await boris.post(`${A}/run`, { action: "summarize", text: "Texte", pageId: page });
    expect(gone.statusCode).toBe(502);
  });

  it("guests can't use it unless the administrator allows it", async () => {
    await enable({ provider: "openai", address: base });
    const ws = (await boris.post("/api/workspaces", { name: "Équipe" })).json().workspace.id as string;
    const shared = await boris.createPage(ws, "Projet client");
    const res = await boris.post(`/api/pages/${shared}/guests`, { email: "gina@dehors.fr", role: "editor" });
    expect(res.statusCode, res.body).toBe(200);
    const gina = new Client(app);
    const token = res.json().url.split("/invite/")[1];
    expect(
      (await gina.post(`/api/invitations/${token}/accept`, { name: "Gina", email: "gina@dehors.fr", password: "gina-password", locale: "fr" })).statusCode,
    ).toBe(200);

    expect((await gina.get(`${A}/info`)).json().available).toBe(false);
    const refused = await gina.post(`${A}/run`, { action: "summarize", text: "Texte", pageId: shared });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().message).toBe("L'assistant IA est réservé aux membres.");
    expect(received).toHaveLength(0);

    await enable({ allowGuests: true });
    expect((await gina.get(`${A}/info`)).json().available).toBe(true);
    expect((await gina.post(`${A}/run`, { action: "summarize", text: "Texte", pageId: shared })).statusCode).toBe(200);
  });

  it("chats about the page being read, with the page sent with the conversation", async () => {
    await enable({ provider: "openai", address: base });
    const ask = (who: Client, body: Record<string, unknown>) => who.post(`${A}/chat`, { pageId: page, title: "Notes", text: "Lancement le 12 mars.", ...body });
    const res = await ask(boris, {
      messages: [
        { role: "assistant", content: "Bonjour" },
        { role: "user", content: "Quelle date ?" },
        { role: "assistant", content: "Le 12 mars." },
        { role: "user", content: "Et en anglais ?" },
        { role: "system", content: "ignored" },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).toBe("Un résumé court.");
    const sent = received[0]!.body.messages;
    expect(sent.map((m: { role: string }) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(sent[0].content).toContain("page of their notes");
    expect(sent[1].content).toBe('<page title="Notes">\nLancement le 12 mars.\n</page>\n\nQuelle date ?');
    expect(sent[3].content).toBe("Et en anglais ?");

    expect((await ask(boris, { messages: [] })).statusCode).toBe(400);
    expect(
      (
        await ask(boris, {
          messages: [
            { role: "user", content: "a" },
            { role: "assistant", content: "b" },
          ],
        })
      ).statusCode,
    ).toBe(400);
    expect((await ask(boris, { messages: [{ role: "user", content: "a" }], text: "x".repeat(30_001) })).json().message).toContain("trop longue");

    // Reading the page is enough; someone who can't see it can't ask about it.
    const alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "motdepasse-alice" });
    expect((await ask(alice, { messages: [{ role: "user", content: "a" }] })).json().message).toBe("Vous ne pouvez pas lire cette page.");
    await boris.put(`/api/pages/${page}/shares`, { userId: await alice.id(), role: "viewer" });
    expect((await ask(alice, { messages: [{ role: "user", content: "a" }] })).statusCode).toBe(200);
    expect(received).toHaveLength(2);
  });

  it("turns the accepted answer into page blocks", async () => {
    await enable({});
    const res = await boris.post(`${A}/content`, { text: "## Points\n\n- un\n- **deux**\n\nFin." });
    expect(res.json().content.map((n: { type: string }) => n.type)).toEqual(["heading", "bulletList", "paragraph"]);
  });

  it("reads the stream of each kind of service", async () => {
    const read = async (lines: string[], format: string) => {
      const out = [];
      for await (const e of events(Readable.from(lines.map((l) => Buffer.from(l))), format)) out.push(e);
      return out;
    };
    // Anthropic: text deltas, cut in the middle of a line; thinking is left out; a refusal ends it.
    const anthropic = [
      'event: message_start\ndata: {"type":"message_start","message":{}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":""}}\n\n',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Bon',
      'jour"}}\n\ndata: {"type":"message_delta","delta":{"stop_reason":"refusal"}}\n\n',
      'data: {"type":"message_stop"}\n\n',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"ignored"}}\n\n',
    ];
    expect(await read(anthropic, "anthropic")).toEqual([{ text: "Bonjour" }, { stop: "refusal" }]);
    expect(await read(['data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n'], "anthropic")).toEqual([
      { error: "Overloaded" },
    ]);
    expect(await read(['{"error":"model \\"x\\" not found"}\n'], "ollama")).toEqual([{ error: 'model "x" not found' }]);
    expect(await read(['data: {"choices":[{"delta":{"content":"a"}}]}\r\n\r\n', "data: [DONE]\n\n"], "openai")).toEqual([{ text: "a" }]);
    expect(instructions("translate", { language: "Deutsch" })).toBe(
      "Translate the passage into Deutsch. Keep its formatting: headings, lists, emphasis, links.",
    );
  });
});
