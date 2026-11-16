import type { FastifyPluginAsync } from "fastify";
import { auditActionLabel, auditQueryInput, t, type AuditEvent } from "@nootion/shared";
import { allAuditEvents, auditActors, listAuditEvents } from "../audit.js";
import { csvField } from "../export.js";
import { parseBody, requireAdmin } from "../http.js";
import { attachmentHeader } from "./databases.js";

/** The browser's time zone offset (Date.getTimezoneOffset), so that "from" and "to" are its days. */
const offsetOf = (q: { tz?: unknown }) => {
  const n = Number(q.tz);
  return Number.isFinite(n) && Math.abs(n) <= 14 * 60 ? n : 0;
};

/** A spreadsheet would run a cell starting with = + - @ as a formula: such text gets a leading quote. */
const cell = (s: string, sep: string) => csvField(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s, sep);

/** The activity log, for administrators: read a page at a time, or downloaded as CSV. */
export const auditRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;
  app.addHook("preHandler", async (req) => {
    requireAdmin(req);
  });

  app.get<{ Querystring: Record<string, string> }>("/", async (req) => {
    const q = parseBody(auditQueryInput, req.query);
    return listAuditEvents(db, q, offsetOf(req.query));
  });

  app.get("/actors", async () => ({ actors: auditActors(db) }));

  app.get<{ Querystring: Record<string, string> }>("/export", async (req, reply) => {
    const q = parseBody(auditQueryInput, req.query);
    const sep = req.query.sep === "semicolon" ? ";" : ",";
    const head = [
      t("audit.csv.date"),
      t("audit.csv.person"),
      t("audit.csv.email"),
      t("audit.csv.action"),
      t("audit.csv.actionCode"),
      t("audit.csv.targetType"),
      t("audit.csv.target"),
      t("audit.csv.details"),
      t("audit.csv.address"),
    ];
    const line = (e: AuditEvent) =>
      [
        e.createdAt,
        e.actor?.name ?? "",
        e.actor?.email ?? "",
        auditActionLabel(e.action),
        e.action,
        e.target?.type ?? "",
        e.target?.label ?? e.target?.id ?? "",
        e.details ? JSON.stringify(e.details) : "",
        e.ip ?? "",
      ]
        .map((s) => cell(s, sep))
        .join(sep);
    const lines = [head.map((s) => cell(s, sep)).join(sep)];
    for (const e of allAuditEvents(db, q, offsetOf(req.query))) lines.push(line(e));
    const stamp = new Date().toISOString().slice(0, 10);
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", attachmentHeader(`activity-log-${stamp}.csv`))
      .send(`﻿${lines.join("\r\n")}\r\n`);
  });
};
