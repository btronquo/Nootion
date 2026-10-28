import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db/index.js";

export async function makeApp(): Promise<FastifyInstance> {
  const config = loadConfig({ APP_SECRET: "test-secret-0123456789", APP_URL: "http://localhost:3000" });
  return buildApp({ db: openDb(":memory:"), config });
}

/** A tiny cookie-keeping client around app.inject. */
export class Client {
  cookie = "";
  constructor(private app: FastifyInstance) {}

  async request(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<LightMyRequestResponse> {
    const res = await this.app.inject({
      method: method as "GET",
      url,
      payload: body as object,
      headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
    });
    const set = res.cookies.find((c) => c.name === "nootion_session");
    if (set) this.cookie = set.value ? `nootion_session=${set.value}` : "";
    return res;
  }
  get(url: string) {
    return this.request("GET", url);
  }
  post(url: string, body: unknown = {}, headers?: Record<string, string>) {
    return this.request("POST", url, body, headers);
  }
  patch(url: string, body: unknown) {
    return this.request("PATCH", url, body);
  }
}

export const ADMIN = { name: "Boris", email: "boris@example.com", password: "motdepasse-admin" };

export async function setupAdmin(app: FastifyInstance): Promise<Client> {
  const c = new Client(app);
  const res = await c.post("/api/setup", ADMIN);
  if (res.statusCode !== 200) throw new Error(res.body);
  return c;
}

export async function inviteUser(app: FastifyInstance, admin: Client, user: { name: string; email: string; password: string }) {
  const inv = await admin.post("/api/admin/invitations", { role: "member" });
  const token = inv.json().url.split("/invite/")[1];
  const c = new Client(app);
  const res = await c.post(`/api/invitations/${token}/accept`, user);
  if (res.statusCode !== 200) throw new Error(res.body);
  return c;
}
