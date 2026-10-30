import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

const DEMO_SERVER = `
let ticks = 0;
export function activate(nootion) {
  nootion.route("GET", "/hello/:name", ({ params, user }) => ({ hello: params.name, user: user.name, token: nootion.settings.token, mode: nootion.settings.mode }));
  nootion.route("GET", "/open", () => ({ open: true }), { public: true });
  nootion.route("POST", "/fail", () => { throw new nootion.HttpError(418, "teapot", "Je suis une théière."); });
  nootion.route("GET", "/ticks", () => ({ ticks }));
  nootion.every(1000, () => { ticks++; });
  nootion.formulaFunction("ttc", { min: 1, max: 1, help: "ttc(x) : x × 1,2", run: ([x]) => Math.round(x * 120) / 100 });
}
`;

function writeDemo(dataDir: string) {
  const dir = path.join(dataDir, "plugins", "demo");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify({
      id: "demo",
      name: "Démo",
      version: "0.1.0",
      server: "server.js",
      client: "client.js",
      blocks: [{ id: "hello", title: "Hello" }],
      settings: [
        { key: "token", label: "Jeton", type: "password" },
        {
          key: "mode",
          label: "Mode",
          type: "select",
          default: "a",
          options: [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
          ],
        },
      ],
    }),
  );
  fs.writeFileSync(path.join(dir, "server.js"), DEMO_SERVER);
  fs.writeFileSync(path.join(dir, "client.js"), "export function activate() {}");
  // A broken one is reported, not fatal.
  fs.mkdirSync(path.join(dataDir, "plugins", "broken"));
  fs.writeFileSync(path.join(dataDir, "plugins", "broken", "manifest.json"), '{"id": "Bad Id"}');
}

let app: FastifyInstance;
let boris: Client;
let alice: Client;
let dataDir = "";

beforeEach(async () => {
  app = await makeApp((d) => {
    dataDir = d;
    writeDemo(d);
  });
  boris = await setupAdmin(app);
  alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
});
afterEach(() => app.close());

