import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, FileText, Paperclip, Upload, X } from "lucide-react";
import {
  buttonConfigSchema,
  emptyButtonConfig,
  COMPUTED_TYPES,
  type CellValue,
  type DatabaseProperty,
  type DateValue,
  type FileValue,
  type FormulaResult,
  type RelatedRow,
  type RollupValue,
  type SelectOption,
} from "@nootion/shared";
import { useUserDirectory } from "../lib/queries";
import { uploadFile } from "../editor/upload";
import { pickFiles } from "../editor/upload";
import { formatCalc, formatDate, formatDateString, formatNumber, numberFormatOf, parseNumberInput } from "./format";
import { useDatabase } from "./hooks";
import { pageTitle } from "../lib/tree";
import { OptionChip, OptionPicker } from "./OptionPicker";
import { Popover } from "./Popover";
import { ButtonAction } from "../buttons/ButtonAction";
import { t } from "@nootion/shared";

export interface CellProps {
  prop: DatabaseProperty;
  value: CellValue;
  rowId: string;
  /** The row's database, for button columns. */
  databaseId?: string;
  people: Record<string, string>;
  editable: boolean;
  onChange: (value: CellValue) => void;
  onCreateOption: (name: string) => Promise<SelectOption>;
  /** "table": compact, one line. "panel": property list of an opened row. */
  variant?: "table" | "panel";
  /** Address of an attached file (differs on public pages). */
  fileUrl?: (id: string) => string;
  /** Titles of the rows that relation cells point to. */
  related?: Record<string, RelatedRow>;
  /** Property computed by a rollup column. */
  rollupTarget?: DatabaseProperty | null;
  /** Address of a related row's page (differs on public pages). */
  rowHref?: (id: string) => string;
}

const EMPTY = <span className="text-neutral-300 dark:text-neutral-600">{t("cell.empty")}</span>;

/** Displays a cell and edits it in place, with an editor suited to the column type. */
export function Cell(props: CellProps) {
  const { prop, value, editable } = props;
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const canEdit = editable && !COMPUTED_TYPES.includes(prop.type);
  const panel = props.variant === "panel";

  if (prop.type === "checkbox") {
    return (
      <div className={`flex h-full items-center ${panel ? "" : "px-2"}`}>
        <input
          type="checkbox"
          aria-label={prop.name}
          className="h-4 w-4 accent-blue-600"
          checked={value === true}
          disabled={!canEdit}
          onChange={(e) => props.onChange(e.target.checked)}
        />
      </div>
    );
  }

  if (prop.type === "button") {
    const config = buttonConfigSchema.safeParse(prop.config.button ?? {});
    return (
      <div className={`flex h-full items-center ${panel ? "py-1" : "px-2"}`} data-button-cell>
        <ButtonAction
          compact={!panel}
          label={prop.name}
          config={config.success ? config.data : emptyButtonConfig()}
          source={props.databaseId && !props.fileUrl ? { kind: "column", databaseId: props.databaseId, propertyId: prop.id, rowId: props.rowId } : null}
        />
      </div>
    );
  }

  const inline = ["title", "text", "number", "currency", "percent", "url", "email", "date"].includes(prop.type);
  return (
    <div
      ref={ref}
      role="gridcell"
      tabIndex={canEdit ? 0 : -1}
      aria-label={prop.name}
      onClick={() => canEdit && setEditing(true)}
      onKeyDown={(e) => {
        if (canEdit && !editing && (e.key === "Enter" || e.key === "F2")) {
          e.preventDefault();
          setEditing(true);
        }
      }}
      className={`relative min-h-[34px] ${panel ? "rounded px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800" : "h-full px-2 py-1.5"} ${canEdit ? "cursor-text" : ""} outline-none focus-visible:ring-2 focus-visible:ring-blue-400`}
    >
      {editing && inline ? (
        <InlineEditor {...props} onDone={() => setEditing(false)} />
      ) : (
        <Display {...props} />
      )}
      {editing && !inline && (
        <Popover anchor={ref.current} onClose={() => setEditing(false)} width={prop.type === "file" ? 300 : 260}>
          <PopupEditor {...props} />
        </Popover>
      )}
    </div>
  );
}

