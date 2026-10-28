import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Maximize2, Plus, Trash2 } from "lucide-react";
import type { CellValue, DatabaseData, DatabaseProperty, DatabaseRow, PropertyType, SelectOption, ViewColumn } from "@nootion/shared";
import { Cell } from "./Cell";
import { PropertyMenu } from "./PropertyMenu";
import { PropertyIcon } from "./icons";
import { Popover } from "./Popover";
import { newOption } from "./OptionPicker";
import { TYPE_LABELS } from "./format";
import { useDatabase, useDatabaseActions } from "./hooks";
import { CREATABLE_TYPES } from "@nootion/shared";

const DEFAULT_WIDTH = 180;
const TITLE_WIDTH = 260;

/** Table view of a database the user is signed in to. */
export function DatabaseTable({ id, compact }: { id: string; compact?: boolean }) {
  const db = useDatabase(id);
  const actions = useDatabaseActions(id);
  if (db.isLoading) return <div className="py-4 text-sm text-neutral-400">Chargement…</div>;
  if (db.isError || !db.data) return <div className="py-4 text-sm text-neutral-500">Base de données introuvable ou non partagée.</div>;
  return <TableView data={db.data} actions={actions} compact={compact} rowHref={(r) => `/page/${r.id}`} />;
}

type Actions = ReturnType<typeof useDatabaseActions>;

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
}: {
  data: DatabaseData;
  /** Absent: read-only (public page). */
  actions?: Actions;
  compact?: boolean;
  rowHref: (row: DatabaseRow) => string;
  fileUrl?: (id: string) => string;
}) {
  const editable = !!actions && (data.role === "editor" || data.role === "full");
  const view = data.views[0];
  const columns = useMemo(() => orderedColumns(data.properties, view?.config.columns), [data.properties, view?.config.columns]);
  const visible = columns.filter((c) => !c.col.hidden);
  const hidden = columns.filter((c) => c.col.hidden);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ propId: string; anchor: HTMLElement } | null>(null);
  const [adding, setAdding] = useState<HTMLElement | null>(null);
  const [showHidden, setShowHidden] = useState<HTMLElement | null>(null);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const drag = useRef<string | null>(null);

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
  const allSelected = data.rows.length > 0 && data.rows.every((r) => selected.has(r.id));
  const gutter = editable ? "w-8 shrink-0" : "w-0 shrink-0";

  return (
    <div className="text-sm">
      {editable && selected.size > 0 && (
        <div className="mb-1 flex items-center gap-2 text-neutral-600 dark:text-neutral-300">
          <span>{selected.size} sélectionnée{selected.size > 1 ? "s" : ""}</span>
          <button
            onClick={() => {
              if (!confirm(`Mettre ${selected.size} ligne${selected.size > 1 ? "s" : ""} à la corbeille ?`)) return;
              actions!.deleteRows.mutate([...selected]);
              setSelected(new Set());
            }}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
          >
            <Trash2 size={14} /> Supprimer
          </button>
        </div>
      )}
      <div className={`overflow-x-auto ${compact ? "" : "pb-2"}`}>
        <div role="grid" aria-label={data.title || "Base de données"} className="inline-block min-w-full align-top">
          {/* Header */}
          <div role="row" className="flex border-y border-neutral-200 text-neutral-500 dark:border-neutral-800">
            <div className={`${gutter} flex items-center justify-center`}>
              {editable && (
                <input
                  type="checkbox"
                  aria-label="Tout sélectionner"
                  className="h-3.5 w-3.5 accent-blue-600 opacity-40 hover:opacity-100 checked:opacity-100"
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(data.rows.map((r) => r.id)))}
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
              <button aria-label="Ajouter une propriété" onClick={(e) => setAdding(e.currentTarget)} className="flex w-10 shrink-0 items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-800">
                <Plus size={16} />
              </button>
            )}
            {hidden.length > 0 && (
              <button onClick={(e) => setShowHidden(e.currentTarget)} className="shrink-0 px-2 text-xs hover:text-neutral-800 dark:hover:text-neutral-200">
                {hidden.length} masquée{hidden.length > 1 ? "s" : ""}
              </button>
            )}
          </div>

          {/* Rows */}
          {data.rows.map((row) => (
            <div key={row.id} role="row" className="group flex border-b border-neutral-200 dark:border-neutral-800">
              <div className={`${gutter} flex items-center justify-center`}>
                {editable && (
                  <input
                    type="checkbox"
                    aria-label="Sélectionner la ligne"
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
                  <Cell
                    prop={c.prop}
                    value={c.prop.type === "title" ? row.title : (row.values[c.prop.id] ?? null)}
                    rowId={row.id}
                    people={data.people}
                    editable={editable}
                    fileUrl={fileUrl}
                    onChange={(value: CellValue) => actions?.updateCell.mutate({ rowId: row.id, propId: c.prop.id, value })}
                    onCreateOption={createOption(c.prop)}
                  />
                  {c.prop.type === "title" && (
                    <Link
                      to={rowHref(row)}
                      title="Ouvrir"
                      aria-label={`Ouvrir ${row.title || "Sans titre"}`}
                      className="absolute right-1 top-1.5 z-[5] flex items-center gap-1 rounded border border-neutral-200 bg-white px-1.5 py-0.5 text-xs text-neutral-500 opacity-0 hover:bg-neutral-100 group-hover:opacity-100 dark:border-neutral-700 dark:bg-neutral-900"
                    >
                      <Maximize2 size={11} /> Ouvrir
                    </Link>
                  )}
                </div>
              ))}
            </div>
          ))}
          {data.rows.length === 0 && !editable && <div className="px-3 py-2 text-neutral-400">Aucune ligne</div>}
        </div>
      </div>
      {editable && (
        <button
          onClick={() => actions!.addRow.mutate({})}
          className="flex w-full items-center gap-1.5 px-2 py-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <Plus size={14} /> Nouvelle ligne
        </button>
      )}
      <div className="px-2 pt-1 text-xs text-neutral-400">
        {data.rows.length} ligne{data.rows.length > 1 ? "s" : ""}
      </div>

      {menu && menuProp && actions && (
        <Popover anchor={menu.anchor} onClose={() => setMenu(null)} width={260}>
          <PropertyMenu
            key={menuProp.id}
            prop={menuProp}
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
              if (!confirm(`Supprimer la colonne « ${menuProp.name} » et toutes ses valeurs ?`)) return;
              actions.deleteProperty.mutate(menuProp.id);
              setMenu(null);
            }}
          />
        </Popover>
      )}

      {adding && actions && (
        <Popover anchor={adding} onClose={() => setAdding(null)} width={220}>
          <div className="max-h-80 overflow-y-auto">
            <div className="px-2 py-1 text-xs text-neutral-500">Type de la nouvelle colonne</div>
            {CREATABLE_TYPES.map((type: PropertyType) => (
              <button
                key={type}
                onClick={() => {
                  const base = TYPE_LABELS[type];
                  const names = new Set(data.properties.map((p) => p.name));
                  let name = base;
                  for (let i = 2; names.has(name); i++) name = `${base} ${i}`;
                  actions.addProperty.mutate({ name, type });
                  setAdding(null);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <PropertyIcon type={type} size={14} /> {TYPE_LABELS[type]}
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
              {editable && <span className="ml-auto text-xs text-blue-600">Afficher</span>}
            </button>
          ))}
        </Popover>
      )}
    </div>
  );
}
