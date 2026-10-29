import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { notionImportInput, t, type NotionImportStatus } from "@nootion/shared";
import { notionConnections } from "../db/schema.js";
import { HttpError, notFound, parseBody, requireUser } from "../http.js";
import { CAN_CREATE_ROOT_PAGES, requirePageRole, requireWorkspaceRole } from "../permissions.js";
import { decryptSecret, encryptSecret, secretKey } from "../secrets.js";
import { requestLocale, withLocale } from "../i18n.js";
import { NotionClient, NotionError } from "../notion/api.js";
import { runNotionImport, type ImportJob } from "../notion/importer.js";

// Notion's file storage: files elsewhere are never downloaded by the server, they stay links.
const NOTION_FILE_HOSTS = /(^|\.)(amazonaws\.com|notion\.so|notion-static\.com|notionusercontent\.com)$/;

/** Import of a Notion workspace into a space, run in the background; the browser follows its progress. */
export const notionRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;
  const key = secretKey(app.config.appSecret, "nootion-notion-token");
  // Latest job of each space. Kept in memory: a restart forgets the progress, not what was imported.
  const jobs = new Map<string, ImportJob>();
  const apiOrigin = new URL(app.config.notionApiUrl).origin;

  const publicJob = (job: ImportJob | undefined) => {
    if (!job) return null;
    const { userId: _, ...rest } = job;
    return rest;
  };

  app.get<{ Querystring: { workspaceId?: string } }>("/", async (req): Promise<NotionImportStatus> => {
    const user = requireUser(req);
    const workspaceId = req.query.workspaceId ?? "";
    requireWorkspaceRole(db, user.id, workspaceId, CAN_CREATE_ROOT_PAGES);
    const connection = db.select().from(notionConnections).where(eq(notionConnections.workspaceId, workspaceId)).get();
    return {
      connected: !!connection,
      lastImportAt: connection?.lastImportAt?.toISOString() ?? null,
      job: publicJob(jobs.get(workspaceId)),
    };
  });

  app.post("/", async (req) => {
    const user = requireUser(req);
    const input = parseBody(notionImportInput, req.body);
    requireWorkspaceRole(db, user.id, input.workspaceId, CAN_CREATE_ROOT_PAGES);
    if (input.parentId) {
      const { page } = requirePageRole(db, user.id, input.parentId, "editor");
      if (page.workspaceId !== input.workspaceId || page.kind !== "page") throw notFound();
    }
    if (jobs.get(input.workspaceId)?.status === "running") throw new HttpError(409, "import_running", t("error.importRunning"));

    const saved = db.select().from(notionConnections).where(eq(notionConnections.workspaceId, input.workspaceId)).get();
    const token = input.token ?? (saved ? decryptSecret(key, saved.token) : null);
    if (!token) throw new HttpError(400, "notion_token", t("error.notionTokenMissing"));
    const client = new NotionClient(token, app.config.notionApiUrl, {
      minInterval: app.config.notionRequestInterval,
      retryDelay: app.config.notionRequestInterval ? 1000 : 10,
    });
    try {
      await client.me();
    } catch (e) {
      if (e instanceof NotionError && (e.status === 401 || e.status === 403)) throw new HttpError(400, "notion_token", t("error.notionTokenRefused"));
      throw new HttpError(502, "notion_unreachable", t("error.notionUnreachable"));
    }
    db.insert(notionConnections)
      .values({ workspaceId: input.workspaceId, token: encryptSecret(key, token), createdBy: user.id })
      .onConflictDoUpdate({ target: notionConnections.workspaceId, set: { token: encryptSecret(key, token) } })
      .run();

    const job: ImportJob = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      userId: user.id,
      status: "running",
      phase: "discover",
      done: 0,
      total: 0,
      report: { pages: 0, databases: 0, rows: 0, files: 0, updated: 0, unchanged: 0, notes: {}, formulas: [] },
      error: null,
      startedAt: Date.now(),
    };
    jobs.set(input.workspaceId, job);
    // Pages get their default names in the language of the person importing.
    void withLocale(requestLocale(req), () =>
      runNotionImport({
        db,
        collab: app.collab,
        client,
        dataDir: app.config.dataDir,
        maxFileBytes: app.config.maxUploadMb * 1024 * 1024,
        fileHosts: (url) => (url.protocol === "https:" && NOTION_FILE_HOSTS.test(url.hostname)) || url.origin === apiOrigin,
        workspaceId: input.workspaceId,
        parentId: input.parentId ?? null,
        userId: user.id,
        job,
      }),
    )
      .then(() => {
        job.status = "done";
        db.update(notionConnections).set({ lastImportAt: new Date() }).where(eq(notionConnections.workspaceId, input.workspaceId)).run();
      })
      .catch((e) => {
        req.log.error(e, "Notion import failed");
        job.status = "failed";
        job.error = e instanceof NotionError ? `Notion: ${e.message}` : e instanceof Error ? e.message : String(e);
      });
    return { job: publicJob(job) };
  });

  // Forgets the saved token.
  app.delete<{ Querystring: { workspaceId?: string } }>("/connection", async (req) => {
    const user = requireUser(req);
    const workspaceId = req.query.workspaceId ?? "";
    requireWorkspaceRole(db, user.id, workspaceId, CAN_CREATE_ROOT_PAGES);
    db.delete(notionConnections).where(eq(notionConnections.workspaceId, workspaceId)).run();
    return { ok: true };
  });
};
