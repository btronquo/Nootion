import { useState } from "react";
import {
  ArrowUpDown,
  Copy,
  Download,
  Eye,
  LayoutTemplate,
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
  Zap,
} from "lucide-react";
import {
  t,
  type MessageKey,
  canGroupBy,
  calendarDateProp,
  VIEW_TYPES,
  isActiveFilter,
  type DatabaseData,
  type DatabaseProperty,
  type DatabaseViewInfo,
  type ViewConfig,
  type ViewSort,
  type ViewType,
} from "@nootion/shared";
import { Popover } from "./Popover";
import { TemplatesMenu } from "./TemplatesMenu";
import { AutomationsDialog } from "./Automations";
import { PropertyIcon } from "./icons";
import { AddFilterMenu, FilterBar, newFilter, type FilterFocus } from "./Filters";
import { orderedColumns } from "./DatabaseTable";
import { boardGroupProp } from "./BoardView";
import type { useDatabaseActions } from "./hooks";
import { api } from "../lib/api";

type Actions = ReturnType<typeof useDatabaseActions>;

export const viewTypeLabel = (type: ViewType) => t(`view.${type}` as MessageKey);

const VIEW_ICONS: Record<ViewType, typeof Table2> = { table: Table2, board: SquareKanban, list: List, gallery: LayoutGrid, calendar: CalendarDays, timeline: GanttChart };
const DATE_TYPES = ["date", "created_time", "last_edited_time"];

export function ViewIcon({ type, size = 14 }: { type: ViewType; size?: number }) {
  const Icon = VIEW_ICONS[type] ?? Table2;
  return <Icon size={size} className="shrink-0" />;
}

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
  const [menu, setMenu] = useState<{ kind: "view" | "add" | "filter" | "sort" | "group" | "date" | "props" | "more" | "templates"; anchor: HTMLElement } | null>(null);
  const close = () => setMenu(null);
  const [automations, setAutomations] = useState(false);
  const config = view.config;
  const save = (patch: Partial<ViewConfig>) => actions?.updateView.mutate({ viewId: view.id, config: { ...config, ...patch } });
  // The chip whose popover is open, for the view it belongs to.
  const [focused, setFocused] = useState<{ viewId: string; focus: FilterFocus }>({ viewId: view.id, focus: null });
  const filterFocus = focused.viewId === view.id ? focused.focus : null;
  const setFilterFocus = (focus: FilterFocus) => setFocused({ viewId: view.id, focus });
  const simpleFilters = config.simpleFilters ?? [];
  const advancedFilters = config.filters ?? [];
  const activeFilters = [...simpleFilters, ...advancedFilters].filter((f) => isActiveFilter(f, data)).length;
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
            data-print-hide
            aria-label={t("view.add")}
            onClick={(e) => setMenu({ kind: "add", anchor: e.currentTarget })}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <Plus size={16} />
          </button>
        )}
      </div>
      {actions && (
        <div className="ml-auto flex items-center gap-0.5" data-print-hide>
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
              <button className={tool(data.templates.length > 0)} onClick={(e) => setMenu({ kind: "templates", anchor: e.currentTarget })}>
                <LayoutTemplate size={14} /> {t("template.button")}
              </button>
              <button className={tool(false)} onClick={() => setAutomations(true)} data-automations-button>
                <Zap size={14} /> {t("automation.button")}
              </button>
            </>
          )}
          <button aria-label={t("view.exportImport")} className={tool(false)} onClick={(e) => setMenu({ kind: "more", anchor: e.currentTarget })}>
            <MoreHorizontal size={16} />
          </button>
        </div>
      )}
      {menu?.kind === "templates" && <TemplatesMenu data={data} anchor={menu.anchor} onClose={close} />}
      {automations && <AutomationsDialog data={data} onClose={() => setAutomations(false)} />}
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
        <AddFilterMenu
          anchor={menu.anchor}
          data={data}
          config={config}
          onClose={close}
          onAdd={(p) => {
            close();
            save({ simpleFilters: [...simpleFilters, newFilter(p, data)] });
            setFilterFocus(simpleFilters.length);
          }}
          onAdvanced={() => {
            close();
            const first = data.properties.find((p) => p.type !== "button");
            if (!advancedFilters.length && first) save({ filters: [newFilter(first, data)] });
            setFilterFocus("advanced");
          }}
        />
      )}
      {actions && (simpleFilters.length > 0 || advancedFilters.length > 0) && (
        <FilterBar data={data} config={config} editable={editable} onChange={save} focus={filterFocus} setFocus={setFilterFocus} />
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
          {view.type === "gallery" && (
            <div className="px-2 py-1.5">
              <div className="mb-1 text-xs text-neutral-500">{t("view.cardSize")}</div>
              <div className="flex rounded-md border border-neutral-200 p-0.5 dark:border-neutral-700" role="radiogroup" aria-label={t("view.cardSize")}>
                {(["small", "medium", "large"] as const).map((size) => (
                  <button
                    key={size}
                    role="radio"
                    aria-checked={(config.cardSize ?? "medium") === size}
                    onClick={() => save({ cardSize: size })}
                    className={`flex-1 rounded px-2 py-1 text-xs ${
                      (config.cardSize ?? "medium") === size
                        ? "bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100"
                        : "text-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                    }`}
                  >
                    {t(size === "small" ? "view.cardSmall" : size === "medium" ? "view.cardMedium" : "view.cardLarge")}
                  </button>
                ))}
              </div>
            </div>
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

function SortEditor({ properties, sorts, onChange }: { properties: DatabaseProperty[]; sorts: ViewSort[]; onChange: (sorts: ViewSort[]) => void }) {
  const sortable = (p: DatabaseProperty) => p.type !== "file" && p.type !== "button";
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
