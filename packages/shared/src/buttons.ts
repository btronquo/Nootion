import { z } from "zod";
import { parseNaturalDate } from "./dates.js";

/**
 * Buttons: a block in pages, or a column in databases, that runs steps when clicked, optionally after a form.
 * Texts in steps may hold variables between double braces, e.g. {{today}} or {{form.Amount}}: see buttonVariables.
 */

/** Text that may hold variables. */
const template = z.string().max(5000);

export const BUTTON_STEP_TYPES = ["add_row", "update_row", "create_page", "open", "webhook"] as const;
export type ButtonStepType = (typeof BUTTON_STEP_TYPES)[number];

export const buttonStepSchema = z.discriminatedUnion("type", [
  /** Adds a row to a database: cell values by column id, and optionally page content (Markdown). */
  z.object({
    type: z.literal("add_row"),
    databaseId: z.string().min(1).max(64),
    values: z.record(z.string(), template).default({}),
    content: template.optional(),
    open: z.boolean().default(false),
  }),
  /** Changes cells of the current row (a button column, or a button in a row's page). */
  z.object({ type: z.literal("update_row"), values: z.record(z.string(), template).default({}) }),
  /** Creates a page inside a page (the current one when parentId is null), from a template or not. */
  z.object({
    type: z.literal("create_page"),
    parentId: z.string().min(1).max(64).nullable().default(null),
    templateId: z.string().min(1).max(64).nullable().default(null),
    title: template.default(""),
    content: template.optional(),
    open: z.boolean().default(false),
  }),
  /** Opens a page (/page/…) or a link (https://…). */
  z.object({ type: z.literal("open"), url: template }),
  /** Sends a POST request with JSON: the given body, or the button's context (user, page, row, form). */
  z.object({ type: z.literal("webhook"), url: template, body: template.optional() }),
]);
export type ButtonStep = z.infer<typeof buttonStepSchema>;

export const FORM_FIELD_TYPES = ["text", "long_text", "number", "date", "select", "checkbox", "person"] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export const formFieldSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().trim().min(1).max(100),
  type: z.enum(FORM_FIELD_TYPES),
  required: z.boolean().default(false),
  /** select: the choices. */
  options: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
});
export type FormField = z.infer<typeof formFieldSchema>;

export const BUTTON_COLORS = ["default", "blue", "green", "orange", "red", "purple"] as const;
export type ButtonColor = (typeof BUTTON_COLORS)[number];

export const buttonConfigSchema = z.object({
  label: z.string().max(100).default(""),
  color: z.enum(BUTTON_COLORS).default("default"),
  steps: z.array(buttonStepSchema).max(20).default([]),
  /** Filled in before the steps run; its answers are {{form.<label>}}. */
  form: z
    .object({
      title: z.string().max(200).default(""),
      fields: z.array(formFieldSchema).min(1).max(30),
    })
    .nullable()
    .default(null),
});
export type ButtonConfig = z.infer<typeof buttonConfigSchema>;
/** Settings as written, before defaults are filled in. */
export type ButtonConfigInput = z.input<typeof buttonConfigSchema>;

export const emptyButtonConfig = (): ButtonConfig => ({ label: "", color: "default", steps: [], form: null });

/** Local date and time of the person clicking, so that {{today}} is their day. */
const localNow = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

export const runButtonInput = z.object({
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("block"), pageId: z.string().min(1), blockId: z.string().min(1) }),
    z.object({ kind: z.literal("column"), databaseId: z.string().min(1), propertyId: z.string().min(1), rowId: z.string().min(1) }),
  ]),
  /** Answers to the form, by field id. */
  form: z.record(z.string(), z.unknown()).default({}),
  now: localNow,
});
export type RunButtonInput = z.infer<typeof runButtonInput>;

export interface RunButtonResult {
  /** Where to go next (a page or a link), if a step asked for it. */
  open: string | null;
  /** Pages and rows the steps made. */
  created: { id: string; title: string }[];
}

/** The variables offered in steps, for the editor's suggestions. `row.` and `form.` are followed by a name. */
export const BUTTON_VARIABLES = ["today", "now", "user", "user.email", "me", "page.title", "page.url", "row.title", "created.url", "created.title"] as const;

/** Replaces {{variables}} in a text; unknown ones become empty. `escape` adapts values (e.g. to sit inside JSON). */
export function fillTemplate(text: string, vars: Record<string, string>, escape: (v: string) => string = (v) => v): string {
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, name: string) => {
    const key = Object.keys(vars).find((k) => k.toLowerCase() === name.toLowerCase());
    return escape(key === undefined ? "" : vars[key]!);
  });
}

const TRUE_WORDS = new Set(["true", "1", "yes", "oui", "x", "✓", "✔", "on", "vrai"]);

/**
 * A cell value from the text a step gives for a column of this type, or undefined to leave the cell as it is
 * (empty text). Names of options are kept: the server matches them to the options.
 */
export function cellFromText(type: string, text: string, ctx: { now: Date; userId: string; order?: "dmy" | "mdy" }): unknown {
  const v = text.trim();
  if (!v) return undefined;
  const list = () =>
    v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  switch (type) {
    case "number":
    case "currency":
    case "percent": {
      const n = Number(v.replace(/\s/g, "").replace(",", "."));
      if (!Number.isFinite(n)) throw new Error(`"${v}" is not a number`);
      return n;
    }
    case "checkbox":
      return TRUE_WORDS.has(v.toLowerCase());
    case "date": {
      if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(v)) return { start: v, end: null };
      const parsed = parseNaturalDate(v, ctx.now, ctx.order ?? "dmy");
      if (!parsed) throw new Error(`"${v}" is not a date`);
      return { start: parsed.date, end: null };
    }
    case "multi_select":
    case "relation":
      return list();
    case "person":
      return list().map((id) => (id.toLowerCase() === "me" ? ctx.userId : id));
    default:
      return v;
  }
}
