import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";
import { startFakeNextcloud, type FakeNextcloud } from "./nextcloud-fake.js";

let app: FastifyInstance;
let nc: FakeNextcloud;
let boris: Client;
let alice: Client;
let page: string;

beforeEach(async () => {
  nc = await startFakeNextcloud();
  app = await makeApp();
  boris = await setupAdmin(app);
  alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
  const team = (await boris.post("/api/workspaces", { name: "Maison" })).json().workspace.id;
  page = await boris.createPage(team, "Papiers");
});

afterEach(async () => {
  await app.close();
  await nc.close();
});

const enable = (values: Record<string, unknown>) => boris.patch("/api/admin/plugins/nextcloud", { enabled: true, values });

describe("nextcloud plugin", () => {
  it("is off until the admin turns it on, and asks for its address", async () => {
    expect((await boris.get("/api/plugins/nextcloud/status")).statusCode).toBe(404);
    expect((await enable({})).statusCode).toBe(200);
    expect((await boris.get("/api/plugins/nextcloud/status")).json()).toEqual({ configured: false, connected: false, account: null, url: null });
    const res = await boris.get("/api/plugins/nextcloud/files");
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/^L'administrateur n'a pas encore indiqué/);
  });

  it("connects each person's own account with Login Flow v2, then browses and searches their files", async () => {
    await enable({ url: `${nc.url}/`, browserUrl: "https://cloud.example.org" });
    expect((await boris.get("/api/plugins/nextcloud/files")).statusCode).toBe(409);

    // The login page is given at the address people use in their browser.
    const login = (await boris.post("/api/plugins/nextcloud/login")).json();
    expect(login.url).toBe("https://cloud.example.org/index.php/login/v2/flow/abc");
    expect((await boris.post("/api/plugins/nextcloud/login/poll")).json()).toEqual({ connected: false, account: null });
    nc.allowLogin();
    expect((await boris.post("/api/plugins/nextcloud/login/poll")).json()).toEqual({ connected: true, account: "Boris T." });
    expect((await boris.get("/api/plugins/nextcloud/status")).json()).toEqual({
      configured: true,
      connected: true,
      account: "Boris T.",
      url: "https://cloud.example.org",
    });

    // The app password is stored encrypted.
    const stored = app.db.$client.prepare("select value from plugin_user_data").all() as { value: string }[];
    expect(stored).toHaveLength(1);
    expect(stored[0]!.value).not.toContain("app-pw-flow");

    const root = (await boris.get("/api/plugins/nextcloud/files?path=/")).json();
    expect(root.entries.map((e: { name: string; folder: boolean }) => [e.name, e.folder])).toEqual([
      ["Factures", true],
      ["Photos", true],
      ["Notes.md", false],
    ]);
    const photos = (await boris.get(`/api/plugins/nextcloud/files?path=${encodeURIComponent("/Photos/../Photos")}`)).json();
    expect(photos.folder).toMatchObject({ path: "/Photos", url: "https://cloud.example.org/index.php/f/2" });
    expect(photos.entries).toEqual([
      {
        path: "/Photos/Chat gris.png",
        name: "Chat gris.png",
        folder: false,
        size: 29,
        mimeType: "image/png",
        modified: "2026-11-02T08:30:00.000Z",
        fileId: "3",
        preview: true,
        url: "https://cloud.example.org/index.php/f/3",
      },
    ]);
    // ".." can't leave the user's files.
    expect((await boris.get("/api/plugins/nextcloud/files?path=/../../etc")).statusCode).toBe(404);

    const found = (await boris.get(`/api/plugins/nextcloud/search?q=${encodeURIComponent("edf &")}`)).json();
    expect(found.entries.map((e: { path: string }) => e.path)).toEqual(["/Factures/EDF & co.pdf"]);

    const preview = await boris.get("/api/plugins/nextcloud/preview?fileId=3");
    expect(preview.headers["content-type"]).toBe("image/png");
    expect(preview.headers["content-security-policy"]).toContain("sandbox");

    // Alice hasn't connected an account: she doesn't see Boris's files.
    expect((await alice.get("/api/plugins/nextcloud/status")).json().connected).toBe(false);
    expect((await alice.get("/api/plugins/nextcloud/files")).statusCode).toBe(409);
  });

  it("copies picked files into a page, for people who can edit it", async () => {
    await enable({ url: nc.url });
    const bad = await boris.post("/api/plugins/nextcloud/login/password", { login: "boris@example.com", password: "nope" });
    expect(bad.statusCode).toBe(400);
    expect((await boris.post("/api/plugins/nextcloud/login/password", { login: "boris@example.com", password: "app-pw-manual" })).json().account).toBe(
      "Boris T.",
    );

    const res = await boris.post("/api/plugins/nextcloud/import", { pageId: page, paths: ["/Factures/EDF & co.pdf", "/Photos/Chat gris.png"] });
    expect(res.statusCode, res.body).toBe(200);
    const [pdf, png] = res.json().attachments;
    expect(pdf).toMatchObject({ filename: "EDF & co.pdf", mimeType: "application/pdf", size: 16 });
    expect(png).toMatchObject({ filename: "Chat gris.png", mimeType: "image/png" });
    expect((await boris.get(pdf.url)).body).toBe("%PDF-1.4 facture");

    // Alice connects her own account but can't add files to a page she can't edit.
    await alice.post("/api/plugins/nextcloud/login/password", { login: "boris@example.com", password: "app-pw-manual" });
    expect((await alice.post("/api/plugins/nextcloud/import", { pageId: page, paths: ["/Notes.md"] })).statusCode).toBe(404);
  });

  it("revokes the app password on disconnecting, and forgets accounts when the address changes", async () => {
    await enable({ url: nc.url });
    await boris.post("/api/plugins/nextcloud/login/password", { login: "boris@example.com", password: "app-pw-manual" });
    expect((await boris.request("DELETE", "/api/plugins/nextcloud/login")).json()).toEqual({ connected: false });
    expect(nc.passwords.has("app-pw-manual")).toBe(false);
    expect((await boris.get("/api/plugins/nextcloud/status")).json().connected).toBe(false);

    nc.passwords.add("app-pw-manual");
    await boris.post("/api/plugins/nextcloud/login/password", { login: "boris@example.com", password: "app-pw-manual" });
    await enable({ url: "https://other.example.org" });
    expect((await boris.get("/api/plugins/nextcloud/status")).json().connected).toBe(false);
  });
});
