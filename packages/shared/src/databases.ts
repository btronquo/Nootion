import { z } from "zod";
import type { PageRole } from "./pages.js";
import { CALC_FUNCTIONS, type CalcFunction, type CalcResult } from "./calculations.js";
import type { FormulaResult } from "./formula.js";
import { VIEW_TYPES, viewFilterSchema, viewSortSchema, type ViewFilter, type ViewSort, type ViewType } from "./views.js";
import { t } from "./i18n/index.js";

export const PROPERTY_TYPES = [
  "title",
  "text",
  "number",
  "currency",
  "percent",
  "date",
  "select",
  "multi_select",
  "checkbox",
  "url",
  "email",
  "person",
  "file",
  "created_time",
  "last_edited_time",
  "created_by",
  "relation",
  "rollup",
  "formula",
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

/** Types computed by the server; their cells cannot be edited. */
export const COMPUTED_TYPES: readonly PropertyType[] = ["created_time", "last_edited_time", "created_by", "rollup", "formula"];
/** Types that need their own settings: a column can't be converted to or from them. */
export const STRUCTURAL_TYPES: readonly PropertyType[] = ["relation", "rollup", "formula"];
/** Types that can be created by users (the title column always exists, exactly once). */
export const CREATABLE_TYPES = PROPERTY_TYPES.filter((t) => t !== "title");

export const OPTION_COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;
export type OptionColor = (typeof OPTION_COLORS)[number];

export const selectOptionSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(100),
  color: z.enum(OPTION_COLORS).default("gray"),
});
export type SelectOption = z.infer<typeof selectOptionSchema>;

export const propertyConfigSchema = z
  .object({
    /** select / multi_select */
    options: z.array(selectOptionSchema).max(500).optional(),
    /** currency: ISO 4217 code */
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    /** number / currency / percent */
    decimals: z.number().int().min(0).max(8).optional(),
    /** date */
    includeTime: z.boolean().optional(),
    /** relation: the related database. Set at creation. */
    databaseId: z.string().min(1).optional(),
    /** relation: the matching property in the related database, for two-way relations. Managed by the server. */
    twinPropertyId: z.string().min(1).nullable().optional(),
    /** rollup: relation of this database to follow */
    relationPropertyId: z.string().min(1).optional(),
    /** rollup: property of the related database to compute */
    targetPropertyId: z.string().min(1).optional(),
    /** rollup: what to compute */
    rollupFunction: z.enum(["show_original", ...CALC_FUNCTIONS] as [string, ...string[]]).optional(),
    /** formula: the expression, e.g. prop("Montant") * 1.2 */
    expression: z.string().max(5000).optional(),
    /** formula: how a number result is shown (with currency / decimals above) */
    formulaFormat: z.enum(["number", "currency", "percent"]).optional(),
  })
  .strict();
export type PropertyConfig = z.infer<typeof propertyConfigSchema>;

export interface DatabaseProperty {
  id: string;
  name: string;
  type: PropertyType;
  config: PropertyConfig;
  position: number;
}

export interface DateValue {
  start: string;
  end?: string | null;
}
export interface FileValue {
  id: string;
  name: string;
}

/** Computed value of a rollup cell. */
export type RollupValue =
  | { kind: "list"; values: CellValue[] }
  | CalcResult;

/** Value stored in a cell, by property type. `null` means empty. Relations hold row ids. */
export type CellValue = string | number | boolean | string[] | DateValue | FileValue[] | RollupValue | FormulaResult | null;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/, { error: () => t("validation.invalidDate") });

/** Validation of a value written by a user, per property type. */
export function valueSchema(type: PropertyType): z.ZodType<CellValue> {
  switch (type) {
    case "title":
    case "text":
      return z.string().max(20000).nullable() as z.ZodType<CellValue>;
    case "number":
    case "currency":
    case "percent":
      return z.number().finite().nullable() as z.ZodType<CellValue>;
    case "date":
      return z.object({ start: isoDate, end: isoDate.nullable().optional() }).nullable() as z.ZodType<CellValue>;
    case "select":
      return z.string().min(1).max(64).nullable() as z.ZodType<CellValue>;
    case "relation":
      return z.array(z.string().min(1).max(64)).max(500).nullable() as z.ZodType<CellValue>;
    case "multi_select":
    case "person":
      return z.array(z.string().min(1).max(64)).max(100).nullable() as z.ZodType<CellValue>;
    case "checkbox":
      return z.boolean().nullable() as z.ZodType<CellValue>;
    case "url":
      return z.string().trim().max(2000).nullable() as z.ZodType<CellValue>;
    case "email":
      return z.string().trim().max(254).nullable() as z.ZodType<CellValue>;
    case "file":
      return z.array(z.object({ id: z.string().uuid(), name: z.string().max(255) })).max(50).nullable() as z.ZodType<CellValue>;
    default:
      return z.never() as unknown as z.ZodType<CellValue>;
  }
}

