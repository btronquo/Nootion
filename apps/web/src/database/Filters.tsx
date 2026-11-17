import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ListFilter, MoreHorizontal, Plus, Trash2, X } from "lucide-react";
import {
  t,
  type MessageKey,
  FILTER_OPERATORS_BY_KIND,
  RELATIVE_DATES,
  RELATIVE_DIRECTIONS,
  RELATIVE_UNITS,
  VALUELESS_OPERATORS,
  filterKind,
  formatDateRange,
  formatRelativePeriod,
  intlLocale,
  isActiveFilter,
  localDay,
  orderedOptions,
  parseRelativePeriod,
  relativePeriodBounds,
  type DatabaseData,
  type DatabaseProperty,
  type FilterKind,
  type FilterOperator,
  type RelativePeriod,
  type ViewConfig,
  type ViewFilter,
} from "@nootion/shared";
import { Popover } from "./Popover";
import { PropertyIcon } from "./icons";
import { formatDateString, parseNumberInput } from "./format";
import { useUserDirectory } from "../lib/queries";

/**
 * Filters of a view. Simple filters are chips above the rows, one column each, all applied;
 * the advanced filter is a list of rules combined with "and" or "or".
 */

const control =
  "rounded border border-neutral-200 bg-transparent px-1.5 py-1 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900";
const menuItem = "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800";

const operatorLabel = (op: FilterOperator) => t(`filter.op.${op}` as MessageKey);
const relativeDateLabel = (key: string) => t(`filter.relative.${key}` as MessageKey);
const isRelativeDate = (v: unknown): v is string => (RELATIVE_DATES as readonly unknown[]).includes(v);
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function relativePeriodLabel(p: RelativePeriod): string {
  return p.direction === "this" ? t(`filter.rel.this.${p.unit}` as MessageKey) : t(`filter.rel.${p.direction}.${p.unit}` as MessageKey, { count: p.count });
}

const dateLabel = (value: string) => (isRelativeDate(value) ? relativeDateLabel(value) : formatDateString(value));

/** Both ends of a "between" value; the end is missing while the range is being picked ("2026-11-02/"). */
function rangeParts(value: unknown): [string | null, string | null] {
  if (typeof value !== "string" || !value) return [null, null];
  const [a, b] = value.split("/");
  return [a || null, b || null];
}

/** A new filter on a column, with its first condition. */
export function newFilter(prop: DatabaseProperty, data: Pick<DatabaseData, "rows">): ViewFilter {
  return { propertyId: prop.id, operator: FILTER_OPERATORS_BY_KIND[filterKind(prop, data)][0]!, value: null };
}

/** A filter with another condition, keeping what still makes sense of its value. */
export function withOperator(f: ViewFilter, kind: FilterKind, operator: FilterOperator): ViewFilter {
  if (VALUELESS_OPERATORS.includes(operator)) return { ...f, operator, value: null };
  if (kind !== "date") return { ...f, operator, value: VALUELESS_OPERATORS.includes(f.operator) ? null : f.value };
  if (operator === "within") return { ...f, operator, value: parseRelativePeriod(f.value) ? f.value : "this:week" };
  if (operator === "between") {
    if (f.operator === "between") return { ...f, operator };
    return { ...f, operator, value: isDay(f.value) ? `${f.value}/` : null };
  }
  if (f.operator === "between") {
    const [start] = rangeParts(f.value);
    return { ...f, operator, value: start ?? "today" };
  }
  return { ...f, operator, value: isDay(f.value) || isRelativeDate(f.value) ? f.value : "today" };
}

