import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { eq } from "drizzle-orm";
import { Client, makeApp, setupAdmin } from "./helpers.js";
import { publicLinks } from "../src/db/schema.js";

let app: FastifyInstance;
let boris: Client;
let anon: Client;

beforeEach(async () => {
  app = await makeApp();
  boris = await setupAdmin(app);
  anon = new Client(app);
});

/** The unlock cookie a response sets, ready for a `cookie` header, with the path it is limited to. */
function unlockCookie(res: LightMyRequestResponse) {
  const c = res.cookies.find((x) => x.name === "nootion_unlock");
  return c ? { header: `nootion_unlock=${c.value}`, path: c.path, httpOnly: c.httpOnly } : null;
}

const withCookie = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });

async function publishedPage() {
  const ws = await boris.personalWorkspace();
  const page = await boris.createPage(ws, "Recette");
  const sub = await boris.createPage(ws, "Variante", page);
  const link = (await boris.put(`/api/pages/${page}/public-link`, { includeSubpages: true })).json().link;
  return { page, sub, link };
}

describe("public link with a password", () => {
  it("asks for the password everywhere until it is typed, then remembers it for this link only", async () => {
    const { page, sub, link } = await publishedPage();
    expect(link).toMatchObject({ hasPassword: false, expiresAt: null, expired: false });

    const set = await boris.put(`/api/pages/${page}/public-link`, { password: "sésame-1234" });
    expect(set.json().link).toMatchObject({ token: link.token, hasPassword: true, includeSubpages: true });
    expect(set.body).not.toContain("sésame");

    const locked = await anon.get(`/api/public/${link.token}`);
    expect(locked.statusCode).toBe(401);
    expect(locked.json().error).toBe("password_required");
    expect(locked.body).not.toContain("Recette");
    expect(locked.headers["cache-control"]).toBe("no-store");
    for (const url of [`/api/public/${link.token}/pages/${page}`, `/api/public/${link.token}/pages/${sub}`]) {
      expect((await anon.get(url)).statusCode).toBe(401);
    }

    const wrong = await anon.post(`/api/public/${link.token}/unlock`, { password: "pas-ça" });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().error).toBe("bad_password");
    expect(unlockCookie(wrong)).toBeNull();

    const right = await anon.post(`/api/public/${link.token}/unlock`, { password: "sésame-1234" });
    expect(right.statusCode).toBe(200);
    const cookie = unlockCookie(right)!;
    expect(cookie.path).toBe(`/api/public/${link.token}`);
    expect(cookie.httpOnly).toBe(true);

    const open = await withCookie(`/api/public/${link.token}`, cookie.header);
    expect(open.statusCode).toBe(200);
    expect(open.json().root.title).toBe("Recette");
    expect((await withCookie(`/api/public/${link.token}/pages/${sub}`, cookie.header)).statusCode).toBe(200);

    // The cookie of one link opens no other link.
    const ws = await boris.personalWorkspace();
    const other = await boris.createPage(ws, "Autre");
    const otherLink = (await boris.put(`/api/pages/${other}/public-link`, { password: "sésame-1234" })).json().link;
    expect((await withCookie(`/api/public/${otherLink.token}`, cookie.header)).statusCode).toBe(401);

    // A forged or tampered cookie opens nothing.
    const [until, sig] = cookie.header.split("=")[1]!.split(".");
    expect((await withCookie(`/api/public/${link.token}`, `nootion_unlock=${Number(until) + 1000}.${sig}`)).statusCode).toBe(401);
    expect((await withCookie(`/api/public/${link.token}`, "nootion_unlock=99999999999999.abc")).statusCode).toBe(401);
  });

  it("changing the password asks visitors again; removing it opens the link to all", async () => {
    const { page, link } = await publishedPage();
    await boris.put(`/api/pages/${page}/public-link`, { password: "premier-mot" });
    const cookie = unlockCookie(await anon.post(`/api/public/${link.token}/unlock`, { password: "premier-mot" }))!;
    expect((await withCookie(`/api/public/${link.token}`, cookie.header)).statusCode).toBe(200);

    await boris.put(`/api/pages/${page}/public-link`, { password: "second-mot" });
    expect((await withCookie(`/api/public/${link.token}`, cookie.header)).statusCode).toBe(401);
    // Changing something else keeps the password.
    expect((await boris.put(`/api/pages/${page}/public-link`, { includeSubpages: false })).json().link.hasPassword).toBe(true);

    await boris.put(`/api/pages/${page}/public-link`, { password: null });
    expect((await anon.get(`/api/public/${link.token}`)).statusCode).toBe(200);
  });

  it("files of a protected page need the password too", async () => {
    const { page, link } = await publishedPage();
    await boris.put(`/api/pages/${page}/public-link`, { password: "fichiers" });
    // Whether the file exists or not, nothing is said before the password.
    const res = await anon.get(`/api/public/${link.token}/attachments/00000000-0000-0000-0000-000000000000`);
    expect(res.statusCode).toBe(401);
  });

  it("limits password attempts per link", async () => {
    const { page, link } = await publishedPage();
    await boris.put(`/api/pages/${page}/public-link`, { password: "le-bon-mot" });
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await anon.post(`/api/public/${link.token}/unlock`, { password: `essai-${i}` })).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 403)).toBe(true);
    expect(codes[10]).toBe(429);
    // Even the right password waits.
    expect((await anon.post(`/api/public/${link.token}/unlock`, { password: "le-bon-mot" })).statusCode).toBe(429);
  });

  it("refuses passwords that are too short, and only people with full access change them", async () => {
    const { page } = await publishedPage();
    expect((await boris.put(`/api/pages/${page}/public-link`, { password: "abc" })).statusCode).toBe(400);
    expect((await anon.put(`/api/pages/${page}/public-link`, { password: "abcdef" })).statusCode).toBe(401);
  });
});

