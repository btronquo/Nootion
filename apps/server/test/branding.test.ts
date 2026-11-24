import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { setAppName, tIn } from "@nootion/shared";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";
import { logoExtension } from "../src/branding.js";

let app: FastifyInstance;
let boris: Client;
let alice: Client;
let webDir: string;
let mails: { subject: string; text: string; html: string }[];

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const SVG = Buffer.from(
  '<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
);
const SMTP = {
  provider: "smtp",
  from: "Acme <acme@example.com>",
  smtp: { host: "smtp.example.com", port: 587, security: "starttls", user: "acme", password: "s3cret" },
};

const upload = (c: Client, data: Buffer, filename = "logo.png") => {
  const boundary = "----nootion";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return c.request("POST", "/api/admin/branding/logo", body, { "content-type": `multipart/form-data; boundary=${boundary}` });
};

beforeEach(async () => {
  mails = [];
  webDir = fs.mkdtempSync(path.join(os.tmpdir(), "nootion-web-"));
  fs.writeFileSync(
    path.join(webDir, "index.html"),
    `<!doctype html><html><head><link rel="icon" type="image/svg+xml" href="/favicon.svg" /><link rel="apple-touch-icon" href="/apple-touch-icon.png" /><meta name="apple-mobile-web-app-title" content="Nootion" /><title>Nootion</title></head><body></body></html>`,
  );
  fs.writeFileSync(
    path.join(webDir, "manifest.webmanifest"),
    JSON.stringify({
      name: "Nootion",
      short_name: "Nootion",
      icons: [{ src: "/icon-192.png" }],
      shortcuts: [{ name: "Capture", icons: [{ src: "/icon-192.png" }] }],
    }),
  );
  fs.writeFileSync(path.join(webDir, "favicon.svg"), SVG);
  app = await makeApp(undefined, { WEB_DIR: webDir }, { mailSender: async (m) => void mails.push(m) });
  boris = await setupAdmin(app);
  alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
});

afterEach(() => setAppName(null));