/** Short text of a filter for its chip ("" while it has no value). */
function useFilterSummary(prop: DatabaseProperty, kind: FilterKind, f: ViewFilter, data: DatabaseData): string {
  const users = useUserDirectory();
  if (VALUELESS_OPERATORS.includes(f.operator)) return operatorLabel(f.operator);
  if (!isActiveFilter(f, data)) {
    if (f.operator === "between") {
      const [start] = rangeParts(f.value);
      return start ? `${dateLabel(start)} → …` : "";
    }
    return "";
  }
  const v = f.value!;
  const withOp = (s: string) => `${operatorLabel(f.operator)} ${s}`;
  switch (kind) {
    case "date": {
      if (f.operator === "within") return relativePeriodLabel(parseRelativePeriod(v)!);
      if (f.operator === "between") {
        const [a, b] = rangeParts(v) as [string, string];
        return `${dateLabel(a)} → ${dateLabel(b)}`;
      }
      return f.operator === "is" ? dateLabel(String(v)) : withOp(dateLabel(String(v)));
    }
    case "select":
    case "multi_select": {
      const name = prop.config.options?.find((o) => o.id === v)?.name ?? String(v);
      return f.operator === "is" || f.operator === "contains" ? name : withOp(name);
    }
    case "people": {
      const name = v === "me" ? t("filter.me") : (users.data?.find((u) => u.id === v)?.name ?? String(v));
      return f.operator === "contains" ? name : withOp(name);
    }
    case "text":
    case "list":
      return f.operator === "contains" ? String(v) : withOp(`« ${String(v)} »`);
    default:
      return withOp(String(v));
  }
}

// ---------- The bar of filter chips ----------

export type FilterFocus = number | "advanced" | null;

export function FilterBar({
  data,
  config,
  editable,
  onChange,
  focus,
  setFocus,
}: {
  data: DatabaseData;
  config: ViewConfig;
  editable: boolean;
  onChange: (patch: Partial<ViewConfig>) => void;
  focus: FilterFocus;
  setFocus: (focus: FilterFocus) => void;
}) {
  const simple = config.simpleFilters ?? [];
  const advanced = config.filters ?? [];
  const [adding, setAdding] = useState<HTMLElement | null>(null);
  const setSimple = (next: ViewFilter[]) => onChange({ simpleFilters: next });

  const addSimple = (prop: DatabaseProperty) => {
    setAdding(null);
    setSimple([...simple, newFilter(prop, data)]);
    setFocus(simple.length);
  };
  const openAdvanced = () => {
    setAdding(null);
    const first = data.properties.find((p) => p.type !== "button");
    if (!advanced.length && first) onChange({ filters: [newFilter(first, data)] });
    setFocus("advanced");
  };

  return (
    <div className="flex w-full basis-full flex-wrap items-center gap-1.5 pt-1" role="toolbar" aria-label={t("view.filter")}>
      {simple.map((f, i) => {
        const prop = data.properties.find((p) => p.id === f.propertyId);
        if (!prop) return null;
        return (
          <SimpleFilterChip
            key={`${i}-${f.propertyId}`}
            data={data}
            prop={prop}
            filter={f}
            editable={editable}
            open={focus === i}
            onOpen={() => setFocus(i)}
            onClose={() => setFocus(null)}
            onChange={(next) => setSimple(simple.map((x, j) => (j === i ? next : x)))}
            onDelete={() => {
              setFocus(null);
              setSimple(simple.filter((_, j) => j !== i));
            }}
            onToAdvanced={() => {
              setFocus("advanced");
              onChange({ simpleFilters: simple.filter((_, j) => j !== i), filters: [...advanced, f] });
            }}
          />
        );
      })}
      {advanced.length > 0 && (
        <AdvancedFilterChip
          data={data}
          config={config}
          editable={editable}
          open={focus === "advanced"}
          onOpen={() => setFocus("advanced")}
          onClose={() => setFocus(null)}
          onChange={onChange}
        />
      )}
      {editable && (
        <button
          onClick={(e) => setAdding(e.currentTarget)}
          className="flex items-center gap-1 rounded-full px-2 py-0.5 text-neutral-500 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <Plus size={14} /> {t("filter.addFilter")}
        </button>
      )}
      {adding && <AddFilterMenu anchor={adding} data={data} config={config} onClose={() => setAdding(null)} onAdd={addSimple} onAdvanced={openAdvanced} />}
    </div>
  );
}

