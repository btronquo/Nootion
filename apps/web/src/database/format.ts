import type { CellValue, DatabaseProperty, DateValue, FileValue, OptionColor, PropertyType } from "@nootion/shared";

export const TYPE_LABELS: Record<PropertyType, string> = {
  title: "Titre",
  text: "Texte",
  number: "Nombre",
  currency: "Montant (devise)",
  percent: "Pourcentage",
  date: "Date",
  select: "Sélection",
  multi_select: "Sélection multiple",
  checkbox: "Case à cocher",
  url: "Lien (URL)",
  email: "Email",
  person: "Personne",
  file: "Fichiers",
  created_time: "Date de création",
  last_edited_time: "Dernière modification",
  created_by: "Créé par",
};

export const OPTION_CLASSES: Record<OptionColor, string> = {
  gray: "bg-neutral-200 text-neutral-800 dark:bg-neutral-700 dark:text-neutral-100",
  brown: "bg-amber-200/70 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100",
  orange: "bg-orange-200 text-orange-900 dark:bg-orange-900/60 dark:text-orange-100",
  yellow: "bg-yellow-200 text-yellow-900 dark:bg-yellow-800/60 dark:text-yellow-100",
  green: "bg-green-200 text-green-900 dark:bg-green-900/60 dark:text-green-100",
  blue: "bg-blue-200 text-blue-900 dark:bg-blue-900/60 dark:text-blue-100",
  purple: "bg-purple-200 text-purple-900 dark:bg-purple-900/60 dark:text-purple-100",
  pink: "bg-pink-200 text-pink-900 dark:bg-pink-900/60 dark:text-pink-100",
  red: "bg-red-200 text-red-900 dark:bg-red-900/60 dark:text-red-100",
};

export const COLOR_LABELS: Record<OptionColor, string> = {
  gray: "Gris",
  brown: "Marron",
  orange: "Orange",
  yellow: "Jaune",
  green: "Vert",
  blue: "Bleu",
  purple: "Violet",
  pink: "Rose",
  red: "Rouge",
};

export const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "CAD", "JPY"];

export function formatNumber(value: number, prop: DatabaseProperty): string {
  const decimals = prop.config.decimals;
  const opts: Intl.NumberFormatOptions = decimals !== undefined ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals } : { maximumFractionDigits: 10 };
  if (prop.type === "currency") return new Intl.NumberFormat("fr-FR", { style: "currency", currency: prop.config.currency ?? "EUR", ...opts }).format(value);
  if (prop.type === "percent") return new Intl.NumberFormat("fr-FR", { style: "percent", ...opts }).format(value / 100);
  return new Intl.NumberFormat("fr-FR", opts).format(value);
}

const dateFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function formatDateString(iso: string): string {
  const hasTime = iso.length > 10;
  const d = hasTime ? new Date(iso) : new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return (hasTime ? dateTimeFmt : dateFmt).format(d);
}

export function formatDate(v: DateValue): string {
  return v.end ? `${formatDateString(v.start)} → ${formatDateString(v.end)}` : formatDateString(v.start);
}

/** Plain-text rendering of a cell (used for copy, titles, read-only displays). */
export function formatValue(prop: DatabaseProperty, value: CellValue, people: Record<string, string>): string {
  if (value === null || value === undefined || value === "") return "";
  switch (prop.type) {
    case "number":
    case "currency":
    case "percent":
      return typeof value === "number" ? formatNumber(value, prop) : "";
    case "date":
      return formatDate(value as DateValue);
    case "created_time":
    case "last_edited_time":
      return formatDateString(value as string);
    case "select":
      return prop.config.options?.find((o) => o.id === value)?.name ?? "";
    case "multi_select":
      return (value as string[]).map((id) => prop.config.options?.find((o) => o.id === id)?.name).filter(Boolean).join(", ");
    case "person":
    case "created_by":
      return (value as string[]).map((id) => people[id] ?? "?").join(", ");
    case "checkbox":
      return value ? "✓" : "";
    case "file":
      return (value as FileValue[]).map((f) => f.name).join(", ");
    default:
      return String(value);
  }
}

/** Parses a number typed the French way ("1 234,5", "12 €", "20 %"). */
export function parseNumberInput(s: string): number | null {
  const cleaned = s.replace(/[\s €$£%]/g, "").replace(",", ".");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}
