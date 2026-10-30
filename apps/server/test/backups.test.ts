import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let boris: Client;

beforeEach(async () => {
  app = await makeApp();
  boris = await setupAdmin(app);
});

const schedule = (destination: unknown, extra: Record<string, unknown> = {}) =>
  boris.put("/api/admin/backups/schedule", { frequency: "daily", time: "03:00", timeZone: "Europe/Paris", destination, keep: 2, ...extra });

/** A WebDAV folder in memory: MKCOL, PUT, PROPFIND (depth 1) and DELETE, behind one user and password. */
async function fakeDav() {
  const files = new Map<string, Buffer>();
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== `Basic ${Buffer.from("boris:app-pass").toString("base64")}`) return res.writeHead(401).end();
    const name = decodeURIComponent((req.url ?? "").replace(/^\/dav\/Nootion\/?/, ""));
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (req.method === "MKCOL") return res.writeHead(405).end();
      if (req.method === "PUT") return (files.set(name, Buffer.concat(chunks)), res.writeHead(201).end());
      if (req.method === "DELETE") return (files.delete(name), res.writeHead(204).end());
      if (req.method === "PROPFIND") {
        const hrefs = ["/dav/Nootion/", ...[...files.keys(), "notes.txt"].map((n) => `/dav/Nootion/${encodeURIComponent(n)}`)];
        return res
          .writeHead(207)
          .end(`<d:multistatus xmlns:d="DAV:">${hrefs.map((h) => `<d:response><d:href>${h}</d:href></d:response>`).join("")}</d:multistatus>`);
      }
      res.writeHead(400).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/dav/Nootion`, files, close: () => server.close() };
}

let dir: string;
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("automatic backups", () => {
  it("puts copies in a folder at the scheduled time, keeping the last ones", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nootion-backups-"));
    fs.writeFileSync(path.join(dir, "other.txt"), "not ours");
    const res = await schedule({ type: "folder", path: dir });
    expect(res.statusCode).toBe(200);
    const s = res.json().schedule;
    expect(s).toMatchObject({ enabled: true, keep: 2, lastRunAt: null });
    const due = new Date(s.nextRunAt);
    expect(due.toLocaleTimeString("en-GB", { timeZone: "Europe/Paris" })).toBe("03:00:00");

    await app.backups.tick(new Date(due.getTime() - 60_000));
    expect(fs.readdirSync(dir)).toEqual(["other.txt"]);
    for (let i = 0; i < 3; i++) await app.backups.tick(new Date(due.getTime() + i * 86_400_000 + 60_000));
    const after = (await boris.get("/api/admin/backups/schedule")).json().schedule;
    expect(after.lastError).toBeNull();
    expect(after.lastSize).toBeGreaterThan(100);
    const copies = fs.readdirSync(dir).filter((n) => n.endsWith(".zip"));
    expect(copies).toHaveLength(2);
    expect(copies[1]).toBe(after.lastName);
    expect(fs.existsSync(path.join(dir, "other.txt"))).toBe(true);
    expect(fs.readFileSync(path.join(dir, copies[0]!)).subarray(0, 2).toString()).toBe("PK");
  });

  it("sends copies to WebDAV, keeps the password secret, and says what went wrong", async () => {
    dir = "";
    const dav = await fakeDav();
    try {
      expect((await schedule({ type: "webdav", url: dav.url, username: "boris" })).statusCode).toBe(400);
      expect((await schedule({ type: "webdav", url: dav.url, username: "boris", password: "app-pass" })).statusCode).toBe(200);
      const got = (await boris.get("/api/admin/backups/schedule")).json().schedule;
      expect(got.destination).toEqual({ type: "webdav", url: dav.url, username: "boris", hasPassword: true });
      expect(JSON.stringify(got)).not.toContain("app-pass");

      // Old copies beyond "keep" go; other files stay.
      dav.files.set("nootion-backup-2020-01-01-0300.zip", Buffer.from("old"));
      dav.files.set("nootion-backup-2020-01-02-0300.zip", Buffer.from("old"));
      const run = (await boris.post("/api/admin/backups/run")).json().schedule;
      expect(run.lastError).toBeNull();
      expect([...dav.files.keys()].sort()).toEqual(["nootion-backup-2020-01-02-0300.zip", run.lastName]);
      expect(dav.files.get(run.lastName)!.subarray(0, 2).toString()).toBe("PK");

      // Saving without the password keeps it; a wrong one is reported.
      expect((await schedule({ type: "webdav", url: dav.url, username: "boris" }, { keep: 5 })).statusCode).toBe(200);
      expect((await boris.post("/api/admin/backups/run")).json().schedule.lastError).toBeNull();
      await schedule({ type: "webdav", url: dav.url, username: "boris", password: "wrong" });
      expect((await boris.post("/api/admin/backups/run")).json().schedule.lastError).toMatch(/401/);
    } finally {
      dav.close();
    }
  });

  it("is for administrators only", async () => {
    dir = "";
    const alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
    expect((await alice.get("/api/admin/backups/schedule")).statusCode).toBe(403);
    expect((await boris.get("/api/admin/backups/schedule")).json().schedule).toBeNull();
  });
});
