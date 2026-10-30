import { eq, inArray, or } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  buttonConfigSchema,
  cellFromText,
  fillTemplate,
  t,
  type ButtonConfig,
  type ButtonStep,
  type DatabaseProperty,
  type FormField,
  type RunButtonInput,
  type RunButtonResult,
} from "@nootion/shared";
import type { Db } from "./db/index.js";
import { pages, users } from "./db/schema.js";
import { readContent, type Collab, type ProseMirrorNode } from "./collab.js";
import { listProperties, listRowPages, toRow } from "./databases.js";
import { getPageMeta } from "./pages.js";
import { requirePageRole } from "./permissions.js";
import { HttpError, notFound } from "./http.js";
import type { UserRow } from "./users.js";
import { ACT_AS_HEADER, INTERNAL_HEADER, INTERNAL_SECRET } from "./internal.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WEBHOOK_TIMEOUT_MS = 10_000;

/** A button block's settings, found in its page's content by id. */
export function findButtonBlock(collab: Collab, db: Db, pageId: string, blockId: string): ButtonConfig | null {
  let found: unknown = null;
  const walk = (n: ProseMirrorNode) => {
    if (found) return;
    if (n.type === "buttonBlock" && n.attrs?.id === blockId) found = n.attrs.config ?? {};
    n.content?.forEach(walk);
  };
  walk(readContent(collab, db, pageId));
  if (!found) return null;
  const parsed = buttonConfigSchema.safeParse(found);
  return parsed.success ? parsed.data : null;
}

/** Where a button was clicked: its page (or row), and the row when there is one. */
interface ButtonContext {
  config: ButtonConfig;
  pageId: string;
  row: { databaseId: string; id: string } | null;
}

/** Finds the button clicked and checks the user may see it. */
export function resolveButton(app: FastifyInstance, user: UserRow, source: RunButtonInput["source"]): ButtonContext {
  const { db } = app;
  if (source.kind === "block") {
    const { page } = requirePageRole(db, user.id, source.pageId, "viewer");
    const config = findButtonBlock(app.collab, db, page.id, source.blockId);
    if (!config) throw notFound();
    return { config, pageId: page.id, row: page.kind === "row" && page.parentId ? { databaseId: page.parentId, id: page.id } : null };
  }
  const { page } = requirePageRole(db, user.id, source.rowId, "viewer");
  if (page.kind !== "row" || page.parentId !== source.databaseId) throw notFound();
  const prop = listProperties(db, source.databaseId).find((p) => p.id === source.propertyId);
  if (prop?.type !== "button") throw notFound();
  return { config: buttonConfigSchema.parse(prop.config.button ?? {}), pageId: page.id, row: { databaseId: source.databaseId, id: page.id } };
}

/** A form answer as text, checked against its field. */
function answerText(field: FormField, value: unknown): string {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) {
    if (field.required) throw new HttpError(400, "form_required", t("button.fieldRequired", { name: field.label }));
    return field.type === "checkbox" ? "false" : "";
  }
  switch (field.type) {
    case "checkbox":
      return value === true ? "true" : "false";
    case "number": {
      const n = Number(String(value).replace(",", "."));
      if (!Number.isFinite(n)) throw new HttpError(400, "form_invalid", t("button.fieldInvalid", { name: field.label }));
      return String(n);
    }
    case "select":
      if (!field.options?.includes(String(value))) throw new HttpError(400, "form_invalid", t("button.fieldInvalid", { name: field.label }));
      return String(value);
    case "date":
      if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(String(value))) throw new HttpError(400, "form_invalid", t("button.fieldInvalid", { name: field.label }));
      return String(value);
    case "person":
      return (Array.isArray(value) ? value : [value]).map(String).join(", ");
    default:
      return String(value).slice(0, 100_000);
  }
}

/** A cell's value as text, for {{row.<column>}}: option and people names, dates as written. */
function cellText(prop: DatabaseProperty, value: unknown, names: Map<string, string>): string {
  if (value === null || value === undefined) return "";
  const option = (id: string) => prop.config.options?.find((o) => o.id === id)?.name ?? "";
  switch (prop.type) {
    case "select":
      return option(String(value));
    case "multi_select":
      return (value as string[]).map(option).filter(Boolean).join(", ");
    case "person":
      return (value as string[]).map((id) => names.get(id) ?? id).join(", ");
    case "date": {
      const d = value as { start: string; end?: string | null };
      return d.start;
    }
    case "checkbox":
      return value ? "true" : "false";
    case "file":
      return (value as { name: string }[]).map((f) => f.name).join(", ");
    case "relation":
      return (value as string[]).join(", ");
    default:
      return typeof value === "object" ? "" : String(value);
  }
}