describe("plugins", () => {
  it("lists plugins: the built-in embed is on, others are off by default", async () => {
    const admin = (await boris.get("/api/admin/plugins")).json();
    expect(admin.plugins.map((p: { id: string; enabled: boolean; builtin: boolean }) => [p.id, p.enabled, p.builtin])).toEqual([
      ["embed", true, true],
      ["nextcloud", false, true],
      ["demo", false, false],
    ]);
    expect(admin.broken).toHaveLength(1);
    expect((await alice.get("/api/admin/plugins")).statusCode).toBe(403);
    expect((await alice.patch("/api/admin/plugins/demo", { enabled: true })).statusCode).toBe(403);

    // Anyone (public pages too) gets the blocks of every installed plugin, and the code of enabled ones.
    const anon = new Client(app);
    const list = (await anon.get("/api/plugins")).json().plugins;
    expect(list.find((p: { id: string }) => p.id === "demo")).toMatchObject({ enabled: false, clientUrl: null, blocks: [{ id: "hello" }] });
    expect(list.find((p: { id: string }) => p.id === "embed").clientUrl).toMatch(/^\/api\/plugins\/embed\/client\.js/);
    expect((await anon.get("/api/plugins/embed/client.js")).body).toContain("registerBlock");
    expect((await anon.get("/api/plugins/demo/client.js")).statusCode).toBe(404);
    expect((await alice.get("/api/plugins/demo/hello/x")).statusCode).toBe(404);
  });

  it("turning a plugin on: routes, encrypted settings, formula functions; turning it off stops everything", async () => {
    const res = await boris.patch("/api/admin/plugins/demo", { enabled: true, values: { token: "s3cret-value", mode: "b" } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().plugin.values).toEqual({ token: { set: true }, mode: "b" });
    // Stored encrypted.
    const raw = app.db.$client.prepare("select settings from plugins where id = 'demo'").get() as { settings: string };
    expect(raw.settings).not.toContain("s3cret-value");

    expect((await alice.get("/api/plugins/demo/hello/monde")).json()).toEqual({ hello: "monde", user: "Alice", token: "s3cret-value", mode: "b" });
    expect((await new Client(app).get("/api/plugins/demo/hello/x")).statusCode).toBe(401);
    expect((await new Client(app).get("/api/plugins/demo/open")).json()).toEqual({ open: true });
    const fail = await alice.post("/api/plugins/demo/fail");
    expect([fail.statusCode, fail.json().message]).toEqual([418, "Je suis une théière."]);
    expect((await boris.patch("/api/admin/plugins/demo", { values: { mode: "zzz" } })).statusCode).toBe(400);
    expect((await boris.patch("/api/admin/plugins/demo", { values: { nope: 1 } })).statusCode).toBe(400);

    // Formula function from the plugin
    const ws = await boris.personalWorkspace();
    const d = (await boris.post("/api/databases", { workspaceId: ws, parentId: null, title: "F" })).json().database;
    const ht = (await boris.post(`/api/databases/${d.id}/properties`, { name: "HT", type: "number", config: {} })).json().property;
    const f = await boris.post(`/api/databases/${d.id}/properties`, { name: "TTC", type: "formula", config: { expression: 'ttc(prop("HT"))' } });
    expect(f.statusCode, f.body).toBe(200);
    await boris.post(`/api/databases/${d.id}/rows`, { values: { [ht.id]: 100 } });
    const row = () => boris.get(`/api/databases/${d.id}`).then((r) => r.json().database.rows[0].values[f.json().property.id]);
    expect(await row()).toEqual({ kind: "number", value: 120 });
    expect((await boris.get("/api/plugins")).json().plugins.find((p: { id: string }) => p.id === "demo").formulaFunctions).toEqual([
      { name: "ttc", min: 1, max: 1, help: "ttc(x) : x × 1,2" },
    ]);

    // Scheduled task
    await new Promise((r) => setTimeout(r, 1300));
    expect((await alice.get("/api/plugins/demo/ticks")).json().ticks).toBeGreaterThanOrEqual(1);

    // Turned off: routes gone, formulas show an error instead of failing the page.
    await boris.patch("/api/admin/plugins/demo", { enabled: false });
    expect((await alice.get("/api/plugins/demo/hello/x")).statusCode).toBe(404);
    expect(await row()).toMatchObject({ kind: "error" });
    // Password survives a restart of the plugin.
    await boris.patch("/api/admin/plugins/demo", { enabled: true });
    expect((await alice.get("/api/plugins/demo/hello/x")).json().token).toBe("s3cret-value");
    expect(fs.existsSync(path.join(dataDir, "plugin-data", "demo"))).toBe(true);
  });

  it("embed: link preview, local network refused unless allowed", async () => {
    const server = http.createServer((req, res) => {
      if (req.url === "/go") return res.writeHead(302, { location: "/page" }).end();
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<html><head><title>Titre &amp; co</title>
        <meta property="og:description" content="Une &quot;belle&quot; page">
        <meta content="/img.png" property="og:image"><meta property="og:site_name" content="Exemple"></head></html>`);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/go`;
    try {
      const refused = (await alice.get(`/api/plugins/embed/preview?url=${encodeURIComponent(url)}`)).json();
      expect(refused).toMatchObject({ title: "127.0.0.1", description: "", image: null });
      expect((await alice.get("/api/plugins/embed/preview?url=ftp://x")).statusCode).toBe(400);

      await boris.patch("/api/admin/plugins/embed", { values: { allowPrivateNetworks: true } });
      const ok = (await alice.get(`/api/plugins/embed/preview?url=${encodeURIComponent(url)}`)).json();
      expect(ok).toEqual({
        url: url.replace("/go", "/page"),
        title: "Titre & co",
        description: 'Une "belle" page',
        image: url.replace("/go", "/img.png"),
        site: "Exemple",
      });
    } finally {
      server.close();
    }
  });
});
