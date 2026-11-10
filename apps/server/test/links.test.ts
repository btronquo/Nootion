import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { linkHref } from "@nootion/shared";
import { Client, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let boris: Client;

beforeEach(async () => {
  app = await makeApp();
  boris = await setupAdmin(app);
});
afterEach(async () => {
  await app.close();
});

describe("link cells", () => {
  it("only lead to web, mail and phone addresses", () => {
    expect(linkHref("https://example.com/a")).toBe("https://example.com/a");
    expect(linkHref("example.com")).toBe("https://example.com");
    expect(linkHref("nas.local:8080/x")).toBe("https://nas.local:8080/x");
    expect(linkHref("mailto:a@example.com")).toBe("mailto:a@example.com");
    expect(linkHref("tel:+33123456789")).toBe("tel:+33123456789");
    for (const bad of ["javascript:alert(1)", " JavaScript:alert(1)", "java\tscript:alert(1)", "data:text/html,<script>", "vbscript:x", "file:///etc/passwd", "ftp://x"]) {
      expect(linkHref(bad), bad).toBeNull();
    }
  });

  it("refuse addresses that run code", async () => {
    const ws = await boris.personalWorkspace();
    const database = (await boris.post("/api/databases", { workspaceId: ws, parentId: null, title: "Liens" })).json().database;
    const link = (await boris.post(`/api/databases/${database.id}/properties`, { name: "Lien", type: "url", config: {} })).json().property;
    const add = (value: string) => boris.post(`/api/databases/${database.id}/rows`, { values: { [link.id]: value } });
    expect((await add("javascript:alert(document.cookie)")).statusCode).toBe(400);
    expect((await add("  JAVASCRIPT:alert(1)")).statusCode).toBe(400);
    expect((await add("data:text/html,x")).statusCode).toBe(400);
    expect((await add("example.com")).statusCode).toBe(200);
    expect((await add("https://example.com")).statusCode).toBe(200);
  });
});
