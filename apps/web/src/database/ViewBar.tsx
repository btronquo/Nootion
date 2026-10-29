import { useEffect, useRef, useState } from "react";
import {
  ArrowUpDown,
  Copy,
  Download,
  Eye,
  EyeOff,
  ListFilter,
  MoreHorizontal,
  Plus,
  Rows3,
  SquareKanban,
  Table2,
  List,
  LayoutGrid,
  CalendarDays,
  GanttChart,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  t,
  type MessageKey,
  DATE_PERIODS,
  FILTER_OPERATORS_BY_KIND,
  RELATIVE_DATES,
  VALUELESS_OPERATORS,
  canGroupBy,
  calendarDateProp,
  VIEW_TYPES,
  filterKind,
  isActiveFilter,
  type DatabaseData,
  type DatabaseProperty,
  type DatabaseViewInfo,
  type FilterOperator,
  type ViewConfig,
  type ViewFilter,
  type ViewSort,
  type ViewType,
} from "@nootion/shared";
import { Popover } from "./Popover";
import { PropertyIcon } from "./icons";
import { parseNumberInput } from "./format";
import { orderedColumns } from "./DatabaseTable";
import { boardGroupProp } from "./BoardView";
import type { useDatabaseActions } from "./hooks";
import { useUserDirectory } from "../lib/queries";
import { api } from "../lib/api";

type Actions = ReturnType<typeof useDatabaseActions>;

export const viewTypeLabel = (type: ViewType) => t(`view.${type}` as MessageKey);

const VIEW_ICONS: Record<ViewType, typeof Table2> = { table: Table2, board: SquareKanban, list: List, gallery: LayoutGrid, calendar: CalendarDays, timeline: GanttChart };
const DATE_TYPES = ["date", "created_time", "last_edited_time"];

export function ViewIcon({ type, size = 14 }: { type: ViewType; size?: number }) {
  const Icon = VIEW_ICONS[type] ?? Table2;
  return <Icon size={size} className="shrink-0" />;
}

const operatorLabel = (key: string) => t(`filter.op.${key}` as MessageKey);

const relativeLabel = (key: string) => t(`filter.relative.${key}` as MessageKey);
const periodLabel = (key: string) => t(`filter.period.${key}` as MessageKey);

const control =
  "rounded border border-neutral-200 bg-transparent px-1.5 py-1 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900";
const menuItem = "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800";

