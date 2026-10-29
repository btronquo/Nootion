import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import {
  canGroupBy,
  canMoveBetweenGroups,
  groupRows,
  initialValues,
  moveToGroup,
  type CellValue,
  type DatabaseData,
  type DatabaseProperty,
  type DatabaseRow,
  type DatabaseViewInfo,
  type ViewContext,
} from "@nootion/shared";
import { Cell } from "./Cell";
import { OptionChip } from "./OptionPicker";
import { orderedColumns } from "./DatabaseTable";
import type { useDatabaseActions } from "./hooks";
import { pageTitle } from "../lib/tree";

const isEmpty = (v: CellValue | undefined) => v === null || v === undefined || v === "" || v === false || (Array.isArray(v) && !v.length);

/** Picks the column a board is split by: the chosen one, or else the first select / checkbox / person column. */
export function boardGroupProp(data: DatabaseData, view: DatabaseViewInfo): DatabaseProperty | undefined {
  const chosen = data.properties.find((p) => p.id === view.config.groupBy && canGroupBy(p.type));
  return (
    chosen ?? data.properties.find((p) => p.type === "select") ?? data.properties.find((p) => ["multi_select", "person", "checkbox"].includes(p.type))
  );
}

/** Kanban: one column per value of a property; cards move between columns by drag and drop. */
export function BoardView({
  data,
  actions,
  rowHref,
  fileUrl,
  view,
  ctx,
  rows,
  editable,
}: {
  data: DatabaseData;
  actions?: ReturnType<typeof useDatabaseActions>;
  rowHref: (row: DatabaseRow) => string;
  fileUrl?: (id: string) => string;
  view: DatabaseViewInfo;
  ctx: ViewContext;
  rows: DatabaseRow[];
  editable: boolean;
}) {
  const navigate = useNavigate();
  const prop = boardGroupProp(data, view);
  const groups = useMemo(() => (prop ? groupRows(prop, rows, ctx) : []), [prop, rows, ctx]);
  const [dragging, setDragging] = useState<{ rowId: string; from: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const cardProps = orderedColumns(data.properties, view.config.columns).filter(
    (c) => !c.col.hidden && c.prop.type !== "title" && c.prop.id !== prop?.id,
  );
  const movable = editable && !!prop && canMoveBetweenGroups(prop.type);

  if (!prop) {
    return (
      <p className="rounded border border-dashed border-neutral-300 px-3 py-4 text-sm text-neutral-500 dark:border-neutral-700">
        Le Kanban range les lignes en colonnes selon une propriété. Ajoute une colonne « Sélection » (par exemple un statut), ou choisis une propriété
        avec le bouton « Colonnes ».
      </p>
    );
  }

  const drop = (to: string) => {
    setOver(null);
    if (!dragging || dragging.from === to || !actions) return;
    const row = data.rows.find((r) => r.id === dragging.rowId);
    if (row) actions.updateCell.mutate({ rowId: row.id, propId: prop.id, value: moveToGroup(prop, row.values[prop.id] ?? null, dragging.from, to) });
    setDragging(null);
  };

  return (
    <div className="thin-scroll flex gap-3 overflow-x-auto pb-2 text-sm">
      {groups.map((g) => (
        <section
          key={g.key}
          aria-label={`Colonne ${g.label}`}
          onDragOver={(e) => {
            if (!dragging) return;
            e.preventDefault();
            setOver(g.key);
          }}
          onDragLeave={() => setOver((o) => (o === g.key ? null : o))}
          onDrop={() => drop(g.key)}
          className={`flex w-64 shrink-0 flex-col gap-1.5 rounded-lg p-1.5 ${over === g.key ? "bg-blue-50 dark:bg-blue-950/40" : "bg-neutral-50 dark:bg-neutral-900"}`}
        >
          <header className="flex items-center gap-1.5 px-1 py-0.5">
            {g.option ? <OptionChip option={g.option} /> : <span className="font-medium">{g.label}</span>}
            <span className="text-xs text-neutral-400">{g.rows.length}</span>
          </header>
          {g.rows.map((row) => (
            <article
              key={row.id}
              draggable={movable}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                setDragging({ rowId: row.id, from: g.key });
              }}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
              onClick={(e) => {
                // Links inside the card (relations, files) keep their own behaviour.
                if (!(e.target as HTMLElement).closest("a")) navigate(rowHref(row));
              }}
              aria-label={row.title || "Sans titre"}
              className={`cursor-pointer rounded-md border border-neutral-200 bg-white p-2 shadow-sm hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:bg-neutral-700/70 ${dragging?.rowId === row.id ? "opacity-50" : ""}`}
            >
              <div className="font-medium">
                {row.icon && <span className="mr-1">{row.icon}</span>}
                {row.title ? row.title : <span className="text-neutral-400">{pageTitle("")}</span>}
              </div>
              {cardProps
                .filter((c) => !isEmpty(row.values[c.prop.id]))
                .map((c) => (
                  <div
                    key={c.prop.id}
                    className="-mx-2 text-xs [&_[role=gridcell]]:min-h-0 [&_[role=gridcell]]:py-0.5 [&_[role=gridcell]]:hover:bg-transparent"
                    title={c.prop.name}
                  >
                    <Cell
                      prop={c.prop}
                      value={row.values[c.prop.id] ?? null}
                      rowId={row.id}
                      people={data.people}
                      editable={false}
                      variant="panel"
                      fileUrl={fileUrl}
                      related={data.related}
                      rollupTarget={data.rollupTargets[c.prop.id]}
                      rowHref={(id) => rowHref({ id } as DatabaseRow)}
                      onChange={() => {}}
                      onCreateOption={() => Promise.reject(new Error("lecture seule"))}
                    />
                  </div>
                ))}
            </article>
          ))}
          {movable && actions && (
            <button
              onClick={() => actions.addRow.mutate(initialValues(ctx, view.config, { prop, key: g.key }))}
              className="flex items-center gap-1 rounded px-1.5 py-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            >
              <Plus size={14} /> Nouvelle
            </button>
          )}
        </section>
      ))}
    </div>
  );
}
