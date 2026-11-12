/**
 * Desktop app, local mode: keeps spaces of this Nootion in sync with spaces of a Nootion server (see sync.ts).
 *
 * Linking goes through the server's OAuth (as for Claude's connectors): this Nootion registers itself as an app,
 * the user signs in on the server and picks the spaces, and gets back here with a code exchanged for a token
 * limited to those spaces. Each space is created here with the same id, then kept in sync every few seconds:
 * pull what changed on the server, push what changed here.
 */
import fs from "node:fs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Collab } from "./collab.js";
import type { Config } from "./config.js";
import type { Db } from "./db/index.js";
import { isLocale, t as translate } from "@nootion/shared";
import { syncChanges, syncLinks, users, workspaceMembers, workspaces } from "./db/schema.js";
import { withLocale } from "./i18n.js";
import { decryptSecret, encryptSecret, secretKey } from "./secrets.js";
import { attachmentPath } from "./attachments.js";
import { applyChanges, changesSince, currentSeq, renameUser, type SyncChange, type SyncUser } from "./sync.js";

/** How often linked spaces are synced, and how often changes made here are looked for. */
const INTERVAL_MS = 20_000;
const LOCAL_CHECK_MS = 4_000;
/** The peer id the server's own changes are recorded under here. */
const SERVER = "server";

export interface SyncLinkStatus {
  workspaceId: string;
  name: string;
  serverUrl: string;
  lastSyncAt: string | null;
  /** A SyncError code, or the message of an unexpected error. */
  lastError: string | null;
  /** Changes made here not yet sent. */
  pending: number;
  syncing: boolean;
}

interface PendingLink {
  serverUrl: string;
  clientId: string;
  verifier: string;
  userId: string;
  expiresAt: number;
}

interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export class SyncError extends Error {
  constructor(
    readonly code: "invalid_url" | "unreachable" | "not_nootion" | "link_expired" | "server_refused" | "no_space",
    message: string,
  ) {
    super(message);
  }
}

const b64url = (b: Buffer) => b.toString("base64url");

export function normalizeServerUrl(input: string): string {
  const s = input.trim();
  const url = new URL(s.includes("://") ? s : `https://${s}`);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new SyncError("invalid_url", "Use an http(s) address.");
  return url.origin;
}

