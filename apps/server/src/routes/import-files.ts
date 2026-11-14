import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { FastifyPluginAsync } from "fastify";
import { t, type FileImportJob, type FileImportStatus } from "@nootion/shared";
import { HttpError, notFound, requireUser } from "../http.js";
import { CAN_CREATE_ROOT_PAGES, requirePageRole, requireWorkspaceRole } from "../permissions.js";
import { requestLocale, withLocale } from "../i18n.js";
import { ImportLimitError, runFileImport, undoFileImport, type FileImportServerJob } from "../import-files.js";

const MAX_UPLOADS = 1000;

/** Import of files (Markdown, HTML, Word, text, CSV, or a zip of them) into a space, run in the background. */
export const fileImportRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;
  // Latest job of each person in each space. Kept in memory: a restart forgets the progress and the undo, not what was imported.
  const jobs = new Map<string, FileImportServerJob>();
  const jobKey = (workspaceId: string, userId: string) => `${workspaceId}\n${userId}`;
  const maxBytes = app.config.importMaxMb * 1024 * 1024;

  const publicJob = (job: FileImportServerJob | undefined): FileImportJob | null => {
    if (!job) return null;
    const { userId: _u, parentId: _p, created: _c, ...rest } = job;
    return rest;
  };

  const checkTarget = (userId: string, workspaceId: string, parentId: string | null) => {
    if (!parentId) requireWorkspaceRole(db, userId, workspaceId, CAN_CREATE_ROOT_PAGES);
    else {
      const { page } = requirePageRole(db, userId, parentId, "editor");
      if (page.workspaceId !== workspaceId || page.kind !== "page") throw notFound();
    }
  };

  app.get<{ Querystring: { workspaceId?: string } }>("/", async (req): Promise<FileImportStatus> => {
    const user = requireUser(req);
    const workspaceId = req.query.workspaceId ?? "";
    // Only the person's own import is shown.
    return { job: publicJob(jobs.get(jobKey(workspaceId, user.id))) };
  });

  // The files come as a form: "workspaceId" and "parentId" first, then the files.
  app.post("/", async (req) => {
    const user = requireUser(req);
    if (!req.isMultipart()) throw new HttpError(400, "no_file", t("fileImport.error.noFiles"));
    const id = randomUUID();
    const workDir = path.join(app.config.dataDir, "tmp", `import-${id}`);
    fs.mkdirSync(workDir, { recursive: true });
    const uploads: { name: string; disk: string; size: number }[] = [];
    let workspaceId = "";
    let parentId: string | null = null;
    let total = 0;
    let started = false;
    try {
      for await (const part of req.parts({ limits: { fileSize: maxBytes, files: MAX_UPLOADS, parts: MAX_UPLOADS + 10 } })) {
        if (part.type === "field") {
          if (part.fieldname === "workspaceId") workspaceId = String(part.value);
          if (part.fieldname === "parentId" && part.value) parentId = String(part.value);
          continue;
        }
        if (!uploads.length) {
          // Who may import there is checked before anything is written.
          checkTarget(user.id, workspaceId, parentId);
          if ([...jobs.values()].some((j) => j.workspaceId === workspaceId && j.status === "running"))
            throw new HttpError(409, "import_running", t("error.importRunning"));
        }
        const disk = path.join(workDir, `u${uploads.length}`);
        await pipeline(part.file, fs.createWriteStream(disk));
        const size = fs.statSync(disk).size;
        total += size;
        if (part.file.truncated || total > maxBytes)
          throw new HttpError(413, "too_large", t("fileImport.error.uploadTooLarge", { max: app.config.importMaxMb }));
        uploads.push({ name: (part.filename || "file").slice(0, 255), disk, size });
      }
      if (!uploads.length) throw new HttpError(400, "no_file", t("fileImport.error.noFiles"));

      const job: FileImportServerJob = {
        id,
        workspaceId,
        userId: user.id,
        parentId,
        created: [],
        status: "running",
        phase: "read",
        done: 0,
        total: uploads.length,
        report: { pages: 0, databases: 0, rows: 0, files: 0, links: 0, notes: {}, details: {} },
        error: null,
        startedAt: Date.now(),
        undone: false,
        sources: uploads.map((u) => u.name).slice(0, 50),
      };
      jobs.set(jobKey(workspaceId, user.id), job);
      started = true;
      // Pages get their default names in the language of the person importing.
      void withLocale(requestLocale(req), () =>
        runFileImport({
          db,
          collab: app.collab,
          dataDir: app.config.dataDir,
          uploads,
          workDir,
          limits: { maxFileBytes: app.config.maxUploadMb * 1024 * 1024, maxTotalBytes: maxBytes * 4, maxEntries: 20_000 },
          workspaceId,
          parentId,
          userId: user.id,
          job,
          log: (message, data) => req.log.info({ workspaceId, ...data }, message),
        }),
      )
        .then(() => {
          job.status = "done";
          req.log.info({ workspaceId, report: { ...job.report, details: undefined } }, "File import done");
        })
        .catch((e) => {
          if (!(e instanceof ImportLimitError)) req.log.error(e, "File import failed");
          job.status = "failed";
          job.error = e instanceof Error ? e.message : String(e);
        })
        .finally(() => {
          fs.rmSync(workDir, { recursive: true, force: true });
          app.extractor.wake();
        });
      return { job: publicJob(job) };
    } finally {
      if (!started) fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  // Undoes the import: everything it made goes to the trash.
  app.post<{ Params: { id: string } }>("/:id/undo", async (req) => {
    const user = requireUser(req);
    const job = [...jobs.values()].find((j) => j.id === req.params.id && j.userId === user.id);
    if (!job) throw notFound();
    if (job.status === "running") throw new HttpError(409, "import_running", t("error.importRunning"));
    const trashed = undoFileImport(db, job, user.id);
    return { job: publicJob(job), trashed };
  });
};