export interface ViewColumn {
  propertyId: string;
  width?: number;
  hidden?: boolean;
}

export interface ViewConfig {
  /** Column order and display settings. Properties missing from the list are shown at the end. */
  columns?: ViewColumn[];
  /** Calculation shown under each column, by property id. */
  calculations?: Record<string, CalcFunction>;
  filters?: ViewFilter[];
  /** "and" (default): rows match every filter. "or": rows match at least one. */
  filterMode?: "and" | "or";
  /** Applied in order: the first sort decides, the next ones break ties. */
  sorts?: ViewSort[];
  /** Property whose values split the rows into groups (board columns). */
  groupBy?: string | null;
  /** Groups folded away (table) or hidden (board), by group key. */
  collapsedGroups?: string[];
  /** Calendar and timeline: the date column rows are placed on (else the first date column). */
  dateProperty?: string | null;
  /** Calendar: a month or a week at a time. */
  calendarMode?: "month" | "week";
  /** Timeline: width of a day, from days to months. */
  timelineScale?: "day" | "week" | "month";
  /** Gallery: shows the row's cover or first image at the top of its card (default true). */
  showPreview?: boolean;
}

export const viewConfigSchema = z
  .object({
    columns: z
      .array(z.object({ propertyId: z.string().min(1), width: z.number().int().min(60).max(1200).optional(), hidden: z.boolean().optional() }))
      .max(500)
      .optional(),
    calculations: z.record(z.string(), z.enum(CALC_FUNCTIONS)).optional(),
    filters: z.array(viewFilterSchema).max(50).optional(),
    filterMode: z.enum(["and", "or"]).optional(),
    sorts: z.array(viewSortSchema).max(20).optional(),
    groupBy: z.string().min(1).max(64).nullable().optional(),
    collapsedGroups: z.array(z.string().max(500)).max(500).optional(),
    dateProperty: z.string().min(1).max(64).nullable().optional(),
    calendarMode: z.enum(["month", "week"]).optional(),
    timelineScale: z.enum(["day", "week", "month"]).optional(),
    showPreview: z.boolean().optional(),
  })
  .passthrough();

export interface DatabaseViewInfo {
  id: string;
  name: string;
  type: ViewType;
  config: ViewConfig;
  position: number;
}

export interface DatabaseRow {
  id: string;
  title: string;
  icon: string | null;
  /** Values by property id, computed properties included. */
  values: Record<string, CellValue>;
  /** The row page's cover, or (for galleries) the first image of its content. */
  cover: string | null;
  coverPosition: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

export interface DatabaseData {
  id: string;
  title: string;
  icon: string | null;
  role: PageRole;
  properties: DatabaseProperty[];
  views: DatabaseViewInfo[];
  rows: DatabaseRow[];
  /** Names of the people referenced by person / created_by cells. */
  people: Record<string, string>;
  /** Rows referenced by relation cells, when the reader can see their database. */
  related: Record<string, RelatedRow>;
  /** For each rollup property: the property it computes, or null when unavailable. */
  rollupTargets: Record<string, DatabaseProperty | null>;
}

export interface RelatedRow {
  title: string;
  icon: string | null;
  databaseId: string;
}

/** A database the user can link to. */
export interface DatabaseSummary {
  id: string;
  title: string;
  icon: string | null;
  workspaceId: string;
}

export const createDatabaseInput = z.object({
  workspaceId: z.string().min(1),
  parentId: z.string().min(1).nullable().default(null),
  title: z.string().max(500).default(""),
});

export const createPropertyInput = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(PROPERTY_TYPES).refine((type) => type !== "title", { error: () => t("validation.oneTitleColumn") }),
  config: propertyConfigSchema.default({}),
  /** relation: also add a matching property to the related database. */
  twoWay: z.boolean().optional(),
});

export const updatePropertyInput = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  type: z.enum(PROPERTY_TYPES).optional(),
  config: propertyConfigSchema.optional(),
  position: z.number().int().min(0).optional(),
});

export const rowInput = z.object({
  title: z.string().max(500).optional(),
  values: z.record(z.string(), z.unknown()).default({}),
});

export const updateViewInput = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  type: z.enum(VIEW_TYPES).optional(),
  config: viewConfigSchema.optional(),
  position: z.number().int().min(0).optional(),
});

export const createViewInput = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(VIEW_TYPES).default("table"),
  /** Copies the settings of another view of the same database. */
  duplicateOf: z.string().min(1).optional(),
});
