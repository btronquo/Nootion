import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { users } from "../src/db/schema.js";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";
import { changelog, parseChangelog, releasesSince } from "../src/whats-new.js";

const CHANGELOG = `# Changelog

## [Unreleased]

- Not out yet.

## [3.3.0] - 2026-11-03

### Added

- Block menu.

## [3.2.1] - 2026-11-03

### Fixed

- Dark drop-downs.

## [3.2.0] - 2026-11-01

- SSO.
`;

describe("changelog", () => {
  it("reads the releases, newest first, without Unreleased", () => {
    const all = parseChangelog(CHANGELOG);
    expect(all.map((r) => r.version)).toEqual(["3.3.0", "3.2.1", "3.2.0"]);
    expect(all[0]).toEqual({ version: "3.3.0", date: "2026-11-03", markdown: "### Added\n\n- Block menu." });
  });

  it("picks the releases since the last one seen", () => {
    const all = parseChangelog(CHANGELOG);
    const versions = (seen: string | null, current: string) => releasesSince(all, seen, current).map((r) => r.version);
    expect(versions("3.2.0", "3.3.0")).toEqual(["3.3.0", "3.2.1"]);
    expect(versions("3.3.0", "3.3.0")).toEqual([]);
    expect(versions(null, "3.3.0")).toEqual(["3.3.0"]);
    expect(versions("3.2.0", "3.2.1")).toEqual(["3.2.1"]);
  });

  it("finds the repository's CHANGELOG.md", () => {
    expect(changelog().length).toBeGreaterThan(5);
    expect(changelog().some((r) => r.version === "3.3.0")).toBe(true);
  });
});

describe("what's new", () => {
  let app: FastifyInstance;
  let boris: Client;
  beforeEach(async () => {
    process.env.NOOTION_VERSION = "3.3.0";
    app = await makeApp();
    boris = await setupAdmin(app);
  });
  afterEach(async () => {
    delete process.env.NOOTION_VERSION;
    await app.close();
  });

  it("shows nothing to a new account, then the releases it missed, once", async () => {
    expect((await boris.get("/api/whats-new")).json()).toEqual({ version: "3.3.0", releases: [] });

    // Updated from 3.2.0 to 3.3.0.
    app.db.update(users).set({ seenVersion: "3.2.0" }).run();
    const res = (await boris.get("/api/whats-new")).json();
    expect(res.releases.map((r: { version: string }) => r.version)).toEqual(["3.3.0", "3.2.1"]);
    expect(res.releases[0].markdown).toContain("###");

    // Shown until closed.
    expect((await boris.get("/api/whats-new")).json().releases).toHaveLength(2);
    expect((await boris.post("/api/whats-new/seen")).statusCode).toBe(200);
    expect((await boris.get("/api/whats-new")).json().releases).toEqual([]);
  });

  it("shows the current release once to accounts from before", async () => {
    const alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
    app.db.update(users).set({ seenVersion: null }).run();
    const res = (await alice.get("/api/whats-new")).json();
    expect(res.releases.map((r: { version: string }) => r.version)).toEqual(["3.3.0"]);
    await alice.post("/api/whats-new/seen");
    expect((await alice.get("/api/whats-new")).json().releases).toEqual([]);
    // Each account has its own.
    expect((await boris.get("/api/whats-new")).json().releases).toHaveLength(1);
  });

  it("stays quiet in development and for visitors", async () => {
    process.env.NOOTION_VERSION = "develop";
    app.db.update(users).set({ seenVersion: "3.0.0" }).run();
    expect((await boris.get("/api/whats-new")).json().releases).toEqual([]);
    expect((await app.inject({ method: "GET", url: "/api/whats-new" })).statusCode).toBe(401);
  });
});