const chipClass = (active: boolean) =>
  `flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 transition-colors duration-150 ${
    active
      ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-300 dark:hover:bg-blue-500/25"
      : "border-neutral-200 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
  }`;

function SimpleFilterChip({
  data,
  prop,
  filter,
  editable,
  open,
  onOpen,
  onClose,
  onChange,
  onDelete,
  onToAdvanced,
}: {
  data: DatabaseData;
  prop: DatabaseProperty;
  filter: ViewFilter;
  editable: boolean;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onChange: (f: ViewFilter) => void;
  onDelete: () => void;
  onToAdvanced: () => void;
}) {
  // State, not a ref: the popover opened right after the chip is added needs the chip in the page.
  const [el, setEl] = useState<HTMLButtonElement | null>(null);
  const kind = filterKind(prop, data);
  const summary = useFilterSummary(prop, kind, filter, data);
  const active = isActiveFilter(filter, data);
  return (
    <>
      <button ref={setEl} disabled={!editable} aria-expanded={open} onClick={() => (open ? onClose() : onOpen())} className={chipClass(active)}>
        <PropertyIcon type={prop.type} />
        <span className="max-w-40 truncate font-medium">{prop.name}</span>
        {summary && <span className="max-w-56 truncate">: {summary}</span>}
        {editable && <ChevronDown size={13} className={`shrink-0 opacity-70 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />}
      </button>
      {open && el && (
        <Popover anchor={el} onClose={onClose} width={kind === "date" && !VALUELESS_OPERATORS.includes(filter.operator) ? 300 : 280}>
          <div className="flex items-center gap-1 px-1 pb-1 text-xs text-neutral-500">
            <span className="max-w-28 truncate font-medium">{prop.name}</span>
            <OperatorPicker kind={kind} value={filter.operator} onChange={(op) => onChange(withOperator(filter, kind, op))} />
            <FilterMoreMenu onDelete={onDelete} onToAdvanced={onToAdvanced} />
          </div>
          {!VALUELESS_OPERATORS.includes(filter.operator) && (
            <div className="px-1 pb-1">
              <FilterValue prop={prop} kind={kind} filter={filter} onChange={(value) => onChange({ ...filter, value })} />
            </div>
          )}
        </Popover>
      )}
    </>
  );
}

/** The condition of a filter, as a small menu like the column name next to it. */
function OperatorPicker({ kind, value, onChange }: { kind: FilterKind; value: FilterOperator; onChange: (op: FilterOperator) => void }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  return (
    <>
      <button
        aria-label={t("filter.condition")}
        aria-haspopup="menu"
        onClick={(e) => setEl(el ? null : e.currentTarget)}
        className="flex min-w-0 items-center gap-0.5 rounded px-1 py-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        <span className="truncate">{operatorLabel(value)}</span>
        <ChevronDown size={12} className="shrink-0" />
      </button>
      {el && (
        <Popover anchor={el} onClose={() => setEl(null)} width={220}>
          <div role="menu">
            {FILTER_OPERATORS_BY_KIND[kind].map((op) => (
              <button
                key={op}
                role="menuitemradio"
                aria-checked={op === value}
                className={`${menuItem} ${op === value ? "bg-neutral-100 dark:bg-neutral-800" : ""}`}
                onClick={() => {
                  setEl(null);
                  if (op !== value) onChange(op);
                }}
              >
                {operatorLabel(op)}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}

function FilterMoreMenu({ onDelete, onToAdvanced }: { onDelete: () => void; onToAdvanced?: () => void }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  return (
    <>
      <button
        aria-label={t("filter.more")}
        onClick={(e) => setEl(el ? null : e.currentTarget)}
        className="ml-auto rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        <MoreHorizontal size={14} />
      </button>
      {el && (
        <Popover anchor={el} onClose={() => setEl(null)} width={220}>
          <button className={`${menuItem} text-red-600`} onClick={onDelete}>
            <Trash2 size={14} /> {t("filter.delete")}
          </button>
          {onToAdvanced && (
            <button className={menuItem} onClick={onToAdvanced}>
              <ListFilter size={14} /> {t("filter.toAdvanced")}
            </button>
          )}
        </Popover>
      )}
    </>
  );
}

/** The column picker of "+ Filter", with the way to the advanced filter at the bottom. */
export function AddFilterMenu({
  anchor,
  data,
  config,
  onClose,
  onAdd,
  onAdvanced,
}: {
  anchor: HTMLElement;
  data: DatabaseData;
  config: ViewConfig;
  onClose: () => void;
  onAdd: (prop: DatabaseProperty) => void;
  onAdvanced: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const used = new Set((config.simpleFilters ?? []).map((f) => f.propertyId));
  const q = norm(query.trim());
  const list = data.properties.filter((p) => p.type !== "button" && !used.has(p.id) && norm(p.name).includes(q));
  const rules = (config.filters ?? []).length;
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowDown") setActive((i) => Math.min(i + 1, list.length - 1));
    else if (e.key === "ArrowUp") setActive((i) => Math.max(i - 1, 0));
    else if (e.key === "Enter" && list[active]) onAdd(list[active]!);
    else return;
    e.preventDefault();
  };
  return (
    <Popover anchor={anchor} onClose={onClose} width={260}>
      <input
        autoFocus
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKey}
        placeholder={t("filter.search")}
        aria-label={t("filter.search")}
        className="mb-1 w-full rounded-md border border-blue-400 bg-transparent px-2 py-1.5 outline-none ring-2 ring-blue-500/20 dark:border-blue-500"
      />
      <div className="max-h-72 overflow-y-auto" role="listbox" aria-label={t("filter.search")}>
        {list.map((p, i) => (
          <button
            key={p.id}
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => setActive(i)}
            onClick={() => onAdd(p)}
            className={`${menuItem} ${i === active ? "bg-neutral-100 dark:bg-neutral-800" : ""}`}
          >
            <span className="text-neutral-500">
              <PropertyIcon type={p.type} />
            </span>
            <span className="truncate">{p.name}</span>
          </button>
        ))}
        {!list.length && <p className="px-2 py-1.5 text-neutral-500">{t("filter.noProperty")}</p>}
      </div>
      <div className="my-1 border-t border-neutral-200 dark:border-neutral-700" />
      <button className={`${menuItem} text-neutral-600 dark:text-neutral-300`} onClick={onAdvanced}>
        <ListFilter size={14} /> {t("filter.advanced")}
        {rules > 0 && <span className="ml-auto text-xs text-neutral-400">{t("filter.rules", { count: rules })}</span>}
      </button>
    </Popover>
  );
}

// ---------- Advanced filter ----------

function AdvancedFilterChip({
  data,
  config,
  editable,
  open,
  onOpen,
  onClose,
  onChange,
}: {
  data: DatabaseData;
  config: ViewConfig;
  editable: boolean;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onChange: (patch: Partial<ViewConfig>) => void;
}) {
  const [el, setEl] = useState<HTMLButtonElement | null>(null);
  const rules = config.filters ?? [];
  const active = rules.some((f) => isActiveFilter(f, data));
  return (
    <>
      <button ref={setEl} disabled={!editable} aria-expanded={open} onClick={() => (open ? onClose() : onOpen())} className={chipClass(active)}>
        <ListFilter size={14} />
        <span className="font-medium">{t("filter.rules", { count: rules.length })}</span>
        {editable && <ChevronDown size={13} className={`shrink-0 opacity-70 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />}
      </button>
      {open && el && (
        <Popover anchor={el} onClose={onClose} width={600}>
          <AdvancedFilterEditor
            data={data}
            config={config}
            onChange={onChange}
            onDeleteAll={() => {
              onClose();
              onChange({ filters: [], filterMode: undefined });
            }}
          />
        </Popover>
      )}
    </>
  );
}

function AdvancedFilterEditor({
  data,
  config,
  onChange,
  onDeleteAll,
}: {
  data: DatabaseData;
  config: ViewConfig;
  onChange: (patch: Partial<ViewConfig>) => void;
  onDeleteAll: () => void;
}) {
  const filters = config.filters ?? [];
  const mode = config.filterMode ?? "and";
  const properties = data.properties.filter((p) => p.type !== "button");
  const setFilters = (next: ViewFilter[]) => onChange({ filters: next });
  const replace = (i: number, next: ViewFilter) => setFilters(filters.map((f, j) => (j === i ? next : f)));

  return (
    <div className="space-y-1.5 p-1">
      <div className="px-1 text-xs font-medium text-neutral-500">{t("filter.advanced")}</div>
      {!filters.length && <p className="px-1 text-neutral-500">{t("filter.none")}</p>}
      {filters.map((f, i) => {
        const prop = data.properties.find((p) => p.id === f.propertyId);
        const kind = prop ? filterKind(prop, data) : "text";
        return (
          <div key={i} role="group" aria-label={t("filter.number", { n: i + 1 })} className="flex items-center gap-1.5">
            <div className="w-14 shrink-0 text-right text-neutral-500">
              {i === 0 ? (
                t("filter.where")
              ) : i === 1 ? (
                <select
                  aria-label={t("filter.combination")}
                  value={mode}
                  onChange={(e) => onChange({ filterMode: e.target.value as "and" | "or" })}
                  className={`${control} w-14`}
                >
                  <option value="and">{t("filter.and")}</option>
                  <option value="or">{t("filter.or")}</option>
                </select>
              ) : mode === "and" ? (
                t("filter.and")
              ) : (
                t("filter.or")
              )}
            </div>
            <select
              aria-label={t("rollup.property")}
              value={f.propertyId}
              onChange={(e) =>
                replace(
                  i,
                  newFilter(
                    data.properties.find((x) => x.id === e.target.value)!,
                    data,
                  ),
                )
              }
              className={`${control} w-36 min-w-0`}
            >
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              aria-label={t("filter.condition")}
              value={f.operator}
              onChange={(e) => replace(i, withOperator(f, kind, e.target.value as FilterOperator))}
              className={`${control} w-40`}
            >
              {FILTER_OPERATORS_BY_KIND[kind].map((op) => (
                <option key={op} value={op}>
                  {operatorLabel(op)}
                </option>
              ))}
            </select>
            <div className="min-w-0 flex-1">
              {prop && !VALUELESS_OPERATORS.includes(f.operator) && (
                <FilterValue compact prop={prop} kind={kind} filter={f} onChange={(value) => replace(i, { ...f, value })} />
              )}
            </div>
            <button
              aria-label={t("filter.remove")}
              onClick={() => setFilters(filters.filter((_, j) => j !== i))}
              className="rounded p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
      <div className="flex items-center">
        <button
          className="flex items-center gap-1 rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          onClick={() => properties[0] && setFilters([...filters, newFilter(properties[0], data)])}
        >
          <Plus size={14} /> {t("filter.addRule")}
        </button>
        {filters.length > 0 && (
          <button
            className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100 hover:text-red-600 dark:hover:bg-neutral-800"
            onClick={onDeleteAll}
          >
            <Trash2 size={14} /> {t("filter.deleteAdvanced")}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- Values ----------

/** Text typed in a filter, saved after a short pause so each key press doesn't save the view. */
function DebouncedInput({ value, onChange, numeric }: { value: string; onChange: (v: string | number | null) => void; numeric?: boolean }) {
  const [text, setText] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const commit = (s: string) => {
    if (!numeric) return onChange(s);
    const n = parseNumberInput(s);
    onChange(n === null || Number.isNaN(n) ? null : n);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <input
      autoFocus
      aria-label={t("filter.value")}
      inputMode={numeric ? "decimal" : undefined}
      value={text}
      placeholder={t("filter.valuePlaceholder")}
      onChange={(e) => {
        setText(e.target.value);
        clearTimeout(timer.current);
        const v = e.target.value;
        timer.current = setTimeout(() => commit(v), 350);
      }}
      onBlur={() => {
        clearTimeout(timer.current);
        commit(text);
      }}
      className={`${control} w-full`}
    />
  );
}

function FilterValue({
  prop,
  kind,
  filter,
  onChange,
  compact,
}: {
  prop: DatabaseProperty;
  kind: FilterKind;
  filter: ViewFilter;
  onChange: (v: string | number | null) => void;
  /** In a row of the advanced filter: no calendar. */
  compact?: boolean;
}) {
  const users = useUserDirectory();
  const value = filter.value ?? "";
  const select = (options: { value: string; label: string }[]) => (
    <select aria-label={t("filter.value")} value={String(value)} onChange={(e) => onChange(e.target.value || null)} className={`${control} w-full`}>
      <option value="">{t("common.choose")}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );

  if (kind === "select" || kind === "multi_select") return select(orderedOptions(prop).map((o) => ({ value: o.id, label: o.name })));
  if (kind === "people") return select([{ value: "me", label: t("filter.me") }, ...(users.data ?? []).map((u) => ({ value: u.id, label: u.name }))]);
  if (kind === "date") {
    if (filter.operator === "within") return <RelativeDateValue value={filter.value} onChange={onChange} compact={compact} />;
    if (filter.operator === "between") return <DateRangeValue value={filter.value} onChange={onChange} compact={compact} />;
    return <SingleDateValue value={filter.value} onChange={onChange} compact={compact} />;
  }
  return <DebouncedInput key={filter.propertyId} value={String(value)} numeric={kind === "number"} onChange={onChange} />;
}

/** "Is", "is before"…: a day, or a day that moves with today (tomorrow, a week ago…). */
function SingleDateValue({ value, onChange, compact }: { value: ViewFilter["value"]; onChange: (v: string | null) => void; compact?: boolean }) {
  const relative = isRelativeDate(value);
  const day = isDay(value) ? value : null;
  const today = localDay(new Date());
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1">
        <select
          aria-label={t("filter.value")}
          value={relative ? String(value) : day ? "exact" : ""}
          onChange={(e) => onChange(e.target.value === "exact" ? (day ?? today) : e.target.value || null)}
          className={`${control} min-w-0 flex-1`}
        >
          {!relative && !day && <option value="">{t("common.choose")}</option>}
          {RELATIVE_DATES.map((r) => (
            <option key={r} value={r}>
              {relativeDateLabel(r)}
            </option>
          ))}
          <option value="exact">{t("filter.exactDate")}</option>
        </select>
        {compact && day && (
          <input
            type="date"
            aria-label={t("filter.exactDate")}
            value={day}
            onChange={(e) => onChange(e.target.value || null)}
            className={`${control} min-w-0 flex-1`}
          />
        )}
      </div>
      {!compact && <MiniCalendar key={relative ? String(value) : "exact"} start={relative ? resolveRelativeDay(String(value)) : day} onPick={onChange} />}
    </div>
  );
}

function resolveRelativeDay(value: string): string {
  const now = new Date();
  const shift = (days: number, months = 0) => localDay(new Date(now.getFullYear(), now.getMonth() + months, now.getDate() + days));
  switch (value) {
    case "tomorrow":
      return shift(1);
    case "yesterday":
      return shift(-1);
    case "one_week_ago":
      return shift(-7);
    case "one_week_from_now":
      return shift(7);
    case "one_month_ago":
      return shift(0, -1);
    case "one_month_from_now":
      return shift(0, 1);
    default:
      return shift(0);
  }
}

/** "Is between": a first day, then a last day, picked on the calendar (or typed). */
function DateRangeValue({ value, onChange, compact }: { value: ViewFilter["value"]; onChange: (v: string | null) => void; compact?: boolean }) {
  const [start, end] = rangeParts(value);
  const set = (a: string | null, b: string | null) => onChange(a && b ? formatDateRange(a, b) : a || b ? `${a ?? b}/` : null);
  if (compact)
    return (
      <div className="flex items-center gap-1">
        <input
          type="date"
          aria-label={t("filter.start")}
          value={isDay(start) ? start : ""}
          onChange={(e) => set(e.target.value || null, end)}
          className={`${control} min-w-0 flex-1`}
        />
        <span className="text-neutral-400">→</span>
        <input
          type="date"
          aria-label={t("filter.end")}
          value={isDay(end) ? end : ""}
          onChange={(e) => set(start, e.target.value || null)}
          className={`${control} min-w-0 flex-1`}
        />
      </div>
    );
  const picking = !start || !!end ? "start" : "end";
  const field = (label: string, day: string | null, on: boolean) => (
    <div
      className={`min-w-0 flex-1 rounded-md border px-2 py-1 transition-colors duration-150 ${
        on ? "border-blue-400 ring-2 ring-blue-500/20 dark:border-blue-500" : "border-neutral-200 dark:border-neutral-700"
      }`}
    >
      <div className="text-[10px] uppercase tracking-wide text-neutral-400">{label}</div>
      <div className={`truncate ${day ? "" : "text-neutral-400"}`}>{day ? dateLabel(day) : "—"}</div>
    </div>
  );
  return (
    <div className="space-y-1.5">
      <div className="flex items-stretch gap-1.5">
        {field(t("filter.start"), start, picking === "start")}
        {field(t("filter.end"), end, picking === "end")}
      </div>
      <MiniCalendar
        start={start && isDay(start) ? start : start ? resolveRelativeDay(start) : null}
        end={end && isDay(end) ? end : end ? resolveRelativeDay(end) : null}
        range
        onPick={(day) => (picking === "start" ? onChange(`${day}/`) : set(start, day))}
      />
      <p className="px-0.5 text-xs text-neutral-500" aria-live="polite">
        {picking === "start" ? t("filter.pickStart") : t("filter.pickEnd")}
      </p>
    </div>
  );
}

/** "Is relative to today": this week, the past 7 days, the next 2 months… */
function RelativeDateValue({ value, onChange, compact }: { value: ViewFilter["value"]; onChange: (v: string) => void; compact?: boolean }) {
  const period = parseRelativePeriod(value) ?? { direction: "this", count: 1, unit: "week" };
  const set = (patch: Partial<RelativePeriod>) => onChange(formatRelativePeriod({ ...period, ...patch }));
  const [countText, setCountText] = useState(String(period.count));
  const bounds = relativePeriodBounds(formatRelativePeriod(period));
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1">
        <select
          aria-label={t("filter.dirLabel")}
          value={period.direction}
          onChange={(e) => set({ direction: e.target.value as RelativePeriod["direction"] })}
          className={`${control} min-w-0 flex-1 font-medium`}
        >
          {RELATIVE_DIRECTIONS.map((d) => (
            <option key={d} value={d}>
              {t(`filter.dir.${d}` as MessageKey)}
            </option>
          ))}
        </select>
        {period.direction !== "this" && (
          <input
            type="number"
            min={1}
            max={999}
            inputMode="numeric"
            aria-label={t("filter.count")}
            value={countText}
            onChange={(e) => {
              setCountText(e.target.value);
              const n = Math.round(Number(e.target.value));
              if (n >= 1 && n <= 999) set({ count: n });
            }}
            onBlur={() => setCountText(String(period.count))}
            className={`${control} w-14`}
          />
        )}
        <select
          aria-label={t("filter.unitLabel")}
          value={period.unit}
          onChange={(e) => set({ unit: e.target.value as RelativePeriod["unit"] })}
          className={`${control} min-w-0 flex-1`}
        >
          {RELATIVE_UNITS.map((u) => (
            <option key={u} value={u}>
              {t(`filter.unit.${u}` as MessageKey, { count: period.direction === "this" ? 1 : period.count })}
            </option>
          ))}
        </select>
      </div>
      {!compact && bounds && (
        <>
          <MiniCalendar key={formatRelativePeriod(period)} start={bounds[0]} end={bounds[1]} range />
          <p className="border-t border-neutral-200 px-0.5 pt-1.5 text-xs text-neutral-500 dark:border-neutral-700">{t("filter.followsToday")}</p>
        </>
      )}
    </div>
  );
}

// ---------- Calendar ----------

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A month of days, Monday first. Shows a day or a range; picks days when onPick is given. */
function MiniCalendar({ start, end, range, onPick }: { start?: string | null; end?: string | null; range?: boolean; onPick?: (day: string) => void }) {
  const today = localDay(new Date());
  const [month, setMonth] = useState(() => (start ?? today).slice(0, 7));
  const [slide, setSlide] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const first = new Date(y, m - 1, 1);
  const offset = (first.getDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, i) => localDay(new Date(y, m - 1, 1 - offset + i)));
  const go = (delta: number) => {
    setSlide(delta);
    setMonth(localDay(new Date(y, m - 1 + delta, 1)).slice(0, 7));
  };
  // While the end of a range is being picked, the hovered day previews it.
  const previewEnd = range && start && !end && onPick ? hover : null;
  const lastDay = end ?? previewEnd;
  const [lo, hi] = start && lastDay ? ([start, lastDay].sort() as [string, string]) : [start ?? null, start ?? null];
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    capitalize(new Date(2024, 0, 1 + i).toLocaleDateString(intlLocale(), { weekday: "short" }).replace(".", "").slice(0, 2)),
  );

  return (
    <div className="select-none" onMouseLeave={() => setHover(null)}>
      <div className="flex items-center justify-between px-1 py-1">
        <span className="font-semibold">{capitalize(first.toLocaleDateString(intlLocale(), { month: "short", year: "numeric" }).replace(".", ""))}</span>
        <div className="flex items-center gap-0.5 text-neutral-500">
          <button aria-label={t("filter.prevMonth")} onClick={() => go(-1)} className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
            <ChevronLeft size={15} />
          </button>
          <button aria-label={t("filter.nextMonth")} onClick={() => go(1)} className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center text-xs text-neutral-400">
        {weekdays.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>
      <div key={month} className="nt-slide grid grid-cols-7 gap-y-0.5 text-center" style={{ "--nt-slide": `${slide * 14}px` } as CSSProperties}>
        {days.map((d) => {
          const inMonth = d.slice(0, 7) === month;
          const edge = d === lo || d === hi;
          const inside = !!lo && !!hi && d > lo && d < hi;
          const band = !!lo && !!hi && lo !== hi && (inside || edge);
          return (
            <div
              key={d}
              className={`${band ? "bg-blue-50 dark:bg-blue-500/15" : ""} ${band && d === lo ? "rounded-l-md" : ""} ${band && d === hi ? "rounded-r-md" : ""}`}
            >
              <button
                type="button"
                disabled={!onPick}
                aria-label={formatDateString(d)}
                aria-pressed={edge}
                onClick={() => onPick?.(d)}
                onMouseEnter={() => setHover(d)}
                className={`h-8 w-full rounded-md text-sm transition-colors duration-100 ${
                  edge
                    ? "bg-blue-600 font-medium text-white"
                    : `${inMonth ? "" : "text-neutral-400 dark:text-neutral-600"} ${d === today ? "font-semibold text-blue-600 dark:text-blue-400" : ""} ${onPick ? "hover:bg-neutral-100 dark:hover:bg-neutral-800" : ""}`
                } ${onPick ? "cursor-pointer" : "cursor-default"}`}
              >
                {Number(d.slice(8))}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
