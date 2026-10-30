import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { atLeast, recurrenceInput, t } from "@nootion/shared";
import { recurrences } from "../db/schema.js";
import { HttpError, parseBody, requireUser } from "../http.js";
import { getPageRole, requirePageRole } from "../permissions.js";
import { listProperties } from "../databases.js";
import { getRecurrence, nextRun } from "../recurrences.js";

/** The schedule of a recurring template, set by the people who may edit the template. */
export const recurrenceRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  function requireTemplate(userId: string, id: string) {
    const { page } = requirePageRole(db, userId, id, "editor");
    if (!page.template) throw new HttpError(400, "not_a_template", t("recurrence.notTemplate"));
    return page;
  }

  app.get<{ Params: { id: string } }>("/:id/recurrence", async (req) => {
    const user = requireUser(req);
    requirePageRole(db, user.id, req.params.id, "viewer");
    return { recurrence: getRecurrence(db, req.params.id) };
  });

  // Whoever saves the schedule becomes the one the pages are made as.
  app.put<{ Params: { id: string } }>("/:id/recurrence", async (req) => {
    const user = requireUser(req);
    const template = requireTemplate(user.id, req.params.id);
    const rule = parseBody(recurrenceInput, req.body);
    if (rule.frequency === "weekly" && !rule.weekdays.length) throw new HttpError(400, "no_weekday", t("recurrence.noWeekday"));
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: rule.timeZone });
    } catch {
      throw new HttpError(400, "bad_time_zone", t("recurrence.badTimeZone"));
    }
    if (template.kind === "row") {
      rule.parentId = null;
      const prop = rule.dateProperty ? listProperties(db, template.parentId!).find((p) => p.id === rule.dateProperty) : null;
      if (rule.dateProperty && prop?.type !== "date") throw new HttpError(400, "bad_column", t("recurrence.badColumn"));
    } else {
      rule.dateProperty = null;
      if (!rule.parentId || !atLeast(getPageRole(db, user.id, rule.parentId), "editor")) throw new HttpError(400, "bad_parent", t("recurrence.badParent"));
    }
    const values = { rule, nextRunAt: nextRun(rule), createdBy: user.id, lastError: null };
    db.insert(recurrences)
      .values({ templateId: template.id, ...values })
      .onConflictDoUpdate({ target: recurrences.templateId, set: values })
      .run();
    return { recurrence: getRecurrence(db, template.id) };
  });

  app.delete<{ Params: { id: string } }>("/:id/recurrence", async (req) => {
    const user = requireUser(req);
    requireTemplate(user.id, req.params.id);
    db.delete(recurrences).where(eq(recurrences.templateId, req.params.id)).run();
    return { ok: true };
  });
};