describe("public link with an end date", () => {
  it("stops working after the date, and works again once extended", async () => {
    const { page, sub, link } = await publishedPage();
    const soon = new Date(Date.now() + 60_000).toISOString();
    const set = (await boris.put(`/api/pages/${page}/public-link`, { expiresAt: soon })).json().link;
    expect(set).toMatchObject({ expiresAt: soon, expired: false });
    expect((await anon.get(`/api/public/${link.token}`)).statusCode).toBe(200);

    // The date passes.
    app.db
      .update(publicLinks)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(publicLinks.pageId, page))
      .run();
    const gone = await anon.get(`/api/public/${link.token}`);
    expect(gone.statusCode).toBe(410);
    expect(gone.json().error).toBe("link_expired");
    expect((await anon.get(`/api/public/${link.token}/pages/${sub}`)).statusCode).toBe(410);
    expect((await boris.get(`/api/pages/${page}/public-link`)).json().link.expired).toBe(true);

    // Extended: the same address works again.
    const later = new Date(Date.now() + 7 * 86_400_000).toISOString();
    expect((await boris.put(`/api/pages/${page}/public-link`, { expiresAt: later })).json().link).toMatchObject({ token: link.token, expired: false });
    expect((await anon.get(`/api/public/${link.token}`)).statusCode).toBe(200);

    await boris.put(`/api/pages/${page}/public-link`, { expiresAt: null });
    expect((await boris.get(`/api/pages/${page}/public-link`)).json().link.expiresAt).toBeNull();
  });

  it("an expired link asks for no password, and the password is not remembered past the end", async () => {
    const { page, link } = await publishedPage();
    const end = Date.now() + 5 * 60_000;
    await boris.put(`/api/pages/${page}/public-link`, { password: "jusqua-ce-soir", expiresAt: new Date(end).toISOString() });
    const res = await anon.post(`/api/public/${link.token}/unlock`, { password: "jusqua-ce-soir" });
    const until = Number(unlockCookie(res)!.header.split("=")[1]!.split(".")[0]);
    expect(until).toBeLessThanOrEqual(end);

    app.db
      .update(publicLinks)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(publicLinks.pageId, page))
      .run();
    expect((await anon.post(`/api/public/${link.token}/unlock`, { password: "jusqua-ce-soir" })).statusCode).toBe(410);
    expect((await anon.get(`/api/public/${link.token}`)).json().error).toBe("link_expired");
  });

  it("refuses a date that isn't one", async () => {
    const { page } = await publishedPage();
    expect((await boris.put(`/api/pages/${page}/public-link`, { expiresAt: "demain" })).statusCode).toBe(400);
  });
});
