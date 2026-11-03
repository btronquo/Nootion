import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let boris: Client;
let alice: Client;

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const upload = (c: Client, data: Buffer, filename = "fusee.png") => {
  const boundary = "----nootion";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return c.request("POST", "/api/icons", body, { "content-type": `multipart/form-data; boundary=${boundary}` });
};

beforeEach(async () => {
  app = await makeApp();
  boris = await setupAdmin(app);
  alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
});

describe("custom icons", () => {
  it("are uploaded, listed for everyone, used on pages and deleted by who uploaded them", async () => {
    const res = await upload(alice, PNG);
    expect(res.statusCode, res.body).toBe(200);
    const icon = res.json().icon;
    expect(icon).toMatchObject({ name: "fusee", url: `/api/icons/${icon.id}/image`, canDelete: true });

    const listed = (await boris.get("/api/icons")).json().icons;
    expect(listed).toEqual([{ ...icon, canDelete: true }]);
    expect((await new Client(app).get(icon.url)).headers["content-type"]).toBe("image/png");

    const ws = await boris.personalWorkspace();
    const page = await boris.createPage(ws, "Lancement");
    expect((await boris.patch(`/api/pages/${page}`, { icon: `icon:${icon.id}` })).statusCode).toBe(200);
    expect((await boris.get(`/api/pages/${page}`)).json().page.icon).toBe(`icon:${icon.id}`);

    const eve = await inviteUser(app, boris, { name: "Eve", email: "eve@example.com", password: "eve-password" });
    expect((await eve.delete(`/api/icons/${icon.id}`)).statusCode).toBe(403);
    expect((await alice.delete(`/api/icons/${icon.id}`)).statusCode).toBe(200);
    expect((await boris.get(icon.url)).statusCode).toBe(404);
  });

  it("refuses what isn't an image", async () => {
    expect((await upload(alice, Buffer.from("<svg onload=alert(1)>"), "x.svg")).statusCode).toBe(400);
    expect((await upload(alice, Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]))).statusCode).toBe(413);
  });
});
