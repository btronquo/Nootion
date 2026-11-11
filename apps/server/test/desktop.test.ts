import { describe, expect, it } from "vitest";
import { ADMIN, Client, makeApp, setupAdmin } from "./helpers.js";

const TOKEN = "desktop-token-0123456789-0123456789";

async function ticket(app: Awaited<ReturnType<typeof makeApp>>, token = TOKEN) {
  return app.inject({ method: "POST", url: "/api/desktop/ticket", headers: { "x-nootion-desktop-token": token } });
}

describe("desktop local mode", () => {
  it("doesn't exist on a normal server", async () => {
    const app = await makeApp();
    expect((await ticket(app)).statusCode).toBe(404);
    expect((await new Client(app).get("/api/desktop/session?ticket=x")).statusCode).toBe(404);
  });

  it("refuses a wrong token and an unknown ticket", async () => {
    const app = await makeApp(undefined, { NOOTION_DESKTOP_TOKEN: TOKEN });
    expect((await ticket(app, "wrong")).statusCode).toBe(404);
    expect((await ticket(app, TOKEN.slice(0, -1) + "X")).statusCode).toBe(404);
    expect((await new Client(app).get("/api/desktop/session?ticket=nope")).statusCode).toBe(404);
  });

  it("creates the account on the first launch, then signs in to it, each ticket once", async () => {
    const app = await makeApp(undefined, { NOOTION_DESKTOP_TOKEN: TOKEN, NOOTION_DESKTOP_USER: "Boris" });
    const t1 = (await ticket(app)).json().ticket as string;
    const c = new Client(app);
    const res = await c.get(`/api/desktop/session?ticket=${t1}`);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/");
    const me = (await c.get("/api/auth/me")).json().user;
    expect(me).toMatchObject({ name: "Boris", role: "admin" });
    expect((await c.get("/api/setup")).json().needsSetup).toBe(false);

    // The same ticket can't be used twice.
    expect((await new Client(app).get(`/api/desktop/session?ticket=${t1}`)).statusCode).toBe(404);

    // Next launch: same account, no new one.
    const t2 = (await ticket(app)).json().ticket as string;
    const other = new Client(app);
    await other.get(`/api/desktop/session?ticket=${t2}`);
    expect((await other.get("/api/auth/me")).json().user.id).toBe(me.id);
  });

  it("signs in to the existing administrator", async () => {
    const app = await makeApp(undefined, { NOOTION_DESKTOP_TOKEN: TOKEN });
    await setupAdmin(app);
    const c = new Client(app);
    await c.get(`/api/desktop/session?ticket=${(await ticket(app)).json().ticket}`);
    expect((await c.get("/api/auth/me")).json().user.email).toBe(ADMIN.email);
  });

  it("needs a long token", async () => {
    await expect(makeApp(undefined, { NOOTION_DESKTOP_TOKEN: "short" })).rejects.toThrow("at least 32");
  });
});
