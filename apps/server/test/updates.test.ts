import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";
import { currentVersion, isNewer, parseVersion } from "../src/updates.js";

let release: Record<string, unknown>;
let server: http.Server;
let url: string;
let app: FastifyInstance;
let boris: Client;

beforeEach(async () => {
  process.env.NOOTION_VERSION = "3.1.0";
  release = {
    tag_name: "v3.2.0",
    html_url: "https://github.com/btronquo/Nootion/releases/tag/v3.2.0",
    published_at: "2026-11-20T10:00:00Z",
  };
  server = http.createServer(
    (_req, res) => (
      res.writeHead(200, { "content-type": "application/json" }),
      res.end(JSON.stringify(release))
    ),
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/releases/latest`;
  app = await makeApp(undefined, {
    UPDATE_CHECK: "true",
    UPDATE_CHECK_URL: url,
  });
  boris = await setupAdmin(app);
});
afterEach(async () => {
  delete process.env.NOOTION_VERSION;
  await app.close();
  await new Promise((r) => server.close(r));
});

describe("versions", () => {
  it("compares versions", () => {
    expect(parseVersion("v3.10.2")).toEqual([3, 10, 2]);
    expect(parseVersion("develop")).toBeNull();
    expect(isNewer("3.10.0", "3.9.9")).toBe(true);
    expect(isNewer("3.1.0", "3.1.0-dev")).toBe(false);
    expect(isNewer("v3.1.1", "3.1.0")).toBe(true);
    expect(currentVersion()).toBe("3.1.0");
    process.env.NOOTION_VERSION = "develop";
    expect(currentVersion()).toMatch(/^\d+\.\d+\.\d+-dev$/);
  });
});

describe("update check", () => {
  it("tells administrators about a newer release, until they dismiss it", async () => {
    const alice = await inviteUser(app, boris, {
      name: "Alice",
      email: "alice@example.com",
      password: "alice-password",
    });
    expect((await alice.get("/api/admin/update")).statusCode).toBe(403);
    expect(
      (await app.inject({ method: "GET", url: "/api/health" })).json().version,
    ).toBe("3.1.0");

    let s = (await boris.post("/api/admin/update/check")).json();
    expect(s).toMatchObject({
      current: "3.1.0",
      checking: true,
      available: true,
      dismissed: false,
      latest: { version: "3.2.0" },
    });
    expect(s.checkedAt).toBeTruthy();

    s = (
      await boris.post("/api/admin/update/dismiss", { version: "3.2.0" })
    ).json();
    expect(s).toMatchObject({ available: true, dismissed: true });
    expect((await boris.get("/api/admin/update")).json().dismissed).toBe(true);

    // A newer one shows again.
    release = { ...release, tag_name: "v3.3.0" };
    s = (await boris.post("/api/admin/update/check")).json();
    expect(s).toMatchObject({
      available: true,
      dismissed: false,
      latest: { version: "3.3.0" },
    });

    // Pre-releases are skipped; the same version is up to date.
    release = { tag_name: "v4.0.0-rc.1", prerelease: true };
    expect(
      (await boris.post("/api/admin/update/check")).json().latest.version,
    ).toBe("3.3.0");
    process.env.NOOTION_VERSION = "3.3.0";
    expect((await boris.get("/api/admin/update")).json()).toMatchObject({
      available: false,
      dismissed: false,
    });
  });

  it("can be turned off", async () => {
    const off = await makeApp();
    const admin = await setupAdmin(off);
    expect((await admin.post("/api/admin/update/check")).json()).toMatchObject({
      checking: false,
      latest: null,
      available: false,
    });
    await off.close();
  });
});
