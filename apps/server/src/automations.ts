import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  atLeast,
  automationTriggerSchema,
  buttonStepSchema,
  DAY_REMINDER_HOUR,
  type Automation,
  type AutomationTrigger,
  type ButtonStep,
} from "@nootion/shared";
import { z } from "zod";
import type { Db } from "./db/index.js";
import { automationRuns, automations, pages, users } from "./db/schema.js";
import { listProperties, listRowPages, toRow } from "./databases.js";
import { getPageRole } from "./permissions.js";
import { actingAs, cellText, runButton } from "./buttons.js";
import { INTERNAL_HEADER, INTERNAL_SECRET } from "./internal.js";

/** Marks the API calls automations make: what they change doesn't set off automations again. */
export const AUTOMATION_HEADER = "x-nootion-automation";

/** Whether a request comes from an automation's steps. */
export function fromAutomation(req: FastifyRequest): boolean {
  return req.headers[AUTOMATION_HEADER] === "1" && req.headers[INTERNAL_HEADER] === INTERNAL_SECRET;
}

const KEPT_RUNS = 20;
/** A date that arrived longer ago than this (the server was off) doesn't set anything off any more. */
const TOO_LATE = 24 * 3600_000;

type AutomationRow = typeof automations.$inferSelect;

const pad = (n: number) => String(n).padStart(2, "0");
/** Now, in the server's time zone: "2026-11-02T08:30". */
const localNow = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** When a date sets off "date reached": at its time, or at 9:00 for a day without one. */
function dateMoment(date: string): Date {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number) as [number, number, number];
  const [hh, mm] = date.includes("T") ? (date.slice(11, 16).split(":").map(Number) as [number, number]) : [DAY_REMINDER_HOUR, 0];
  return new Date(y, m - 1, d, hh, mm);
}

export function toAutomation(db: Db, a: AutomationRow): Automation {
  const runs = db.select().from(automationRuns).where(eq(automationRuns.automationId, a.id)).orderBy(desc(automationRuns.createdAt)).limit(5).all();
  const ids = runs.map((r) => r.rowId).filter((id): id is string => !!id);
  const titles = new Map(
    ids.length
      ? db
          .select({ id: pages.id, title: pages.title })
          .from(pages)
          .where(inArray(pages.id, ids))
          .all()
          .map((p) => [p.id, p.title])
      : [],
  );
  const author = db.select({ name: users.name }).from(users).where(eq(users.id, a.createdBy)).get();
  return {
    id: a.id,
    databaseId: a.databaseId,
    name: a.name,
    enabled: a.enabled,
    trigger: automationTriggerSchema.parse(a.trigger),
    steps: z.array(buttonStepSchema).parse(a.steps),
    createdByName: author?.name ?? "?",
    runs: runs.map((r) => ({ at: r.createdAt.toISOString(), rowId: r.rowId, rowTitle: (r.rowId && titles.get(r.rowId)) || "", error: r.error })),
  };
}

/** A row's values by column id (title included), to compare before and after a change. */
export function rowSnapshot(db: Db, databaseId: string, rowId: string): Record<string, unknown> | null {
  const page = listRowPages(db, databaseId).find((r) => r.id === rowId);
  return page ? toRow(page, listProperties(db, databaseId)).values : null;
}

/** A row as it was before a change, and after. */
export interface RowChange {
  databaseId: string;
  rowId: string;
  /** Values by column id; null for a new row. */
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
}

/**
 * Runs database automations: on row changes the API reports, and every minute for dates reached. Steps run one
 * automation after the other, in the background, and each run is logged with its error if a step failed.
 */