type Call = <T>(method: "GET" | "POST" | "PATCH", url: string, body?: unknown) => Promise<T>;

/** Who the steps run as: the person clicking, or (public forms) the author of the form's link. */
export interface Runner {
  user: UserRow;
  /** Headers that authenticate the API calls the steps make. */
  headers: Record<string, string>;
  /** Answers from someone without an account: only adding rows and webhooks run. */
  anonymous: boolean;
}

/** The person making this request. */
export function requestRunner(req: FastifyRequest): Runner {
  const headers: Record<string, string> = {};
  for (const h of ["cookie", "authorization", "accept-language"] as const) if (req.headers[h]) headers[h] = String(req.headers[h]);
  return { user: req.user!, headers, anonymous: false };
}

/** A user the server acts as, with a secret only this process knows (see app.ts). */
export function actingAs(user: UserRow, locale: string | undefined): Runner {
  return { user, headers: { [ACT_AS_HEADER]: user.id, [INTERNAL_HEADER]: INTERNAL_SECRET, ...(locale ? { "accept-language": locale } : {}) }, anonymous: true };
}

/** Steps a public form runs: the others need someone signed in. */
export const PUBLIC_STEPS: readonly ButtonStep["type"][] = ["add_row", "webhook"];

/** Calls the API as the runner, with the same checks as their own requests. */
function caller(app: FastifyInstance, auth: Record<string, string>): Call {
  return async (method, url, body) => {
    const res = await app.inject({
      method,
      url: `/api${url}`,
      headers: { ...auth, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });
    const json = res.body ? JSON.parse(res.body) : {};
    if (res.statusCode >= 400) throw new HttpError(res.statusCode, json.error ?? "step_failed", json.message ?? `HTTP ${res.statusCode}`);
    return json;
  };
}

/** Runs a button's steps in order, as the user; stops at the first step that fails, saying which. */
export async function runButton(app: FastifyInstance, runner: Runner, ctx: ButtonContext, input: RunButtonInput): Promise<RunButtonResult> {
  const { user, anonymous } = runner;
  const { db } = app;
  const { config } = ctx;
  const call = caller(app, runner.headers);
  const base = app.config.appUrl;
  const now = new Date(`${input.now}:00`);

  // Variables offered to the steps.
  const vars: Record<string, string> = {
    today: input.now.slice(0, 10),
    now: input.now,
    user: anonymous ? "" : user.name,
    "user.email": anonymous ? "" : user.email,
    me: anonymous ? "" : user.id,
  };
  const page = getPageMeta(db, ctx.pageId);
  if (page) Object.assign(vars, { "page.id": page.id, "page.title": page.title, "page.url": `${base}/page/${page.id}` });
  const form: Record<string, string> = {};
  for (const field of config.form?.fields ?? []) {
    form[field.label] = answerText(field, input.form[field.id]);
    vars[`form.${field.label}`] = form[field.label]!;
  }
  let rowValues: Record<string, string> = {};
  // The row's values, read again after a step changed it.
  const loadRow = () => {
    if (!ctx.row) return;
    const properties = listProperties(db, ctx.row.databaseId);
    const rowPage = listRowPages(db, ctx.row.databaseId).find((r) => r.id === ctx.row!.id);
    if (rowPage) {
      const row = toRow(rowPage, properties);
      const people = properties.filter((p) => p.type === "person" || p.type === "created_by").flatMap((p) => (row.values[p.id] as string[] | null) ?? []);
      const names = new Map(
        people.length
          ? db
              .select({ id: users.id, name: users.name })
              .from(users)
              .where(inArray(users.id, people))
              .all()
              .map((u) => [u.id, u.name])
          : [],
      );
      rowValues = Object.fromEntries(properties.map((p) => [p.name, cellText(p, row.values[p.id], names)]));
      Object.assign(vars, { "row.id": row.id, "row.title": row.title, "row.url": `${base}/page/${row.id}` });
      for (const [name, value] of Object.entries(rowValues)) vars[`row.${name}`] = value;
    }
  };
  loadRow();

  const result: RunButtonResult = { open: null, created: [] };
  const fill = (text: string) => fillTemplate(text, vars);
  const created = (id: string, title: string) => {
    result.created.push({ id, title });
    Object.assign(vars, { "created.id": id, "created.title": title, "created.url": `${base}/page/${id}` });
  };

  /** Cell values from a step's texts, by column id; people may be named by name or email. */
  const cells = (databaseId: string, values: Record<string, string>) => {
    const properties = listProperties(db, databaseId);
    const out: Record<string, unknown> = {};
    for (const [key, text] of Object.entries(values)) {
      const prop = properties.find((p) => p.id === key);
      if (!prop) continue;
      let value = cellFromText(prop.type, fill(text), { now, userId: anonymous ? "" : user.id, order: user.locale === "en" ? "mdy" : "dmy" });
      if (value === undefined) continue;
      // "me" is nobody for an answer without an account.
      if (prop.type === "person") value = (value as string[]).filter(Boolean).map((v) => (UUID.test(v) ? v : findUser(db, v)));
      out[key] = value;
    }
    return out;
  };

  const run = async (step: ButtonStep) => {
    switch (step.type) {
      case "add_row": {
        const content = step.content ? fill(step.content) : "";
        const { row } = await call<{ row: { id: string; title: string } }>("POST", `/databases/${step.databaseId}/rows`, {
          values: cells(step.databaseId, step.values),
          ...(content.trim() ? { markdown: content } : {}),
        });
        created(row.id, row.title);
        if (step.open) result.open = `/page/${row.id}`;
        return;
      }
      case "update_row": {
        if (!ctx.row) throw new HttpError(400, "no_row", t("button.noRow"));
        await call("PATCH", `/databases/${ctx.row.databaseId}/rows/${ctx.row.id}`, { values: cells(ctx.row.databaseId, step.values) });
        loadRow();
        return;
      }
      case "create_page": {
        const parentId = step.parentId ?? ctx.pageId;
        const parent = getPageMeta(db, parentId);
        if (!parent) throw notFound();
        const title = fill(step.title).trim().slice(0, 500);
        const { page: made } = await call<{ page: { id: string; title: string } }>("POST", "/pages", { workspaceId: parent.workspaceId, parentId, title });
        if (step.templateId) await call("POST", `/pages/${made.id}/apply-template`, { templateId: step.templateId });
        const content = step.content ? fill(step.content) : "";
        if (content.trim()) await call("POST", `/pages/${made.id}/content`, { markdown: content });
        const final = db.select({ title: pages.title }).from(pages).where(eq(pages.id, made.id)).get();
        created(made.id, final?.title ?? title);
        if (step.open) result.open = `/page/${made.id}`;
        return;
      }
      case "open": {
        const url = fill(step.url).trim().replace(base, "");
        if (!/^(\/page\/[\w-]+|https?:\/\/\S+)$/i.test(url)) throw new HttpError(400, "bad_url", t("button.badUrl"));
        result.open = url;
        return;
      }
      case "webhook": {
        const url = fill(step.url).trim();
        if (!/^https?:\/\/\S+$/i.test(url)) throw new HttpError(400, "bad_url", t("button.badUrl"));
        const body = step.body?.trim()
          ? fillTemplate(step.body, vars, (v) => JSON.stringify(v).slice(1, -1))
          : JSON.stringify({
              button: config.label,
              user: anonymous ? null : { id: user.id, name: user.name, email: user.email },
              page: page ? { id: page.id, title: page.title, url: vars["page.url"] } : null,
              row: ctx.row ? { id: ctx.row.id, values: rowValues } : null,
              form,
              created: result.created,
            });
        let res: Response;
        try {
          res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json", "user-agent": "Nootion" },
            body,
            signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
          });
        } catch (err) {
          throw new HttpError(502, "webhook_failed", t("button.webhookFailed", { reason: (err as Error).message }));
        }
        if (!res.ok) throw new HttpError(502, "webhook_failed", t("button.webhookFailed", { reason: `HTTP ${res.status}` }));
        return;
      }
    }
  };

  for (const [i, step] of config.steps.entries()) {
    if (anonymous && !PUBLIC_STEPS.includes(step.type)) continue;
    try {
      await run(step);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = err instanceof HttpError ? err.statusCode : 400;
      throw new HttpError(status, err instanceof HttpError ? err.code : "step_failed", t("button.stepFailed", { number: i + 1, message }));
    }
  }
  return result;
}

/** A user named by email or name, for person columns. */
function findUser(db: Db, nameOrEmail: string): string {
  const key = nameOrEmail.trim().toLowerCase();
  const found = db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(or(eq(users.email, key), eq(users.name, nameOrEmail.trim())))
    .get();
  if (!found) throw new HttpError(400, "unknown_person", t("button.unknownPerson", { name: nameOrEmail }));
  return found.id;
}
