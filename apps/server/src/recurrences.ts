import type { FastifyInstance } from "fastify";
import { and, eq, isNotNull, lte } from "drizzle-orm";
import { atLeast, dayIn, intlLocale, nextOccurrence, recurrenceInput, tIn, type Locale, type Recurrence, type RecurrenceRule } from "@nootion/shared";
import type { Db } from "./db/index.js";
import { recurrences, users } from "./db/schema.js";
import { getPageMeta } from "./pages.js";
import { getPageRole } from "./permissions.js";
import { ACT_AS_HEADER, INTERNAL_HEADER, INTERNAL_SECRET } from "./internal.js";

type RecurrenceRow = typeof recurrences.$inferSelect;

export function toRecurrence(row: RecurrenceRow): Recurrence {
  return {
    ...recurrenceInput.parse(row.rule),
    templateId: row.templateId,
    nextRunAt: row.nextRunAt?.toISOString() ?? null,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    lastError: row.lastError,
  };
}

/** When a rule runs next, from now on; null when paused. */
export function nextRun(rule: RecurrenceRule, now = new Date()): Date | null {
  return rule.enabled ? nextOccurrence(rule, now) : null;
}

/**
 * Makes the pages and rows of recurring templates when their time comes, as the person who set them up. A run missed
 * while the server was off happens once when it starts again, not once per missed time.
 */
export function createRecurrences(app: FastifyInstance) {
  const { db } = app;

  async function call<T>(userId: string, locale: string, method: "POST" | "PATCH", url: string, body: unknown): Promise<T> {
    const res = await app.inject({
      method,
      url: `/api${url}`,
      headers: { [ACT_AS_HEADER]: userId, [INTERNAL_HEADER]: INTERNAL_SECRET, "accept-language": locale, "content-type": "application/json" },
      payload: JSON.stringify(body),
    });
    const json = res.body ? JSON.parse(res.body) : {};
    if (res.statusCode >= 400) throw new Error(json.message ?? `HTTP ${res.statusCode}`);
    return json as T;
  }

  /** Makes one page or row from the template. */
  async function make(row: RecurrenceRow, at: Date) {
    const rule = recurrenceInput.parse(row.rule);
    const author = db.select().from(users).where(eq(users.id, row.createdBy)).get();
    if (!author || author.disabled) throw new Error("The person who set this up no longer has an account.");
    const template = getPageMeta(db, row.templateId);
    if (!template?.template || !atLeast(getPageRole(db, author.id, template.id), "viewer")) throw new Error("The template is gone.");
    const locale = author.locale as Locale;
    const date = dayIn(at, rule.timeZone);
    const label = new Date(`${date}T12:00:00Z`).toLocaleDateString(intlLocale(locale), {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
    const name = template.title.trim() || tIn(locale, "common.untitled");
    const title = `${name} — ${label}`;
    if (template.kind === "row" && template.parentId) {
      const values = rule.dateProperty ? { [rule.dateProperty]: { start: date, end: null } } : {};
      const made = await call<{ row: { id: string } }>(author.id, locale, "POST", `/databases/${template.parentId}/rows`, { templateId: template.id, values });
      await call(author.id, locale, "PATCH", `/pages/${made.row.id}`, { title });
      return;
    }
    const parent = rule.parentId ? getPageMeta(db, rule.parentId) : null;
    if (!parent) throw new Error("The page to put them in is gone.");
    const made = await call<{ page: { id: string } }>(author.id, locale, "POST", "/pages", { workspaceId: parent.workspaceId, parentId: parent.id, title });
    await call(author.id, locale, "POST", `/pages/${made.page.id}/apply-template`, { templateId: template.id });
  }

  let running = false;
  async function tick(now = new Date()) {
    if (running) return;
    running = true;
    try {
      const due = db
        .select()
        .from(recurrences)
        .where(and(isNotNull(recurrences.nextRunAt), lte(recurrences.nextRunAt, now)))
        .all();
      for (const row of due) {
        const rule = recurrenceInput.parse(row.rule);
        // Moved on first: a failing template doesn't run again every minute.
        db.update(recurrences)
          .set({ nextRunAt: nextRun(rule, now) })
          .where(eq(recurrences.templateId, row.templateId))
          .run();
        let error: string | null = null;
        try {
          await make(row, row.nextRunAt!);
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
          app.log.warn({ err, template: row.templateId }, "A recurring template failed");
        }
        db.update(recurrences).set({ lastRunAt: now, lastError: error }).where(eq(recurrences.templateId, row.templateId)).run();
      }
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => void tick().catch((err) => app.log.warn({ err }, "Couldn't check recurring templates")), 60_000);
  timer.unref();
  return { tick, stop: () => clearInterval(timer) };
}

export type Recurrences = ReturnType<typeof createRecurrences>;

export function getRecurrence(db: Db, templateId: string): Recurrence | null {
  const row = db.select().from(recurrences).where(eq(recurrences.templateId, templateId)).get();
  return row ? toRecurrence(row) : null;
}