export function createAutomations(app: FastifyInstance) {
  const { db } = app;
  let queue: Promise<void> = Promise.resolve();

  async function run(a: AutomationRow, rowId: string, key: string | null = null) {
    const runId = randomUUID();
    if (key) {
      // Claimed first: a date sets an automation off only once, even if two checks overlap.
      const claimed = db.insert(automationRuns).values({ id: runId, automationId: a.id, rowId, key }).onConflictDoNothing().returning().get();
      if (!claimed) return;
    }
    let error: string | null = null;
    try {
      const author = db.select().from(users).where(eq(users.id, a.createdBy)).get();
      if (!author || author.disabled) throw new Error("The person who set up this automation no longer has an account.");
      if (!atLeast(getPageRole(db, author.id, a.databaseId), "editor")) throw new Error(`${author.name} can no longer edit this database.`);
      const runner = actingAs(author, author.locale);
      runner.anonymous = false;
      runner.headers[AUTOMATION_HEADER] = "1";
      const steps = z
        .array(buttonStepSchema)
        .parse(a.steps)
        .filter((s: ButtonStep) => s.type !== "open");
      await runButton(
        app,
        runner,
        { config: { label: a.name, color: "default", steps, form: null }, pageId: rowId, row: { databaseId: a.databaseId, id: rowId } },
        { source: { kind: "block", pageId: rowId, blockId: "" }, form: {}, now: localNow(new Date()) },
      );
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      app.log.warn({ err, automation: a.id }, "An automation failed");
    }
    if (key) db.update(automationRuns).set({ error }).where(eq(automationRuns.id, runId)).run();
    else db.insert(automationRuns).values({ id: runId, automationId: a.id, rowId, error }).run();
    // Only the latest runs are kept (dates reached stay, so they don't go off again).
    const old = db
      .select({ id: automationRuns.id, key: automationRuns.key })
      .from(automationRuns)
      .where(eq(automationRuns.automationId, a.id))
      .orderBy(desc(automationRuns.createdAt))
      .all()
      .slice(KEPT_RUNS)
      .filter((r) => !r.key);
    if (old.length)
      db.delete(automationRuns)
        .where(
          inArray(
            automationRuns.id,
            old.map((r) => r.id),
          ),
        )
        .run();
  }

  const enabledFor = (databaseId: string) =>
    db
      .select()
      .from(automations)
      .where(and(eq(automations.databaseId, databaseId), eq(automations.enabled, true)))
      .all();

  /** The automations a change sets off. */
  function matching(change: RowChange): AutomationRow[] {
    const list = enabledFor(change.databaseId);
    if (!list.length) return [];
    const properties = listProperties(db, change.databaseId);
    return list.filter((a) => {
      const trigger = automationTriggerSchema.safeParse(a.trigger);
      if (!trigger.success) return false;
      const tr: AutomationTrigger = trigger.data;
      if (tr.type === "row_added") return change.before === null;
      if (tr.type !== "property_changed" || change.before === null) return false;
      const before = change.before[tr.propertyId] ?? null;
      const after = change.after[tr.propertyId] ?? null;
      if (JSON.stringify(before) === JSON.stringify(after)) return false;
      if (tr.to === null) return true;
      const prop = properties.find((p) => p.id === tr.propertyId);
      return !!prop && cellText(prop, after, new Map()).trim().toLowerCase() === tr.to.trim().toLowerCase();
    });
  }

  /**
   * Reports a row added or changed by someone (not by an automation). Resolves when the automations it set off are
   * done, or after `wait` ms: the request answers with their changes when they are quick, and doesn't hang otherwise.
   */
  async function rowChanged(change: RowChange, wait = 2000) {
    const list = matching(change);
    if (!list.length) return;
    const done = (queue = queue.then(async () => {
      for (const a of list) await run(a, change.rowId);
    }));
    await Promise.race([done, new Promise((resolve) => setTimeout(resolve, wait).unref())]);
  }

  /** Sets off "date reached" automations whose date arrived. */
  async function tick(now = new Date()) {
    const list = db.select().from(automations).where(eq(automations.enabled, true)).all();
    for (const a of list) {
      const trigger = automationTriggerSchema.safeParse(a.trigger);
      if (!trigger.success || trigger.data.type !== "date_reached") continue;
      const propertyId = trigger.data.propertyId;
      const properties = listProperties(db, a.databaseId);
      if (!properties.some((p) => p.id === propertyId && p.type === "date")) continue;
      for (const page of listRowPages(db, a.databaseId)) {
        const value = toRow(page, properties).values[propertyId] as { start?: string } | null;
        if (!value?.start) continue;
        const at = dateMoment(value.start);
        // Dates from before the automation existed, or long gone, don't count.
        if (at > now || at < a.createdAt || now.getTime() - at.getTime() > TOO_LATE) continue;
        await run(a, page.id, `${page.id}:${value.start}`);
      }
    }
  }

  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void tick()
      .catch((err) => app.log.warn({ err }, "Couldn't check the automations"))
      .finally(() => (running = false));
  }, 60_000);
  timer.unref();

  return {
    rowChanged,
    tick,
    /** Resolves once the runs set off so far are done (for tests). */
    idle: () => queue,
    stop: () => clearInterval(timer),
  };
}

export type Automations = ReturnType<typeof createAutomations>;
