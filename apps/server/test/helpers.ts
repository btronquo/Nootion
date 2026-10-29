import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db/index.js";

export async function makeApp(prepare?: (dataDir: string) => void): Promise<FastifyInstance> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nootion-test-"));
  prepare?.(dataDir);
  const config = loadConfig({ APP_SECRET: "test-secret-0123456789", APP_URL: "http://localhost:3000", DATA_DIR: dataDir });
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
  put(url: string, body: unknown) {
    return this.request("PUT", url, body);
  }
  delete(url: string) {
    return this.request("DELETE", url);
  }
  async id(): Promise<string> {
    return (await this.get("/api/auth/me")).json().user.id;
  }
  async personalWorkspace(): Promise<string> {
    return (await this.get("/api/workspaces")).json().workspaces.find((w: { kind: string }) => w.kind === "personal").id;
  }
  async createPage(workspaceId: string, title: string, parentId: string | null = null): Promise<string> {
    const res = await this.post("/api/pages", { workspaceId, title, parentId });
    if (res.statusCode !== 200) throw new Error(res.body);
    return res.json().page.id;
  }
}

// Most tests check French texts; i18n.test.ts covers English.
export const ADMIN = { name: "Boris", email: "boris@example.com", password: "motdepasse-admin", locale: "fr" };

export async function setupAdmin(app: FastifyInstance): Promise<Client> {
  const c = new Client(app);
  const res = await c.post("/api/setup", ADMIN);
  if (res.statusCode !== 200) throw new Error(res.body);
  return c;
}

export async function inviteUser(app: FastifyInstance, admin: Client, user: { name: string; email: string; password: string; locale?: string }) {
  const inv = await admin.post("/api/admin/invitations", { role: "member" });
  const token = inv.json().url.split("/invite/")[1];
  const c = new Client(app);
  const res = await c.post(`/api/invitations/${token}/accept`, { locale: "fr", ...user });
  if (res.statusCode !== 200) throw new Error(res.body);
  return c;
}