export function createDesktopSync(opts: { db: Db; collab: Collab; config: Config; fetch?: typeof fetch }) {
  const { db, collab, config } = opts;
  const http = opts.fetch ?? fetch;
  const key = secretKey(config.appSecret, "desktop-sync");
  const pending = new Map<string, PendingLink>();
  const running = new Map<string, Promise<void>>();
  let timers: NodeJS.Timeout[] = [];
  const redirectUri = `${config.appUrl}/api/desktop/sync/callback`;

  const tokenOf = (link: typeof syncLinks.$inferSelect) => decryptSecret(key, link.accessToken) ?? "";

  async function call(url: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await http(url, { ...init, signal: AbortSignal.timeout(30_000) });
    } catch (err) {
      throw new SyncError("unreachable", (err as Error).message);
    }
  }

  /** Renews the access token of every space linked with this app registration. */
  async function refresh(link: typeof syncLinks.$inferSelect): Promise<typeof syncLinks.$inferSelect> {
    const res = await call(`${link.serverUrl}/api/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "refresh_token", refresh_token: decryptSecret(key, link.refreshToken), client_id: link.clientId }),
    });
    if (!res.ok) throw new SyncError("server_refused", `The server refused to renew access (${res.status}). Link the space again.`);
    const t = (await res.json()) as Tokens;
    const set = {
      accessToken: encryptSecret(key, t.access_token),
      refreshToken: encryptSecret(key, t.refresh_token),
      accessExpiresAt: new Date(Date.now() + t.expires_in * 1000),
    };
    db.update(syncLinks).set(set).where(eq(syncLinks.clientId, link.clientId)).run();
    return { ...link, ...set };
  }

  /** A request to the server with the space's token, renewed when needed. */
  async function request(
    link: typeof syncLinks.$inferSelect,
    path: string,
    init: RequestInit = {},
  ): Promise<{ link: typeof syncLinks.$inferSelect; res: Response }> {
    if (link.accessExpiresAt.getTime() < Date.now() + 60_000) link = await refresh(link);
    const type = typeof init.body === "string" ? "application/json" : "application/octet-stream";
    const send = (l: typeof syncLinks.$inferSelect) =>
      call(`${l.serverUrl}${path}`, {
        ...init,
        headers: { ...(init.headers ?? {}), authorization: `Bearer ${tokenOf(l)}`, ...(init.body ? { "content-type": type } : {}) },
      });
    let res = await send(link);
    if (res.status === 401) {
      link = await refresh(link);
      res = await send(link);
    }
    return { link, res };
  }

  async function api(
    link: typeof syncLinks.$inferSelect,
    path: string,
    init: RequestInit = {},
  ): Promise<{ link: typeof syncLinks.$inferSelect; body: unknown }> {
    const r = await request(link, path, init);
    if (!r.res.ok) throw new SyncError("server_refused", `The server answered ${r.res.status}: ${(await r.res.text()).slice(0, 200)}`);
    return { link: r.link, body: await r.res.json() };
  }

  /** One round for a space: pull, then push. */
  async function syncSpace(workspaceId: string): Promise<void> {
    let link = db.select().from(syncLinks).where(eq(syncLinks.workspaceId, workspaceId)).get();
    if (!link) return;
    try {
      for (;;) {
        const r = await api(link, `/api/sync/${workspaceId}/changes?since=${link.pulledSeq}&peer=${encodeURIComponent(link.peerId)}`);
        link = r.link;
        const body = r.body as { seq: number; more: boolean; changes: SyncChange[]; users?: SyncUser[] };
        // The account the space was linked with is this computer's account.
        const me = link.remoteUserId && link.userId ? [link.remoteUserId, link.userId] : null;
        const changes = me ? renameUser(body.changes, me[0], me[1]) : body.changes;
        await applyChanges(db, collab, workspaceId, SERVER, changes, {
          users: (body.users ?? []).filter((u) => u.id !== me?.[0]),
          dataDir: config.dataDir,
          followMoves: true,
          fetchFile: async (id) => {
            const f = await request(link!, `/api/attachments/${id}?download=1`);
            link = f.link;
            return f.res.ok ? Buffer.from(await f.res.arrayBuffer()) : null;
          },
        });
        db.update(syncLinks).set({ pulledSeq: body.seq }).where(eq(syncLinks.workspaceId, workspaceId)).run();
        link = { ...link, pulledSeq: body.seq };
        if (!body.more) break;
      }
      for (;;) {
        const mine = changesSince(db, workspaceId, link.pushedSeq, SERVER, 100);
        const changes = link.remoteUserId && link.userId ? renameUser(mine.changes, link.userId, link.remoteUserId) : mine.changes;
        // Files go first: the server adds an attachment only once it has its file.
        for (const c of changes) {
          if (c.entity !== "attachment" || c.deleted) continue;
          const file = attachmentPath(config.dataDir, c.id);
          if (!fs.existsSync(file)) continue;
          const r = await request(link, `/api/sync/${workspaceId}/attachments/${c.id}`, { method: "PUT", body: fs.readFileSync(file) });
          link = r.link;
          if (!r.res.ok) throw new SyncError("server_refused", `The server refused a file (${r.res.status}).`);
        }
        if (changes.length) {
          const r = await api(link, `/api/sync/${workspaceId}/push`, { method: "POST", body: JSON.stringify({ peer: link.peerId, changes }) });
          link = r.link;
        }
        db.update(syncLinks).set({ pushedSeq: mine.seq }).where(eq(syncLinks.workspaceId, workspaceId)).run();
        link = { ...link, pushedSeq: mine.seq };
        if (!mine.more) break;
      }
      db.update(syncLinks).set({ lastSyncAt: new Date(), lastError: null }).where(eq(syncLinks.workspaceId, workspaceId)).run();
    } catch (err) {
      db.update(syncLinks)
        .set({ lastError: err instanceof SyncError ? err.code : (err as Error).message.slice(0, 500) })
        .where(eq(syncLinks.workspaceId, workspaceId))
        .run();
    }
  }

  /** Syncs a space now, or waits for the round already running. */
  function syncNow(workspaceId: string): Promise<void> {
    const current = running.get(workspaceId);
    if (current) return current;
    const p = syncSpace(workspaceId).finally(() => running.delete(workspaceId));
    running.set(workspaceId, p);
    return p;
  }

  const syncAll = () =>
    Promise.all(
      db
        .select({ id: syncLinks.workspaceId })
        .from(syncLinks)
        .all()
        .map((l) => syncNow(l.id)),
    );

  /** Changes made here since the last push. */
  function pendingCount(link: typeof syncLinks.$inferSelect): number {
    return (
      db
        .select({ n: sql<number>`count(*)` })
        .from(syncChanges)
        .where(and(eq(syncChanges.workspaceId, link.workspaceId), gt(syncChanges.seq, link.pushedSeq), isNull(syncChanges.origin)))
        .get()?.n ?? 0
    );
  }

  return {
    /** Starts linking: registers with the server and returns the address of its consent page. */
    async start(serverUrlInput: string, userId: string): Promise<string> {
      let serverUrl: string;
      try {
        serverUrl = normalizeServerUrl(serverUrlInput);
      } catch (err) {
        throw err instanceof SyncError ? err : new SyncError("invalid_url", "Not a valid address.");
      }
      const health = await call(`${serverUrl}/api/health`);
      const ok = health.ok && ((await health.json().catch(() => null)) as { ok?: boolean } | null)?.ok;
      if (!ok) throw new SyncError("not_nootion", "No Nootion server answers at this address.");
      const reg = await call(`${serverUrl}/api/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_name: "Nootion pour ordinateur", redirect_uris: [redirectUri] }),
      });
      if (!reg.ok) throw new SyncError("server_refused", `The server refused the link (${reg.status}).`);
      const { client_id } = (await reg.json()) as { client_id: string };
      const verifier = b64url(randomBytes(32));
      const state = b64url(randomBytes(16));
      for (const [s, p] of pending) if (p.expiresAt < Date.now()) pending.delete(s);
      pending.set(state, { serverUrl, clientId: client_id, verifier, userId, expiresAt: Date.now() + 15 * 60_000 });
      const url = new URL(`${serverUrl}/oauth/authorize`);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", client_id);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("code_challenge", b64url(createHash("sha256").update(verifier).digest()));
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("scope", "read write");
      url.searchParams.set("state", state);
      return url.toString();
    },

    /** Back from the server's consent page: links the spaces chosen and brings them here. Returns their ids. */
    async finish(code: string, state: string): Promise<string[]> {
      const p = pending.get(state);
      pending.delete(state);
      if (!p || p.expiresAt < Date.now()) throw new SyncError("link_expired", "This link expired. Start again.");
      const res = await call(`${p.serverUrl}/api/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant_type: "authorization_code", code, client_id: p.clientId, redirect_uri: redirectUri, code_verifier: p.verifier }),
      });
      if (!res.ok) throw new SyncError("server_refused", `The server refused the link (${res.status}).`);
      const t = (await res.json()) as Tokens;
      const spaces = await call(`${p.serverUrl}/api/workspaces`, { headers: { authorization: `Bearer ${t.access_token}` } });
      if (!spaces.ok) throw new SyncError("server_refused", `The server refused to list the spaces (${spaces.status}).`);
      const list = ((await spaces.json()) as { workspaces: { id: string; name: string; kind?: string }[] }).workspaces;
      const me = await call(`${p.serverUrl}/api/auth/me`, { headers: { authorization: `Bearer ${t.access_token}` } });
      const remoteUserId = me.ok ? (((await me.json()) as { user?: { id?: string } }).user?.id ?? null) : null;
      if (!list.length) throw new SyncError("no_space", "No space was shared with this app.");
      const tokens = {
        clientId: p.clientId,
        accessToken: encryptSecret(key, t.access_token),
        refreshToken: encryptSecret(key, t.refresh_token),
        accessExpiresAt: new Date(Date.now() + t.expires_in * 1000),
      };
      // Here every linked space is a shared one: the personal space of the server gets a name telling it apart.
      const locale = db.select({ locale: users.locale }).from(users).where(eq(users.id, p.userId)).get()?.locale;
      const nameOf = (ws: (typeof list)[number]) =>
        ws.kind === "personal"
          ? withLocale(isLocale(locale) ? locale : "en", () => `${translate("workspace.personal")} · ${new URL(p.serverUrl).host}`)
          : ws.name;
      for (const ws of list) {
        db.transaction((tx) => {
          if (!tx.select().from(workspaces).where(eq(workspaces.id, ws.id)).get()) {
            tx.insert(workspaces)
              .values({ id: ws.id, name: nameOf(ws), kind: "shared", createdBy: p.userId })
              .run();
          }
          if (
            !tx
              .select()
              .from(workspaceMembers)
              .where(and(eq(workspaceMembers.workspaceId, ws.id), eq(workspaceMembers.userId, p.userId)))
              .get()
          ) {
            tx.insert(workspaceMembers).values({ workspaceId: ws.id, userId: p.userId, role: "owner" }).run();
          }
          tx.delete(syncLinks).where(eq(syncLinks.workspaceId, ws.id)).run();
          // What is already here is sent at the first round (pushedSeq 0), merged with what the server has.
          tx.insert(syncLinks)
            .values({
              workspaceId: ws.id,
              serverUrl: p.serverUrl,
              peerId: randomUUID(),
              pulledSeq: 0,
              pushedSeq: 0,
              userId: p.userId,
              remoteUserId,
              ...tokens,
            })
            .run();
        });
      }
      await Promise.all(list.map((ws) => syncNow(ws.id)));
      return list.map((ws) => ws.id);
    },

    status(): SyncLinkStatus[] {
      return db
        .select({ link: syncLinks, name: workspaces.name })
        .from(syncLinks)
        .innerJoin(workspaces, eq(workspaces.id, syncLinks.workspaceId))
        .all()
        .map(({ link, name }) => ({
          workspaceId: link.workspaceId,
          name,
          serverUrl: link.serverUrl,
          lastSyncAt: link.lastSyncAt?.toISOString() ?? null,
          lastError: link.lastError,
          pending: pendingCount(link),
          syncing: running.has(link.workspaceId),
        }));
    },

    syncNow,
    syncAll,

    /** Stops syncing a space; what is here stays. The server forgets the app's access. */
    async unlink(workspaceId: string): Promise<void> {
      const link = db.select().from(syncLinks).where(eq(syncLinks.workspaceId, workspaceId)).get();
      if (!link) return;
      db.delete(syncLinks).where(eq(syncLinks.workspaceId, workspaceId)).run();
      const others = db.select().from(syncLinks).where(eq(syncLinks.clientId, link.clientId)).all();
      if (!others.length) {
        await call(`${link.serverUrl}/api/oauth/revoke`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: decryptSecret(key, link.refreshToken) }),
        }).catch(() => {});
      }
    },

    /** Syncs every space regularly, and within a few seconds of a change made here. */
    startTimers() {
      if (timers.length) return;
      const local = () => {
        for (const link of db.select().from(syncLinks).all()) if (!running.has(link.workspaceId) && pendingCount(link) > 0) void syncNow(link.workspaceId);
      };
      timers = [setInterval(() => void syncAll(), INTERVAL_MS), setInterval(local, LOCAL_CHECK_MS)];
      for (const t of timers) t.unref();
    },

    stop() {
      for (const t of timers) clearInterval(t);
      timers = [];
    },

    /** For tests: the last change recorded here. */
    seq: () => currentSeq(db),
  };
}

export type DesktopSync = ReturnType<typeof createDesktopSync>;
