import { Fragment, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, GripVertical, Maximize2, Plus, Trash2 } from "lucide-react";
import {
  applyView,
  canGroupBy,
  canMoveBetweenGroups,
  groupRows,
  initialValues,
  moveToGroup,
  type DatabaseViewInfo,
  type ViewContext,
  calcLabel,
  t,
  type MessageKey,
  calcFunctionsFor,
  computeCalc,
  formulaCalcInput,
  rollupCalcInput,
  type CalcFunction,
  type CellValue,
  type DatabaseData,
  type DatabaseProperty,
  type DatabaseRow,
  type PropertyType,
  type SelectOption,
  type ViewColumn,
} from "@nootion/shared";
import { Cell } from "./Cell";
import { PropertyMenu } from "./PropertyMenu";
import { PropertyIcon } from "./icons";
import { Popover } from "./Popover";
import { newOption } from "./OptionPicker";
import { formatCalc, numberFormatOf, typeLabel } from "./format";
import { useActiveView, useDatabase, useDatabaseActions, useDatabaseList } from "./hooks";
import { ViewBar } from "./ViewBar";
import { BoardView } from "./BoardView";
import { RowCards } from "./RowCards";
import { GalleryView, ListView } from "./MoreViews";
import { CalendarView } from "./Calendar";
import { TimelineView } from "./TimelineView";
import { useIsMobile } from "../lib/mobile";
import { OptionChip } from "./OptionPicker";
import { useSession } from "../lib/session";
import { pageTitle } from "../lib/tree";
import { CREATABLE_TYPES } from "@nootion/shared";
import { usePluginPropertyTypes } from "../plugins/registry";
import { pageIcon } from "../lib/icons";
import { RowMenu } from "./RowMenu";
import type { MenuAnchor } from "../components/PageMenu";
import { countGroupRows, limitGroups, ShowMoreRows, useShownRows } from "./progressive";

const DEFAULT_WIDTH = 180;
const TITLE_WIDTH = 260;

/** Table view of a database the user is signed in to. */
export function DatabaseTable({ id, compact }: { id: string; compact?: boolean }) {
  const db = useDatabase(id);
  const actions = useDatabaseActions(id);
  if (db.isLoading) return <div className="py-4 text-sm text-neutral-400">{t("common.loading")}</div>;
  if (db.isError || !db.data) return <div className="py-4 text-sm text-neutral-500">{t("database.notFound")}</div>;
  return <DatabaseViews data={db.data} actions={actions} compact={compact} rowHref={(r) => `/page/${r.id}`} />;
}

type Actions = ReturnType<typeof useDatabaseActions>;

interface ViewProps {
  data: DatabaseData;
  /** Absent: read-only (public page). */
  actions?: Actions;
  compact?: boolean;
  rowHref: (row: DatabaseRow) => string;
  fileUrl?: (id: string) => string;
}

/** A database with its view tabs: the chosen view filters, sorts and groups the rows, as a table or a board. */
export function DatabaseViews(props: ViewProps) {
  const { data, actions } = props;
  const [view, select] = useActiveView(data.id, data.views);
  const editable = !!actions && (data.role === "editor" || data.role === "full");
  const me = useSession().user?.id ?? null;
  const ctx: ViewContext = useMemo(() => ({ ...data, me }), [data, me]);
  const rows = useMemo(() => applyView(ctx, view?.config ?? {}), [ctx, view?.config]);
  return (
    <div>
      {view && <ViewBar data={data} view={view} onSelect={select} actions={actions} editable={editable} />}
      {view?.type === "board" ? (
        <div className="pt-2">
          <BoardView {...props} view={view} ctx={ctx} rows={rows} editable={editable} />
        </div>
      ) : view?.type === "list" ? (
        <div className="pt-1">
          <ListView {...props} view={view} ctx={ctx} rows={rows} editable={editable} />
        </div>
      ) : view?.type === "gallery" ? (
        <div className="pt-3">
          <GalleryView {...props} view={view} ctx={ctx} rows={rows} editable={editable} />
        </div>
      ) : view?.type === "timeline" ? (
        <div className="pt-2">
          <TimelineView {...props} view={view} ctx={ctx} rows={rows} editable={editable} />
        </div>
      ) : view?.type === "calendar" ? (
        <div className="pt-2">
          <CalendarView {...props} view={view} ctx={ctx} rows={rows} editable={editable} />
        </div>
      ) : (
        <TableView {...props} view={view} ctx={ctx} rows={rows} />
      )}
    </div>
  );
}

