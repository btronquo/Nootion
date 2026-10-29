import { z } from "zod";
import type { PageRole } from "./pages.js";
import { CALC_FUNCTIONS, type CalcFunction, type CalcResult } from "./calculations.js";

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
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

/** Types computed by the server; their cells cannot be edited. */
export const COMPUTED_TYPES: readonly PropertyType[] = ["created_time", "last_edited_time", "created_by", "rollup"];
/** Types that need their own settings: a column can't be converted to or from them. */
export const STRUCTURAL_TYPES: readonly PropertyType[] = ["relation", "rollup"];
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
export type CellValue = string | number | boolean | string[] | DateValue | FileValue[] | RollupValue | null;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/, "Date invalide");

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
}

export const viewConfigSchema = z
  .object({
    columns: z
      .array(z.object({ propertyId: z.string().min(1), width: z.number().int().min(60).max(1200).optional(), hidden: z.boolean().optional() }))
      .max(500)
      .optional(),
    calculations: z.record(z.string(), z.enum(CALC_FUNCTIONS)).optional(),
  })
  .passthrough();

export interface DatabaseViewInfo {
  id: string;
  name: string;
  type: "table";
  config: ViewConfig;
  position: number;
}

export interface DatabaseRow {
  id: string;
  title: string;
  icon: string | null;
  /** Values by property id, computed properties included. */
  values: Record<string, CellValue>;
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
  type: z.enum(PROPERTY_TYPES).refine((t) => t !== "title", "Une database n'a qu'une colonne titre"),
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
  config: viewConfigSchema.optional(),
});