/** View tabs, and the buttons that set the filters, sorts, groups and visible properties of the current view. */
export function ViewBar({
  data,
  view,
  onSelect,
  actions,
  editable,
}: {
  data: DatabaseData;
  view: DatabaseViewInfo;
  onSelect: (viewId: string) => void;
  actions?: Actions;
  editable: boolean;
}) {
  const [menu, setMenu] = useState<{ kind: "view" | "add" | "filter" | "sort" | "group" | "date" | "props" | "more"; anchor: HTMLElement } | null>(null);
  const close = () => setMenu(null);
  const config = view.config;
  const save = (patch: Partial<ViewConfig>) => actions?.updateView.mutate({ viewId: view.id, config: { ...config, ...patch } });
  const activeFilters = (config.filters ?? []).filter((f) => isActiveFilter(f, data)).length;
  const sorts = (config.sorts ?? []).filter((s) => data.properties.some((p) => p.id === s.propertyId)).length;
  const groupProp = view.type === "board" ? boardGroupProp(data, view) : data.properties.find((p) => p.id === config.groupBy);
  const dateProp = view.type === "calendar" || view.type === "timeline" ? calendarDateProp(data.properties, config.dateProperty) : undefined;
  const tool = (on: boolean) =>
    `flex items-center gap-1 rounded px-1.5 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 ${on ? "text-blue-600 dark:text-blue-400" : "text-neutral-500"}`;

  // Only one tab row when there is a single view and nothing to configure.
  if (!actions && data.views.length < 2) return null;

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-neutral-200 pb-1 text-sm dark:border-neutral-800">
      <div role="tablist" aria-label={t("view.tabs")} className="flex min-w-0 flex-wrap items-center gap-0.5">
        {data.views.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={v.id === view.id}
            onClick={(e) => (v.id === view.id ? editable && setMenu({ kind: "view", anchor: e.currentTarget }) : onSelect(v.id))}
            className={`flex items-center gap-1.5 rounded px-2 py-1 ${v.id === view.id ? "bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100" : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
          >
            <ViewIcon type={v.type} /> <span className="max-w-40 truncate">{v.name}</span>
          </button>
        ))}
        {editable && (
          <button
            aria-label={t("view.add")}
            onClick={(e) => setMenu({ kind: "add", anchor: e.currentTarget })}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <Plus size={16} />
          </button>
        )}
      </div>
      {actions && (
        <div className="ml-auto flex items-center gap-0.5">
          {editable && (
            <>
              <button className={tool(activeFilters > 0)} onClick={(e) => setMenu({ kind: "filter", anchor: e.currentTarget })}>
                <ListFilter size={14} /> {t("view.filter")}{activeFilters > 0 && ` (${activeFilters})`}
              </button>
              <button className={tool(sorts > 0)} onClick={(e) => setMenu({ kind: "sort", anchor: e.currentTarget })}>
                <ArrowUpDown size={14} /> {t("view.sort")}{sorts > 0 && ` (${sorts})`}
              </button>
              {(view.type === "table" || view.type === "board") && (
                <button className={tool(!!groupProp && view.type === "table")} onClick={(e) => setMenu({ kind: "group", anchor: e.currentTarget })}>
                  <Rows3 size={14} /> {view.type === "board" ? t("view.columns") : t("view.group")}
                </button>
              )}
              {(view.type === "calendar" || view.type === "timeline") && (
                <button className={tool(false)} onClick={(e) => setMenu({ kind: "date", anchor: e.currentTarget })}>
                  <CalendarDays size={14} /> {dateProp?.name ?? t("view.dateProperty")}
                </button>
              )}
              <button className={tool(false)} onClick={(e) => setMenu({ kind: "props", anchor: e.currentTarget })}>
                <Eye size={14} /> {t("row.properties")}
              </button>
            </>
          )}
          <button aria-label={t("view.exportImport")} className={tool(false)} onClick={(e) => setMenu({ kind: "more", anchor: e.currentTarget })}>
            <MoreHorizontal size={16} />
          </button>
        </div>
      )}
      {menu?.kind === "more" && actions && (
        <Popover anchor={menu.anchor} onClose={close} width={260}>
          <a className={menuItem} href={`/api/databases/${data.id}/export?viewId=${view.id}`} download onClick={close}>
            <Download size={14} /> {t("view.exportCsv")}
          </a>
          <a className={menuItem} href={`/api/databases/${data.id}/export?viewId=${view.id}&sep=semicolon`} download onClick={close}>
            <Download size={14} /> {t("view.exportExcel")}
          </a>
          <a className={menuItem} href={`/api/databases/${data.id}/export?format=json`} download onClick={close}>
            <Download size={14} /> {t("view.exportJson")}
          </a>
          {editable && (
            <button
              className={menuItem}
              onClick={() => {
                close();
                void importCsv(data.id).then((done) => {
                  if (done) void actions.refresh();
                });
              }}
            >
              <Upload size={14} /> {t("view.importCsv")}
            </button>
          )}
        </Popover>
      )}

      {menu?.kind === "view" && actions && (
        <Popover anchor={menu.anchor} onClose={close} width={240}>
          <ViewMenu view={view} canDelete={data.views.length > 1} actions={actions} onDuplicated={onSelect} onClose={close} />
        </Popover>
      )}
      {menu?.kind === "add" && actions && (
        <Popover anchor={menu.anchor} onClose={close} width={200}>
          <div className="px-2 py-1 text-xs text-neutral-500">{t("view.new")}</div>
          {VIEW_TYPES.map((type) => (
            <button
              key={type}
              className={menuItem}
              onClick={async () => {
                close();
                const count = data.views.filter((v) => v.type === type).length;
                const name = count ? `${viewTypeLabel(type)} ${count + 1}` : viewTypeLabel(type);
                const { view: created } = await actions.createView.mutateAsync({ name, type });
                onSelect(created.id);
              }}
            >
              <ViewIcon type={type} /> {viewTypeLabel(type)}
            </button>
          ))}
        </Popover>
      )}
      {menu?.kind === "filter" && (
        <Popover anchor={menu.anchor} onClose={close} width={560}>
          <FilterEditor data={data} config={config} onChange={save} />
        </Popover>
      )}
      {menu?.kind === "sort" && (
        <Popover anchor={menu.anchor} onClose={close} width={380}>
          <SortEditor properties={data.properties} sorts={config.sorts ?? []} onChange={(sorts) => save({ sorts })} />
        </Popover>
      )}
      {menu?.kind === "group" && (
        <Popover anchor={menu.anchor} onClose={close} width={240}>
          <div className="px-2 py-1 text-xs text-neutral-500">{view.type === "board" ? t("view.columnPerValue") : t("view.groupBy")}</div>
          <div className="max-h-72 overflow-y-auto">
            {view.type === "table" && (
              <button className={menuItem} onClick={() => (save({ groupBy: null, collapsedGroups: [] }), close())}>
                <span className="w-3.5" /> {t("calc.none")} {!groupProp && <span className="ml-auto text-blue-600">✓</span>}
              </button>
            )}
            {data.properties
              .filter((p) => canGroupBy(p.type))
              .map((p) => (
                <button key={p.id} className={menuItem} onClick={() => (save({ groupBy: p.id, collapsedGroups: [] }), close())}>
                  <PropertyIcon type={p.type} /> <span className="truncate">{p.name}</span>
                  {groupProp?.id === p.id && <span className="ml-auto text-blue-600">✓</span>}
                </button>
              ))}
          </div>
        </Popover>
      )}
      {menu?.kind === "date" && (
        <Popover anchor={menu.anchor} onClose={close} width={240}>
          <div className="px-2 py-1 text-xs text-neutral-500">{t("view.calendarBy")}</div>
          {data.properties
            .filter((p) => DATE_TYPES.includes(p.type))
            .map((p) => (
              <button key={p.id} className={menuItem} onClick={() => (save({ dateProperty: p.id }), close())}>
                <PropertyIcon type={p.type} /> <span className="truncate">{p.name}</span>
                {dateProp?.id === p.id && <span className="ml-auto text-blue-600">✓</span>}
              </button>
            ))}
        </Popover>
      )}
      {menu?.kind === "props" && (
        <Popover anchor={menu.anchor} onClose={close} width={260}>
          {view.type === "gallery" && (
            <label className={`${menuItem} cursor-pointer`}>
              <input type="checkbox" className="accent-blue-600" checked={config.showPreview !== false} onChange={(e) => save({ showPreview: e.target.checked })} />
              {t("view.showPreview")}
            </label>
          )}
          <div className="px-2 py-1 text-xs text-neutral-500">{t("view.shownProperties")}</div>
          <div className="max-h-80 overflow-y-auto">
            {orderedColumns(data.properties, config.columns)
              .filter((c) => c.prop.type !== "title")
              .map((c, _, all) => (
                <button
                  key={c.prop.id}
                  className={menuItem}
                  onClick={() => save({ columns: all.map((x) => (x.prop.id === c.prop.id ? { ...x.col, hidden: !x.col.hidden } : x.col)) })}
                >
                  <PropertyIcon type={c.prop.type} /> <span className="truncate">{c.prop.name}</span>
                  <span className="ml-auto text-neutral-400" aria-label={c.col.hidden ? t("view.hidden") : t("view.shown")}>
                    {c.col.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                  </span>
                </button>
              ))}
          </div>
        </Popover>
      )}
    </div>
  );
}

function ViewMenu({
  view,
  canDelete,
  actions,
  onDuplicated,
  onClose,
}: {
  view: DatabaseViewInfo;
  canDelete: boolean;
  actions: Actions;
  onDuplicated: (id: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(view.name);
  const rename = () => name.trim() && name.trim() !== view.name && actions.updateView.mutate({ viewId: view.id, name: name.trim() });
  return (
    <div>
      <input
        autoFocus
        aria-label={t("view.name")}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={rename}
        onKeyDown={(e) => e.key === "Enter" && (rename(), onClose())}
        className={`${control} mb-1 w-full`}
      />
      <div className="px-2 py-1 text-xs text-neutral-500">{t("view.layout")}</div>
      {VIEW_TYPES.map((type) => (
        <button key={type} className={menuItem} onClick={() => actions.updateView.mutate({ viewId: view.id, type })}>
          <ViewIcon type={type} /> {viewTypeLabel(type)}
          {view.type === type && <span className="ml-auto text-blue-600">✓</span>}
        </button>
      ))}
      <div className="my-1 border-t border-neutral-200 dark:border-neutral-700" />
      <button
        className={menuItem}
        onClick={async () => {
          onClose();
          const { view: copy } = await actions.createView.mutateAsync({ name: t("view.copyName", { name: view.name }), type: view.type, duplicateOf: view.id });
          onDuplicated(copy.id);
        }}
      >
        <Copy size={14} /> {t("view.duplicate")}
      </button>
      {canDelete && (
        <button
          className={`${menuItem} text-red-600`}
          onClick={() => {
            if (!confirm(t("view.confirmDelete", { name: view.name }))) return;
            actions.deleteView.mutate(view.id);
            onClose();
          }}
        >
          <Trash2 size={14} /> {t("view.delete")}
        </button>
      )}
    </div>
  );
}

function PropertySelect({
  properties,
  value,
  onChange,
  filter,
}: {
  properties: DatabaseProperty[];
  value: string;
  onChange: (id: string) => void;
  filter?: (p: DatabaseProperty) => boolean;
}) {
  return (
    <select aria-label={t("rollup.property")} value={value} onChange={(e) => onChange(e.target.value)} className={`${control} w-36 min-w-0`}>
      {properties.filter(filter ?? (() => true)).map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

function FilterEditor({ data, config, onChange }: { data: DatabaseData; config: ViewConfig; onChange: (patch: Partial<ViewConfig>) => void }) {
  const filters = config.filters ?? [];
  const mode = config.filterMode ?? "and";
  const setFilters = (next: ViewFilter[]) => onChange({ filters: next });
  const update = (i: number, patch: Partial<ViewFilter>) => setFilters(filters.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const firstOperator = (p: DatabaseProperty) => FILTER_OPERATORS_BY_KIND[filterKind(p, data)][0]!;

  return (
    <div className="space-y-1.5 p-1">
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
            <PropertySelect
              properties={data.properties}
              value={f.propertyId}
              onChange={(propertyId) => {
                const p = data.properties.find((x) => x.id === propertyId)!;
                update(i, { propertyId, operator: firstOperator(p), value: null });
              }}
            />
            <select
              aria-label={t("filter.condition")}
              value={f.operator}
              onChange={(e) =>
                update(i, {
                  operator: e.target.value as FilterOperator,
                  ...(e.target.value === "within" || f.operator === "within" ? { value: null } : {}),
                })
              }
              className={`${control} w-36`}
            >
              {FILTER_OPERATORS_BY_KIND[kind].map((op) => (
                <option key={op} value={op}>
                  {kind === "date" && op === "is" ? t("filter.isOn") : operatorLabel(op)}
                </option>
              ))}
            </select>
            <div className="min-w-0 flex-1">
              {prop && !VALUELESS_OPERATORS.includes(f.operator) && (
                <FilterValue prop={prop} kind={kind} filter={f} onChange={(value) => update(i, { value })} />
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
      <button
        className="flex items-center gap-1 rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        onClick={() => {
          const p = data.properties[0]!;
          setFilters([...filters, { propertyId: p.id, operator: firstOperator(p), value: null }]);
        }}
      >
        <Plus size={14} /> {t("filter.add")}
      </button>
    </div>
  );
}

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
}: {
  prop: DatabaseProperty;
  kind: string;
  filter: ViewFilter;
  onChange: (v: string | number | null) => void;
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

  if (kind === "select" || kind === "multi_select") return select((prop.config.options ?? []).map((o) => ({ value: o.id, label: o.name })));
  if (kind === "people") return select([{ value: "me", label: t("filter.me") }, ...(users.data ?? []).map((u) => ({ value: u.id, label: u.name }))]);
  if (kind === "date") {
    if (filter.operator === "within") return select(DATE_PERIODS.map((p) => ({ value: p, label: periodLabel(p) })));
    const relative = (RELATIVE_DATES as readonly string[]).includes(String(value));
    return (
      <div className="flex gap-1">
        <select
          aria-label={t("filter.compareDate")}
          value={relative ? String(value) : "exact"}
          onChange={(e) => onChange(e.target.value === "exact" ? new Date().toISOString().slice(0, 10) : e.target.value)}
          className={`${control} min-w-0 flex-1`}
        >
          {!value && <option value="">{t("common.choose")}</option>}
          {RELATIVE_DATES.map((r) => (
            <option key={r} value={r}>
              {relativeLabel(r)}
            </option>
          ))}
          <option value="exact">{t("filter.exactDate")}</option>
        </select>
        {!relative && value !== "" && (
          <input
            type="date"
            aria-label={t("filter.exactDate")}
            value={String(value)}
            onChange={(e) => onChange(e.target.value || null)}
            className={`${control} min-w-0 flex-1`}
          />
        )}
      </div>
    );
  }
  return <DebouncedInput key={filter.propertyId} value={String(value)} numeric={kind === "number"} onChange={onChange} />;
}

function SortEditor({ properties, sorts, onChange }: { properties: DatabaseProperty[]; sorts: ViewSort[]; onChange: (sorts: ViewSort[]) => void }) {
  const sortable = (p: DatabaseProperty) => p.type !== "file";
  const unused = properties.filter((p) => sortable(p) && !sorts.some((s) => s.propertyId === p.id));
  return (
    <div className="space-y-1.5 p-1">
      {!sorts.length && <p className="px-1 text-neutral-500">{t("sort.none")}</p>}
      {sorts.map((s, i) => (
        <div key={i} role="group" aria-label={`Tri ${i + 1}`} className="flex items-center gap-1.5">
          <PropertySelect
            properties={properties}
            filter={sortable}
            value={s.propertyId}
            onChange={(propertyId) => onChange(sorts.map((x, j) => (j === i ? { ...x, propertyId } : x)))}
          />
          <select
            aria-label={t("sort.direction")}
            value={s.direction}
            onChange={(e) => onChange(sorts.map((x, j) => (j === i ? { ...x, direction: e.target.value as "asc" | "desc" } : x)))}
            className={`${control} flex-1`}
          >
            <option value="asc">{t("sort.asc")}</option>
            <option value="desc">{t("sort.desc")}</option>
          </select>
          <button
            aria-label={t("sort.remove")}
            onClick={() => onChange(sorts.filter((_, j) => j !== i))}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <X size={14} />
          </button>
        </div>
      ))}
      {unused.length > 0 && (
        <button
          className="flex items-center gap-1 rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          onClick={() => onChange([...sorts, { propertyId: unused[0]!.id, direction: "asc" }])}
        >
          <Plus size={14} /> {t("sort.add")}
        </button>
      )}
    </div>
  );
}

/** Asks for a CSV file and adds its rows to the database. */
function importCsv(databaseId: string): Promise<boolean> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv,text/plain";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(false);
      try {
        const res = await api<{ imported: number; createdColumns: string[]; ignoredColumns: string[] }>(`/databases/${databaseId}/import`, {
          method: "POST",
          body: { csv: await file.text() },
        });
        const lines = [t("import.done", { count: res.imported })];
        if (res.createdColumns.length) lines.push(t("import.created", { names: res.createdColumns.join(", ") }));
        if (res.ignoredColumns.length) lines.push(t("import.ignored", { names: res.ignoredColumns.join(", ") }));
        alert(lines.join("\n"));
        resolve(true);
      } catch (e) {
        alert(e instanceof Error ? e.message : String(e));
        resolve(false);
      }
    };
    input.click();
  });
}