function Display(props: CellProps) {
  const { prop, value, people, variant, fileUrl = (id) => `/api/attachments/${id}`, related = {}, rowHref = (id) => `/page/${id}` } = props;
  const wrap = variant === "panel" ? "flex flex-wrap gap-1" : "flex gap-1 overflow-hidden whitespace-nowrap";
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return variant === "panel" ? EMPTY : null;
  switch (prop.type) {
    case "title":
      return <span className="font-medium">{String(value)}</span>;
    case "checkbox":
      return <span>{value ? "☑" : "☐"}</span>;
    case "number":
    case "currency":
    case "percent":
      return <div className={`tabular-nums ${variant === "panel" ? "" : "text-right"}`}>{formatNumber(value as number, prop)}</div>;
    case "date":
      return <span>{formatDate(value as DateValue)}</span>;
    case "created_time":
    case "last_edited_time":
      return <span className="text-neutral-500">{formatDateString(value as string)}</span>;
    case "url":
      return (
        <a href={/^[a-z]+:/i.test(String(value)) ? String(value) : `https://${value}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="truncate text-blue-600 underline dark:text-blue-400">
          {String(value)}
        </a>
      );
    case "email":
      return (
        <a href={`mailto:${value}`} onClick={(e) => e.stopPropagation()} className="truncate text-blue-600 underline dark:text-blue-400">
          {String(value)}
        </a>
      );
    case "select": {
      const o = prop.config.options?.find((x) => x.id === value);
      return o ? <OptionChip option={o} /> : null;
    }
    case "multi_select":
      return (
        <div className={wrap}>
          {(value as string[]).map((id) => {
            const o = prop.config.options?.find((x) => x.id === id);
            return o ? <OptionChip key={id} option={o} /> : null;
          })}
        </div>
      );
    case "person":
    case "created_by":
      return (
        <div className={wrap}>
          {(value as string[]).map((id) => (
            <span key={id} className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800">
              {people[id] ?? "Utilisateur"}
            </span>
          ))}
        </div>
      );
    case "relation":
      return (
        <div className={wrap}>
          {(value as string[]).map((id) => (
            <Link
              key={id}
              to={rowHref(id)}
              onClick={(e) => e.stopPropagation()}
              className="flex max-w-full items-center gap-1 truncate rounded bg-neutral-100 px-1.5 py-0.5 text-xs underline-offset-2 hover:underline dark:bg-neutral-800"
            >
              {related[id]?.icon ?? <FileText size={11} className="shrink-0" />} <span className="truncate">{pageTitle(related[id]?.title ?? "")}</span>
            </Link>
          ))}
        </div>
      );
    case "formula": {
      const f = value as FormulaResult;
      switch (f.kind) {
        case "number":
          return <div className={`tabular-nums ${variant !== "panel" ? "text-right" : ""}`}>{formatNumber(f.value, numberFormatOf(prop))}</div>;
        case "boolean":
          return <span>{f.value ? "☑" : "☐"}</span>;
        case "date":
          return <span>{formatDateString(f.value)}</span>;
        case "list":
          return <span className="block truncate">{f.value.join(", ")}</span>;
        case "error":
          return (
            <span title={f.value} className="block truncate text-red-600 dark:text-red-400">
              ⚠ {f.value}
            </span>
          );
        default:
          return <span className={variant === "panel" ? "whitespace-pre-wrap" : "block truncate"}>{f.value}</span>;
      }
    }
    case "rollup": {
      const r = value as RollupValue;
      const target = props.rollupTarget;
      if (r.kind === "list") {
        if (!target) return null;
        return (
          <div className={wrap}>
            {r.values.map((v, i) => (
              <span key={i} className="max-w-full truncate">
                <Display {...props} prop={target} value={v} variant="panel" />
              </span>
            ))}
          </div>
        );
      }
      const numeric = r.kind === "number" || r.kind === "count" || r.kind === "percent" || r.kind === "days";
      return <div className={`tabular-nums ${numeric && variant !== "panel" ? "text-right" : ""}`}>{formatCalc(r, target)}</div>;
    }
    case "file":
      return (
        <div className={wrap}>
          {(value as FileValue[]).map((f) => (
            <a key={f.id} href={fileUrl(f.id)} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()} className="flex items-center gap-1 truncate rounded bg-neutral-100 px-1.5 py-0.5 text-xs hover:underline dark:bg-neutral-800">
              <Paperclip size={11} /> {f.name}
            </a>
          ))}
        </div>
      );
    default:
      return <span className="block truncate">{String(value)}</span>;
  }
}

function InlineEditor({ prop, value, onChange, onDone }: CellProps & { onDone: () => void }) {
  const isNumber = prop.type === "number" || prop.type === "currency" || prop.type === "percent";
  const isDate = prop.type === "date";
  const initial = isDate ? ((value as DateValue | null)?.start ?? "") : value === null || value === undefined ? "" : isNumber ? String(value).replace(".", ",") : String(value);
  const [text, setText] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const commit = () => {
    if (text === initial) return onDone();
    if (isNumber) {
      const n = parseNumberInput(text);
      if (Number.isNaN(n)) return setInvalid(true);
      onChange(n);
    } else if (isDate) {
      onChange(text ? { start: text, end: (value as DateValue | null)?.end ?? null } : null);
    } else {
      onChange(prop.type === "title" ? text : text.trim() || null);
    }
    onDone();
  };

  return (
    <input
      ref={input}
      type={isDate ? (prop.config.includeTime ? "datetime-local" : "date") : prop.type === "email" ? "email" : "text"}
      inputMode={isNumber ? "decimal" : undefined}
      value={isDate && prop.config.includeTime ? text.slice(0, 16) : text}
      onChange={(e) => {
        setText(e.target.value);
        setInvalid(false);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") onDone();
        e.stopPropagation();
      }}
      title={invalid ? t("cell.invalidNumber") : undefined}
      className={`absolute inset-0 z-10 w-full bg-white px-2 outline-none ring-2 dark:bg-neutral-900 ${invalid ? "ring-red-500" : "ring-blue-400"} ${isNumber ? "text-right tabular-nums" : ""}`}
    />
  );
}

function PopupEditor(props: CellProps) {
  const { prop, value, onChange, onCreateOption } = props;
  if (prop.type === "select" || prop.type === "multi_select") {
    const multi = prop.type === "multi_select";
    const selected = value === null || value === undefined ? [] : multi ? (value as string[]) : [value as string];
    return <OptionPicker prop={prop} multi={multi} selected={selected} onChange={(ids) => onChange(multi ? (ids.length ? ids : null) : (ids[0] ?? null))} onCreate={onCreateOption} />;
  }
  if (prop.type === "relation") return <RelationPicker {...props} />;
  if (prop.type === "person") return <PersonPicker selected={(value as string[] | null) ?? []} onChange={(ids) => onChange(ids.length ? ids : null)} />;
  if (prop.type === "file") return <FileEditor {...props} />;
  return null;
}

function RelationPicker({ prop, value, onChange }: CellProps) {
  const target = useDatabase(prop.config.databaseId ?? "");
  const [query, setQuery] = useState("");
  const selected = (value as string[] | null) ?? [];
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const rows = (target.data?.rows ?? []).filter((r) => norm(pageTitle(r.title)).includes(norm(query)));
  return (
    <div>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("cell.searchIn", { title: pageTitle(target.data?.title ?? "") })}
        className="mb-1 w-full rounded border border-neutral-200 bg-transparent px-2 py-1.5 outline-none focus:border-neutral-400 dark:border-neutral-700"
      />
      <div className="max-h-64 overflow-y-auto">
        {target.isError && <p className="px-2 py-1 text-neutral-500">{t("cell.relatedUnavailable")}</p>}
        {rows.map((r) => (
          <button
            key={r.id}
            onClick={() => onChange(selected.includes(r.id) ? selected.filter((s) => s !== r.id) : [...selected, r.id])}
            className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              {r.icon ?? <FileText size={14} className="shrink-0 text-neutral-400" />}
              <span className="truncate">{pageTitle(r.title)}</span>
            </span>
            {selected.includes(r.id) && <Check size={14} />}
          </button>
        ))}
        {target.data && !rows.length && <p className="px-2 py-1 text-neutral-500">{t("cell.noRows")}</p>}
      </div>
    </div>
  );
}

function PersonPicker({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const users = useUserDirectory();
  return (
    <div className="max-h-64 overflow-y-auto">
      {users.data?.map((u) => (
        <button
          key={u.id}
          onClick={() => onChange(selected.includes(u.id) ? selected.filter((s) => s !== u.id) : [...selected, u.id])}
          className="flex w-full items-center justify-between rounded px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <span className="truncate">{u.name}</span>
          {selected.includes(u.id) && <Check size={14} />}
        </button>
      ))}
    </div>
  );
}

function FileEditor({ value, rowId, onChange }: CellProps) {
  const files = (value as FileValue[] | null) ?? [];
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-1">
      {files.map((f) => (
        <div key={f.id} className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
          <a href={`/api/attachments/${f.id}`} target="_blank" rel="noopener" className="truncate hover:underline">
            {f.name}
          </a>
          <button onClick={() => onChange(files.filter((x) => x.id !== f.id))} title={t("common.remove")} className="text-neutral-400 hover:text-red-600">
            <X size={14} />
          </button>
        </div>
      ))}
      <button
        disabled={busy}
        onClick={async () => {
          const picked = await pickFiles("*/*");
          if (!picked.length) return;
          setBusy(true);
          try {
            const uploaded = await Promise.all(picked.map((f) => uploadFile(rowId, f)));
            onChange([...files, ...uploaded.map((u) => ({ id: u.id, name: u.filename }))]);
          } catch (err) {
            alert(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        <Upload size={14} /> {busy ? t("common.uploading") : t("cell.addFile")}
      </button>
    </div>
  );
}