describe("branding", () => {
  it("is Nootion until administrators change it", async () => {
    expect((await new Client(app).get("/api/branding")).json().branding).toEqual({ name: "Nootion", customName: false, logoUrl: null });
    const page = await new Client(app).get("/login");
    expect(page.body).toContain("<title>Nootion</title>");
    expect(page.body).toContain('href="/favicon.svg"');
    expect((await new Client(app).get("/favicon.svg")).statusCode).toBe(200);
    expect((await new Client(app).get("/api/branding/logo")).statusCode).toBe(404);
  });

  it("gives the app a custom name, in the page, the manifest and the texts", async () => {
    expect((await alice.put("/api/admin/settings", { appName: "Acme" })).statusCode).toBe(403);
    expect((await boris.put("/api/admin/settings", { appName: "x".repeat(41) })).statusCode).toBe(400);
    const res = await boris.put("/api/admin/settings", { appName: "  Acme <Wiki>  " });
    expect(res.json().settings.appName).toBe("Acme <Wiki>");
    expect((await new Client(app).get("/api/branding")).json().branding).toEqual({ name: "Acme <Wiki>", customName: true, logoUrl: null });

    for (const url of ["/", "/index.html", "/page/abc"]) {
      const page = await new Client(app).get(url);
      expect(page.statusCode, url).toBe(200);
      expect(page.headers["content-type"]).toContain("text/html");
      expect(page.body).toContain("<title>Acme &lt;Wiki&gt;</title>");
      expect(page.body).toContain('content="Acme &lt;Wiki&gt;"');
      expect(page.body).toContain('<meta name="nootion-branding"');
    }
    const manifest = (await new Client(app).get("/manifest.webmanifest")).json();
    expect(manifest).toMatchObject({ name: "Acme <Wiki>", short_name: "Acme <Wiki>", icons: [{ src: "/icon-192.png" }] });

    // Texts say the new name, except those about the software itself; values put in them are left alone.
    expect(tIn("fr", "setup.title")).toBe("Bienvenue sur Acme <Wiki>");
    expect(tIn("fr", "update.available", { version: "9.0.0" })).toBe("Nootion 9.0.0 est disponible");
    expect(tIn("fr", "mail.inviteSubject", { name: "Nootion" })).toBe("Nootion vous invite sur Acme <Wiki>");

    // Back to empty: Nootion again.
    await boris.put("/api/admin/settings", { appName: "" });
    expect(tIn("fr", "setup.title")).toBe("Bienvenue sur Nootion");
    expect((await new Client(app).get("/")).body).toContain("<title>Nootion</title>");
  });

  it("takes a logo, shown to everyone, signed in or not, and in the page's icons", async () => {
    expect((await upload(alice, PNG)).statusCode).toBe(403);
    expect((await upload(boris, Buffer.from("not an image"))).statusCode).toBe(400);
    expect((await upload(boris, Buffer.alloc(1024 * 1024 + 1, 0x89))).statusCode).toBe(413);

    const res = await upload(boris, PNG);
    expect(res.statusCode, res.body).toBe(200);
    const url: string = res.json().branding.logoUrl;
    expect(url).toMatch(/^\/api\/branding\/logo\?v=[a-f0-9]+$/);
    const logo = await new Client(app).get(url);
    expect(logo.headers["content-type"]).toBe("image/png");
    expect(logo.headers["cache-control"]).toContain("immutable");
    expect(logo.rawPayload.equals(PNG)).toBe(true);

    const page = (await new Client(app).get("/login")).body;
    expect(page).toContain(`<link rel="icon" type="image/png" href="${url}" />`);
    expect(page).toContain(`<link rel="apple-touch-icon" href="${url}"`);
    const manifest = (await new Client(app).get("/manifest.webmanifest")).json();
    expect(manifest.icons).toEqual([{ src: url, sizes: "any", type: "image/png" }]);
    expect(manifest.shortcuts[0].icons).toEqual([{ src: url, sizes: "any", type: "image/png" }]);

    // A new logo replaces the file of the old one.
    const svg = await upload(boris, SVG, "logo.svg");
    const svgUrl: string = svg.json().branding.logoUrl;
    expect(svgUrl).not.toBe(url);
    const served = await new Client(app).get(svgUrl);
    expect(served.headers["content-type"]).toBe("image/svg+xml");
    expect(served.headers["content-security-policy"]).toContain("sandbox");
    expect(fs.readdirSync(path.join(app.config.dataDir, "branding"))).toHaveLength(1);

    // Settings saved from another form keep the logo.
    await boris.put("/api/admin/settings", { appName: "Acme", logo: null });
    expect((await new Client(app).get("/api/branding")).json().branding.logoUrl).toBe(svgUrl);

    const removed = await boris.delete("/api/admin/branding/logo");
    expect(removed.json().branding.logoUrl).toBeNull();
    expect(fs.readdirSync(path.join(app.config.dataDir, "branding"))).toHaveLength(0);
    expect((await new Client(app).get("/login")).body).toContain('href="/favicon.svg"');

    const changes = (await boris.get("/api/admin/audit")).json().events.filter((e: { action: string }) => e.action === "settings.changed");
    expect(changes.length).toBeGreaterThanOrEqual(3);
  });

  it("puts the name and the logo at the top of e-mails", async () => {
    await boris.put("/api/admin/mail", SMTP);
    await boris.put("/api/admin/settings", { appName: "Acme" });
    const url: string = (await upload(boris, PNG)).json().branding.logoUrl;
    await boris.post("/api/admin/mail/test", {});
    expect(mails[0]!.subject).toBe("Acme : e-mail de test");
    expect(mails[0]!.html).toContain(`<img src="http://localhost:3000${url}"`);
    expect(mails[0]!.html).toContain(">Acme</span>");
    // SVG logos are left out: many mail apps don't show them.
    await upload(boris, SVG, "logo.svg");
    await boris.post("/api/admin/mail/test", {});
    expect(mails[1]!.html).not.toContain("<img");
  });

  it("tells logo formats from their content", () => {
    expect(logoExtension(PNG)).toBe(".png");
    expect(logoExtension(SVG)).toBe(".svg");
    expect(logoExtension(Buffer.from("﻿<svg>"))).toBe(".svg");
    expect(logoExtension(Buffer.from("<html><svg></svg></html>"))).toBeNull();
    expect(logoExtension(Buffer.from("<svgx>"))).toBeNull();
  });
});