/** Orders the properties by the view settings; properties missing from the view come last. */
export function orderedColumns(properties: DatabaseProperty[], columns: ViewColumn[] = []) {
  const byId = new Map(properties.map((p) => [p.id, p]));
  const out: { prop: DatabaseProperty; col: ViewColumn }[] = [];
  for (const c of columns) {
    const p = byId.get(c.propertyId);
    if (p) {
      out.push({ prop: p, col: c });
      byId.delete(p.id);
    }
  }
  for (const p of byId.values()) out.push({ prop: p, col: { propertyId: p.id } });
  // The title column always comes first.
  return out.sort((a, b) => Number(b.prop.type === "title") - Number(a.prop.type === "title"));
}

export function TableView({
  data,
  actions,
  compact,
  rowHref,
  fileUrl,
  view,
  ctx,
  rows,
}: ViewProps & { view: DatabaseViewInfo | undefined; ctx: ViewContext; rows: DatabaseRow[] }) {
  const editable = !!actions && (data.role === "editor" || data.role === "full");
  const groupProp = data.properties.find((p) => p.id === view?.config.groupBy && canGroupBy(p.type));
  // Empty groups are left out of tables (boards show them, to drop cards in).
  const groups = useMemo(() => (groupProp ? groupRows(groupProp, rows, ctx).filter((g) => g.rows.length) : null), [groupProp, rows, ctx]);
  const collapsed = new Set(view?.config.collapsedGroups ?? []);
  // Thousands of rows: only the first ones are put on the page, the next ones come while scrolling.
  const { limit, more } = useShownRows(`${data.id}|${view?.id}|${groupProp?.id}`);
  const toggleGroup = (key: string) => {
    if (!view || !actions) return;
    const next = collapsed.has(key) ? [...collapsed].filter((k) => k !== key) : [...collapsed, key];
    actions.updateView.mutate({ viewId: view.id, config: { ...view.config, collapsedGroups: next } });
  };
  const addRow = (group?: { prop: DatabaseProperty; key: string }) => actions!.addRow.mutate(initialValues(ctx, view?.config ?? {}, group));
  const columns = useMemo(() => orderedColumns(data.properties, view?.config.columns), [data.properties, view?.config.columns]);
  const visible = columns.filter((c) => !c.col.hidden);
  const hidden = columns.filter((c) => c.col.hidden);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ propId: string; anchor: HTMLElement } | null>(null);
  const [adding, setAdding] = useState<HTMLElement | null>(null);
  const pluginTypes = usePluginPropertyTypes();
  const [addingRelation, setAddingRelation] = useState(false);
  const [calcMenu, setCalcMenu] = useState<{ propId: string; anchor: HTMLElement } | null>(null);
  const [showHidden, setShowHidden] = useState<HTMLElement | null>(null);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const drag = useRef<string | null>(null);
  const mobile = useIsMobile();
  const [rowMenu, setRowMenu] = useState<{ rowId: string; anchor: MenuAnchor } | null>(null);
  const rowDrag = useRef<string | null>(null);
  const [dropAt, setDropAt] = useState<{ rowId: string; before: boolean } | null>(null);
  // Rows keep a manual order; a sorted view shows its own.
  const sorted = (view?.config.sorts ?? []).length > 0;
  const groupOf = useMemo(() => new Map((groups ?? []).flatMap((g) => g.rows.map((r) => [r.id, g.key] as const))), [groups]);

  /** The rows a menu acts on: the selection when the row is part of it, else the row alone. */
  const menuRows = (rowId: string) => (selected.has(rowId) && selected.size > 1 ? data.rows.filter((r) => selected.has(r.id)) : data.rows.filter((r) => r.id === rowId));
  // Rows the open menu acts on, highlighted (worked out once, not for each row).
  const menuTargets = rowMenu ? (selected.has(rowMenu.rowId) && selected.size > 1 ? selected : new Set([rowMenu.rowId])) : null;

  function openRowMenu(e: React.MouseEvent, rowId: string) {
    if (!actions) return;
    // Text being edited keeps the browser's menu (copy, paste, spelling).
    // (Rows of a database inside a page sit in the page's editor, which is itself editable: only the nearest counts.)
    const field = (e.target as HTMLElement).closest<HTMLElement>("input, textarea, [contenteditable]");
    const editing = !!field && (field instanceof HTMLTextAreaElement || (field instanceof HTMLInputElement && field.type !== "checkbox") || field.isContentEditable);
    if (e.type === "contextmenu" && editing) return;
    e.preventDefault();
    setRowMenu({ rowId, anchor: e.type === "contextmenu" ? { x: e.clientX, y: e.clientY } : (e.currentTarget as HTMLElement) });
  }

  /** Adds a row right below another one, in the same group. */
  function addRowBelow(row: DatabaseRow) {
    const key = groupOf.get(row.id);
    const values = initialValues(ctx, view?.config ?? {}, groupProp && key !== undefined && canMoveBetweenGroups(groupProp.type) ? { prop: groupProp, key } : undefined);
    actions!.insertRow.mutate({ values, after: row.id });
  }

  function dropRow(target: DatabaseRow, before: boolean) {
    const rowId = rowDrag.current;
    rowDrag.current = null;
    setDropAt(null);
    if (!rowId || rowId === target.id || !actions) return;
    const order = data.rows.map((r) => r.id).filter((id) => id !== rowId);
    const i = order.indexOf(target.id);
    const after = before ? (i > 0 ? order[i - 1] : null) : target.id;
    actions.moveRow.mutate({ rowId, after });
    // Dropped in another group: it takes that group's value, as on a board.
    const from = groupOf.get(rowId);
    const to = groupOf.get(target.id);
    const moved = data.rows.find((r) => r.id === rowId);
    if (groupProp && moved && from !== undefined && to !== undefined && from !== to && canMoveBetweenGroups(groupProp.type)) {
      actions.updateCell.mutate({ rowId, propId: groupProp.id, value: moveToGroup(groupProp, moved.values[groupProp.id] ?? null, from, to) });
    }
  }

  const widthOf = (c: { prop: DatabaseProperty; col: ViewColumn }) => widths[c.prop.id] ?? c.col.width ?? (c.prop.type === "title" ? TITLE_WIDTH : DEFAULT_WIDTH);

  function saveColumns(next: ViewColumn[]) {
    if (view && actions) actions.updateView.mutate({ viewId: view.id, config: { ...view.config, columns: next } });
  }
  const currentColumns = () => columns.map((c) => ({ ...c.col, width: widths[c.prop.id] ?? c.col.width }));
  const setColumn = (propId: string, patch: Partial<ViewColumn>) => saveColumns(currentColumns().map((c) => (c.propertyId === propId ? { ...c, ...patch } : c)));

  function move(fromId: string, toId: string) {
    if (fromId === toId) return;
    const cols = currentColumns();
    const from = cols.findIndex((c) => c.propertyId === fromId);
    const [c] = cols.splice(from, 1);
    cols.splice(cols.findIndex((x) => x.propertyId === toId), 0, c);
    saveColumns(cols);
  }

  function startResize(e: React.PointerEvent, propId: string, start: number) {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    let w = start;
    const onMove = (ev: PointerEvent) => {
      w = Math.max(80, Math.min(1200, Math.round(start + ev.clientX - x0)));
      setWidths((s) => ({ ...s, [propId]: w }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setColumn(propId, { width: w });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const createOption = (prop: DatabaseProperty) => async (name: string): Promise<SelectOption> => {
    const options = prop.config.options ?? [];
    const o = newOption(name, options);
    await actions!.updateProperty.mutateAsync({ propId: prop.id, config: { ...prop.config, options: [...options, o] } });
    return o;
  };

  const menuProp = menu && data.properties.find((p) => p.id === menu.propId);
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const gutter = editable ? "w-8 shrink-0" : "w-0 shrink-0";

  const renderRow = (row: DatabaseRow) => (
            <div
              key={row.id}
              role="row"
              data-row-id={row.id}
              onContextMenu={(e) => openRowMenu(e, row.id)}
              onDragOver={(e) => {
                if (!rowDrag.current) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                const before = e.clientY < r.top + r.height / 2;
                if (dropAt?.rowId !== row.id || dropAt.before !== before) setDropAt({ rowId: row.id, before });
              }}
              onDrop={(e) => {
                if (!rowDrag.current) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                dropRow(row, e.clientY < r.top + r.height / 2);
              }}
              className={`group relative flex border-b border-neutral-200 dark:border-neutral-800 ${menuTargets?.has(row.id) ? "bg-blue-50/60 dark:bg-blue-950/30" : ""}`}
            >
              {dropAt?.rowId === row.id && <div className={`pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-blue-500 ${dropAt.before ? "-top-px" : "-bottom-px"}`} />}
              {actions && (
                <div className="absolute right-full top-0 flex h-full items-start pr-0.5 pt-1.5 opacity-0 group-hover:opacity-100 has-[:focus-visible]:opacity-100" data-row-handle>
                  {editable && (
                    <button
                      type="button"
                      title={t("table.addRowBelow")}
                      aria-label={t("table.addRowBelow")}
                      onClick={() => addRowBelow(row)}
                      className="flex h-6 w-5 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                    >
                      <Plus size={15} />
                    </button>
                  )}
                  <button
                    type="button"
                    title={editable && sorted ? t("table.rowHandleSorted") : editable ? t("table.rowHandle") : t("rowMenu.label")}
                    aria-label={t("rowMenu.label")}
                    aria-haspopup="menu"
                    draggable={editable && !sorted}
                    onDragStart={(e) => {
                      rowDrag.current = row.id;
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", row.title);
                      const el = e.currentTarget.closest("[role=row]");
                      if (el) e.dataTransfer.setDragImage(el, 40, 16);
                    }}
                    onDragEnd={() => {
                      rowDrag.current = null;
                      setDropAt(null);
                    }}
                    onClick={(e) => openRowMenu(e, row.id)}
                    className={`flex h-6 w-4 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300 ${editable && !sorted ? "cursor-grab active:cursor-grabbing" : ""}`}
                  >
                    <GripVertical size={15} />
                  </button>
                </div>
              )}
              <div className={`${gutter} flex items-center justify-center`}>
                {editable && (
                  <input
                    type="checkbox"
                    aria-label={t("table.selectRow")}
                    className={`h-3.5 w-3.5 accent-blue-600 ${selected.has(row.id) ? "" : "opacity-0 group-hover:opacity-60"}`}
                    checked={selected.has(row.id)}
                    onChange={() =>
                      setSelected((s) => {
                        const n = new Set(s);
                        if (n.has(row.id)) n.delete(row.id);
                        else n.add(row.id);
                        return n;
                      })
                    }
                  />
                )}
              </div>
              {visible.map((c) => (
                <div key={c.prop.id} style={{ width: widthOf(c) }} className="relative shrink-0 border-r border-neutral-200 dark:border-neutral-800">
                  {c.prop.type === "title" && row.icon ? (
                    // The row's page icon, before its title, as in Notion.
                    <div className="flex items-start">
                      <span className="flex h-[34px] shrink-0 items-center pl-2 leading-none [&_img]:h-4 [&_img]:w-4" data-row-icon>
                        {pageIcon(row.icon)}
                      </span>
                      <div className="min-w-0 flex-1">
                      <Cell
                        prop={c.prop}
                        value={c.prop.type === "title" ? row.title : (row.values[c.prop.id] ?? null)}
                        rowId={row.id}
                        databaseId={data.id}
                        people={data.people}
                        editable={editable}
                        fileUrl={fileUrl}
                        related={data.related}
                        rollupTarget={data.rollupTargets[c.prop.id]}
                        rowHref={(id) => rowHref({ id } as DatabaseRow)}
                        onChange={(value: CellValue) => actions?.updateCell.mutate({ rowId: row.id, propId: c.prop.id, value })}
                        onCreateOption={createOption(c.prop)}
                      />
                      </div>
                    </div>
                  ) : (
                    <Cell
                      prop={c.prop}
                      value={c.prop.type === "title" ? row.title : (row.values[c.prop.id] ?? null)}
                      rowId={row.id}
                      databaseId={data.id}
                      people={data.people}
                      editable={editable}
                      fileUrl={fileUrl}
                      related={data.related}
                      rollupTarget={data.rollupTargets[c.prop.id]}
                      rowHref={(id) => rowHref({ id } as DatabaseRow)}
                      onChange={(value: CellValue) => actions?.updateCell.mutate({ rowId: row.id, propId: c.prop.id, value })}
                      onCreateOption={createOption(c.prop)}
                    />
                  )}
                  {c.prop.type === "title" && (
                    <Link
                      to={rowHref(row)}
                      title={t("common.open")}
                      aria-label={t("table.openRow", { title: row.title || t("common.untitled") })}
                      className="absolute right-1 top-1.5 z-[5] flex items-center gap-1 rounded border border-neutral-200 bg-white px-1.5 py-0.5 text-xs text-neutral-500 opacity-0 hover:bg-neutral-100 group-hover:opacity-100 dark:border-neutral-700 dark:bg-neutral-900"
                    >
                      <Maximize2 size={11} /> {t("common.open")}
                    </Link>
                  )}
                </div>
              ))}
            </div>
  );

  const renderCalcs = (calcRows: DatabaseRow[]) =>
    (editable || Object.keys(view?.config.calculations ?? {}).length > 0) && (
            <div role="row" aria-label={t("table.calculations")} className="group/calc flex">
              <div className={gutter} />
              {visible.map((c) => {
                const fn = view?.config.calculations?.[c.prop.id];
                const result = fn ? calcColumn(data, c.prop, fn, calcRows) : null;
                return (
                  <button
                    key={c.prop.id}
                    style={{ width: widthOf(c) }}
                    disabled={!editable}
                    aria-label={t("table.calcOf", { name: c.prop.name })}
                    onClick={(e) => setCalcMenu({ propId: c.prop.id, anchor: e.currentTarget })}
                    className="flex shrink-0 items-center justify-end gap-1 truncate px-2 py-1.5 text-xs text-neutral-500 enabled:hover:bg-neutral-100 dark:enabled:hover:bg-neutral-800"
                  >
                    {fn ? (
                      <>
                        <span className="truncate text-neutral-400">{calcShort(fn)}</span>
                        <span className="font-medium tabular-nums text-neutral-800 dark:text-neutral-200">{result ? formatCalc(result, calcFormatProp(data, c.prop)) : "—"}</span>
                      </>
                    ) : (
                      <span className="opacity-0 group-hover/calc:opacity-100">{t("table.calculate")}</span>
                    )}
                  </button>
                );
              })}
            </div>
          );

  if (mobile) {
    return (
      <RowCards
        data={data}
        actions={actions}
        view={view}
        ctx={ctx}
        rows={rows}
        groups={groups}
        groupProp={groupProp}
        columns={visible}
        editable={editable}
        rowHref={rowHref}
        fileUrl={fileUrl}
      />
    );
  }

  return (
    <div className="text-sm">
      {editable && selected.size > 0 && (
        <div className="mb-1 flex items-center gap-2 text-neutral-600 dark:text-neutral-300">
          <span>{t("table.selected", { count: selected.size })}</span>
          <button
            onClick={() => {
              if (!confirm(t("table.confirmTrash", { count: selected.size }))) return;
              actions!.deleteRows.mutate([...selected]);
              setSelected(new Set());
            }}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
          >
            <Trash2 size={14} /> {t("common.delete")}
          </button>
        </div>
      )}
      {/* The rows' + and ⋮⋮ buttons sit in the margin on the left, as in Notion. */}
      <div className={`thin-scroll overflow-x-auto ${actions ? "-ml-12 pl-12" : ""} ${compact ? "" : "pb-2"}`}>
        <div role="grid" aria-label={data.title || t("common.database")} className="inline-block min-w-full align-top">
          {/* Header */}
          <div role="row" className="flex border-b border-neutral-200 text-neutral-500 dark:border-neutral-800">
            <div className={`${gutter} flex items-center justify-center`}>
              {editable && (
                <input
                  type="checkbox"
                  aria-label={t("table.selectAll")}
                  className="h-3.5 w-3.5 accent-blue-600 opacity-40 hover:opacity-100 checked:opacity-100"
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                />
              )}
            </div>
            {visible.map((c) => (
              <div
                key={c.prop.id}
                role="columnheader"
                style={{ width: widthOf(c) }}
                draggable={editable && c.prop.type !== "title"}
                onDragStart={() => (drag.current = c.prop.id)}
                onDragOver={(e) => editable && drag.current && c.prop.type !== "title" && e.preventDefault()}
                onDrop={() => drag.current && move(drag.current, c.prop.id)}
                onDragEnd={() => (drag.current = null)}
                className="relative shrink-0 border-r border-neutral-200 dark:border-neutral-800"
              >
                <button
                  disabled={!editable}
                  onClick={(e) => setMenu({ propId: c.prop.id, anchor: e.currentTarget })}
                  className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left enabled:hover:bg-neutral-100 dark:enabled:hover:bg-neutral-800"
                >
                  <PropertyIcon type={c.prop.type} size={14} />
                  <span className="truncate">{c.prop.name}</span>
                </button>
                {editable && (
                  <div
                    onPointerDown={(e) => startResize(e, c.prop.id, widthOf(c))}
                    className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-blue-400/40"
                  />
                )}
              </div>
            ))}
            {editable && (
              <button aria-label={t("table.addProperty")} onClick={(e) => setAdding(e.currentTarget)} className="flex w-10 shrink-0 items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-800">
                <Plus size={16} />
              </button>
            )}
            {hidden.length > 0 && (
              <button onClick={(e) => setShowHidden(e.currentTarget)} className="shrink-0 px-2 text-xs hover:text-neutral-800 dark:hover:text-neutral-200">
                {t("table.hidden", { count: hidden.length })}
              </button>
            )}
          </div>

          {groups ? (
            limitGroups(groups, limit, (g) => !collapsed.has(g.key)).map(({ group: g, rows: shownRows }) => {
              const open = !collapsed.has(g.key);
              const cut = shownRows.length < g.rows.length;
              return (
                <Fragment key={g.key}>
                  <div role="row" aria-label={t("table.group", { name: g.label })} className="flex items-center gap-1.5 border-b border-neutral-200 py-1.5 pl-1 dark:border-neutral-800">
                    <button
                      aria-label={open ? t("table.collapseGroup") : t("table.expandGroup")}
                      aria-expanded={open}
                      onClick={() => toggleGroup(g.key)}
                      disabled={!actions}
                      className="sticky left-1 flex items-center gap-1.5 rounded px-1 py-0.5 enabled:hover:bg-neutral-100 dark:enabled:hover:bg-neutral-800"
                    >
                      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      {g.option ? <OptionChip option={g.option} status={groupProp?.type === "status"} /> : <span className="font-medium">{g.label}</span>}
                      <span className="text-xs text-neutral-400">{g.rows.length}</span>
                    </button>
                  </div>
                  {open && shownRows.map(renderRow)}
                  {open && cut && <ShowMoreRows shown={limit} total={countGroupRows(groups, (x) => !collapsed.has(x.key))} onMore={more} className="sticky left-0" />}
                  {open && !cut && editable && canMoveBetweenGroups(groupProp!.type) && (
                    <button
                      onClick={() => addRow({ prop: groupProp!, key: g.key })}
                      className="sticky left-0 flex items-center gap-1.5 px-2 py-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                    >
                      <Plus size={14} /> {t("table.newRow")}
                    </button>
                  )}
                  {open && !cut && renderCalcs(g.rows)}
                </Fragment>
              );
            })
          ) : (
            <>
              {(rows.length > limit ? rows.slice(0, limit) : rows).map(renderRow)}
              <ShowMoreRows shown={Math.min(limit, rows.length)} total={rows.length} onMore={more} className="sticky left-0" />
              {renderCalcs(rows)}
            </>
          )}
          {rows.length === 0 && !editable && <div className="px-3 py-2 text-neutral-400">{t("table.noRows")}</div>}

        </div>
      </div>
      {editable && !(groups && canMoveBetweenGroups(groupProp!.type)) && (
        <button
          onClick={() => addRow()}
          className="flex w-full items-center gap-1.5 px-2 py-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <Plus size={14} /> {t("table.newRow")}
        </button>
      )}
      <div className="px-2 pt-1 text-xs text-neutral-400">
        {rows.length !== data.rows.length ? t("table.countOf", { count: rows.length, total: data.rows.length }) : t("table.count", { count: rows.length })}
      </div>

      {rowMenu && actions && menuRows(rowMenu.rowId).length > 0 && (
        <RowMenu
          data={data}
          rows={menuRows(rowMenu.rowId)}
          anchor={rowMenu.anchor}
          actions={actions}
          editable={editable}
          rowHref={rowHref}
          onClose={() => setRowMenu(null)}
          onDone={() => setSelected(new Set())}
        />
      )}

      {menu && menuProp && actions && (
        <Popover anchor={menu.anchor} onClose={() => setMenu(null)} width={menuProp.type === "formula" ? 420 : 260}>
          <PropertyMenu
            key={menuProp.id}
            prop={menuProp}
            properties={data.properties}
            databaseId={data.id}
            onRename={(name) => actions.updateProperty.mutate({ propId: menuProp.id, name })}
            onChangeType={(type) => actions.updateProperty.mutate({ propId: menuProp.id, type })}
            onChangeConfig={(config) => actions.updateProperty.mutate({ propId: menuProp.id, config })}
            onHide={
              menuProp.type === "title"
                ? undefined
                : () => {
                    setColumn(menuProp.id, { hidden: true });
                    setMenu(null);
                  }
            }
            onDelete={() => {
              actions.deleteProperty.mutate(menuProp.id);
              setMenu(null);
            }}
          />
        </Popover>
      )}

      {calcMenu && view && actions && (
        <Popover anchor={calcMenu.anchor} onClose={() => setCalcMenu(null)} width={240}>
          <div className="max-h-80 overflow-y-auto">
            {[null, ...calcFunctionsFor(calcType(data, data.properties.find((p) => p.id === calcMenu.propId)!))].map((fn) => (
              <button
                key={fn ?? "none"}
                onClick={() => {
                  const calculations = { ...(view.config.calculations ?? {}) };
                  if (fn) calculations[calcMenu.propId] = fn;
                  else delete calculations[calcMenu.propId];
                  actions.updateView.mutate({ viewId: view.id, config: { ...view.config, calculations } });
                  setCalcMenu(null);
                }}
                className="flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                {fn ? calcLabel(fn) : t("calc.none")}
              </button>
            ))}
          </div>
        </Popover>
      )}

      {adding && actions && addingRelation && (
        <Popover
          anchor={adding}
          onClose={() => {
            setAdding(null);
            setAddingRelation(false);
          }}
          width={280}
        >
          <RelationSetup
            data={data}
            onCreate={(databaseId, title, twoWay) => {
              actions.addProperty.mutate({ name: title, type: "relation", config: { databaseId }, twoWay });
              setAdding(null);
              setAddingRelation(false);
            }}
          />
        </Popover>
      )}

      {adding && actions && !addingRelation && (
        <Popover anchor={adding} onClose={() => setAdding(null)} width={220}>
          <div className="max-h-80 overflow-y-auto">
            <div className="px-2 py-1 text-xs text-neutral-500">{t("table.newColumnType")}</div>
            {CREATABLE_TYPES.filter((type) => type !== "plugin").map((type: PropertyType) => (
              <button
                key={type}
                onClick={async () => {
                  if (type === "relation") return setAddingRelation(true);
                  const anchor = adding;
                  setAdding(null);
                  const { property } = await actions.addProperty.mutateAsync({ name: uniqueName(data, typeLabel(type)), type });
                  // Rollups and formulas need their settings first: open them right away.
                  if (type === "rollup" || type === "formula") setMenu({ propId: property.id, anchor });
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <PropertyIcon type={type} size={14} /> {typeLabel(type)}
              </button>
            ))}
            {pluginTypes.map((pt) => (
              <button
                key={`${pt.pluginId}.${pt.id}`}
                title={pt.description}
                data-plugin-type={`${pt.pluginId}.${pt.id}`}
                onClick={async () => {
                  setAdding(null);
                  await actions.addProperty.mutateAsync({ name: uniqueName(data, pt.name), type: "plugin", config: { plugin: { id: pt.pluginId, type: pt.id } } });
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <span className="w-3.5 text-center text-xs">{pt.icon}</span> {pt.name}
              </button>
            ))}
          </div>
        </Popover>
      )}

      {showHidden && (
        <Popover anchor={showHidden} onClose={() => setShowHidden(null)} width={220}>
          {hidden.map((c) => (
            <button
              key={c.prop.id}
              disabled={!editable}
              onClick={() => {
                setColumn(c.prop.id, { hidden: false });
                if (hidden.length === 1) setShowHidden(null);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 enabled:hover:bg-neutral-100 dark:enabled:hover:bg-neutral-800"
            >
              <PropertyIcon type={c.prop.type} size={14} /> <span className="truncate">{c.prop.name}</span>
              {editable && <span className="ml-auto text-xs text-blue-600">{t("common.show")}</span>}
            </button>
          ))}
        </Popover>
      )}
    </div>
  );
}

function uniqueName(data: DatabaseData, base: string) {
  const names = new Set(data.properties.map((p) => p.name));
  let name = base;
  for (let i = 2; names.has(name); i++) name = `${base} ${i}`;
  return name;
}

/** Short labels shown before the result under a column. */
const calcShort = (fn: CalcFunction) => t(`calc.short.${fn}` as MessageKey);

function columnValues(data: DatabaseData, prop: DatabaseProperty, rows = data.rows): { values: CellValue[]; type: PropertyType } {
  const values = rows.map((r) => (prop.type === "title" ? r.title : (r.values[prop.id] ?? null)));
  if (prop.type === "rollup") return rollupCalcInput(values, data.rollupTargets[prop.id] ?? null);
  if (prop.type === "formula") return formulaCalcInput(values);
  return { values, type: prop.type };
}

/** Type that decides which calculations a column offers (rollups use what they compute). */
function calcType(data: DatabaseData, prop: DatabaseProperty): PropertyType {
  return columnValues(data, prop).type;
}

// Results by list of rows (a new list whenever the data, the filters or the sorts change), then by column and function:
// a table re-renders on every hover or drag, and going through thousands of rows each time would show.
const calcCache = new WeakMap<DatabaseRow[], Map<DatabaseProperty, Map<CalcFunction, ReturnType<typeof computeCalc> | null>>>();

function calcColumn(data: DatabaseData, prop: DatabaseProperty, fn: CalcFunction, rows: DatabaseRow[]) {
  let byProp = calcCache.get(rows);
  if (!byProp) calcCache.set(rows, (byProp = new Map()));
  let byFn = byProp.get(prop);
  if (!byFn) byProp.set(prop, (byFn = new Map()));
  if (byFn.has(fn)) return byFn.get(fn)!;
  const { values, type } = columnValues(data, prop, rows);
  const result = calcFunctionsFor(type).includes(fn) ? computeCalc(fn, values, type) : null;
  byFn.set(fn, result);
  return result;
}

/** Property whose number format applies to a column's result (a rollup's target for rollups). */
function calcFormatProp(data: DatabaseData, prop: DatabaseProperty) {
  const p = prop.type === "rollup" ? (data.rollupTargets[prop.id] ?? null) : prop;
  return p && numberFormatOf(p);
}

function RelationSetup({ data, onCreate }: { data: DatabaseData; onCreate: (databaseId: string, name: string, twoWay: boolean) => void }) {
  const list = useDatabaseList();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<{ id: string; title: string } | null>(null);
  const [twoWay, setTwoWay] = useState(true);
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (picked) {
    const self = picked.id === data.id;
    return (
      <div className="space-y-2 p-1">
        <p>
          {t("relation.to")} <span className="font-medium">{pageTitle(picked.title)}</span>
        </p>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1" checked={twoWay} onChange={(e) => setTwoWay(e.target.checked)} />
          <span>
            {t("relation.alsoShowIn")} {self ? t("relation.thisDatabase") : <span className="font-medium">{pageTitle(picked.title)}</span>}
            <span className="block text-xs text-neutral-500">{t("relation.twoWayHelp", { name: pageTitle(data.title) })}</span>
          </span>
        </label>
        <div className="flex justify-end gap-2">
          <button onClick={() => setPicked(null)} className="rounded px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
            {t("common.back")}
          </button>
          <button
            onClick={() => onCreate(picked.id, uniqueName(data, pageTitle(picked.title)), twoWay)}
            className="rounded bg-neutral-900 px-3 py-1 text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900"
          >
            {t("relation.create")}
          </button>
        </div>
      </div>
    );
  }
  const databases = (list.data ?? []).filter((d) => norm(pageTitle(d.title)).includes(norm(query)));
  return (
    <div>
      <div className="px-2 py-1 text-xs text-neutral-500">{t("relation.which")}</div>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("relation.search")}
        className="mb-1 w-full rounded border border-neutral-200 bg-transparent px-2 py-1.5 outline-none focus:border-neutral-400 dark:border-neutral-700"
      />
      <div className="max-h-64 overflow-y-auto">
        {databases.map((d) => (
          <button key={d.id} onClick={() => setPicked(d)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800">
            <span className="w-4 text-center">{pageIcon(d.icon) ?? "🗃"}</span>
            <span className="truncate">
              {pageTitle(d.title)}
              {d.id === data.id && <span className="text-neutral-400"> ({t("relation.thisDatabase")})</span>}
            </span>
          </button>
        ))}
        {list.data && !databases.length && <p className="px-2 py-1 text-neutral-500">{t("relation.none")}</p>}
      </div>
    </div>
  );
}
