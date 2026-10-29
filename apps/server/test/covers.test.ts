import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Client, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let boris: Client;

beforeEach(async () => {
  app = await makeApp();
  boris = await setupAdmin(app);
});

const upload = async (c: Client, pageId: string) => {
  const boundary = "----nootion";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="cover.png"\r\nContent-Type: image/png\r\n\r\n`),
    Buffer.from("89504e470d0a1a0a", "hex"),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await c.request("POST", `/api/pages/${pageId}/attachments`, body, { "content-type": `multipart/form-data; boundary=${boundary}` });
  return res.json().attachment as { id: string; url: string };
};
const page = async (id: string) => (await boris.get(`/api/pages/${id}`)).json().page;

describe("page covers", () => {
  it("sets a gradient, a link or an uploaded image, with its position", async () => {
    const ws = await boris.personalWorkspace();
    const id = await boris.createPage(ws, "Trip");
    expect(await page(id)).toMatchObject({ cover: null, coverPosition: 50 });

    expect((await boris.patch(`/api/pages/${id}`, { cover: "gradient:ocean" })).statusCode).toBe(200);
    expect((await page(id)).cover).toBe("gradient:ocean");
    expect((await boris.patch(`/api/pages/${id}`, { cover: "https://example.org/sea.jpg", coverPosition: 20 })).statusCode).toBe(200);
    expect(await page(id)).toMatchObject({ cover: "https://example.org/sea.jpg", coverPosition: 20 });

    const file = await upload(boris, id);
    expect((await boris.patch(`/api/pages/${id}`, { cover: file.url })).statusCode).toBe(200);
    expect((await page(id)).cover).toBe(file.url);
    expect((await boris.patch(`/api/pages/${id}`, { cover: null })).statusCode).toBe(200);
    expect((await page(id)).cover).toBeNull();

    for (const bad of [{ cover: "gradient:nope" }, { cover: "javascript:alert(1)" }, { cover: "/etc/passwd" }, { coverPosition: 101 }]) {
      expect((await boris.patch(`/api/pages/${id}`, bad)).statusCode).toBe(400);
    }
  });

  it("only takes a file of the same page, and shows it on public links", async () => {
    const ws = await boris.personalWorkspace();
    const a = await boris.createPage(ws, "A");
    const b = await boris.createPage(ws, "B");
    const fromB = await upload(boris, b);
    expect((await boris.patch(`/api/pages/${a}`, { cover: fromB.url })).statusCode).toBe(400);
    expect((await boris.patch(`/api/pages/${a}`, { cover: "/api/attachments/00000000-0000-0000-0000-000000000000" })).statusCode).toBe(400);

    const own = await upload(boris, a);
    await boris.patch(`/api/pages/${a}`, { cover: own.url, coverPosition: 30 });
    const link = (await boris.put(`/api/pages/${a}/public-link`, {})).json().link;
    const visitor = new Client(app);
    const pub = (await visitor.get(`/api/public/${link.token}/pages/${a}`)).json().page;
    expect(pub).toMatchObject({ cover: `/api/public/${link.token}/attachments/${own.id}`, coverPosition: 30 });
    expect((await visitor.get(pub.cover)).statusCode).toBe(200);
  });
});
