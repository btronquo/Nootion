import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { canMoveBetweenGroups, initialValues, t, type RowGroup, type DatabaseData, type DatabaseProperty, type DatabaseRow, type DatabaseViewInfo, type ViewColumn, type ViewContext } from "@nootion/shared";
import { Cell } from "./Cell";
import { OptionChip } from "./OptionPicker";
import { isEmpty } from "./BoardView";
import type { useDatabaseActions } from "./hooks";
import { pageTitle } from "../lib/tree";

/**
 * Table view on phones: one card per row with its filled-in properties. A tap opens the row,
 * where every property can be edited; a new row opens at once.
 */
export function RowCards({
  data,
  actions,
  view,
  ctx,
  rows,
  groups,
  groupProp,
  columns,
  editable,
  rowHref,
  fileUrl,
}: {
  data: DatabaseData;
  actions?: ReturnType<typeof useDatabaseActions>;
  view: DatabaseViewInfo | undefined;
  ctx: ViewContext;
  rows: DatabaseRow[];
  groups: RowGroup[] | null;
  groupProp: DatabaseProperty | undefined;
  columns: { prop: DatabaseProperty; col: ViewColumn }[];
  editable: boolean;
  rowHref: (row: DatabaseRow) => string;
  fileUrl?: (id: string) => string;
}) {
  const navigate = useNavigate();
  const shown = columns.filter((c) => c.prop.type !== "title" && c.prop.id !== groupProp?.id);

  async function addRow(group?: { prop: DatabaseProperty; key: string }) {
    try {
      const { row } = await actions!.addRow.mutateAsync(initialValues(ctx, view?.config ?? {}, group));
      navigate(rowHref(row));
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  const card = (row: DatabaseRow) => (
    <div key={row.id} role="listitem">
      <article
        onClick={(e) => {
          // Links inside the card (relations, files) keep their own behaviour.
          if (!(e.target as HTMLElement).closest("a")) navigate(rowHref(row));
        }}
        aria-label={row.title || t("common.untitled")}
        className="cursor-pointer rounded-lg border border-neutral-200 bg-white px-3 py-2 active:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:active:bg-neutral-800"
      >
        <div className="font-medium">
          {row.icon && <span className="mr-1">{row.icon}</span>}
          {row.title ? row.title : <span className="text-neutral-400">{pageTitle("")}</span>}
        </div>
        {shown
          .filter((c) => !isEmpty(row.values[c.prop.id]))
          .map((c) => (
            <div key={c.prop.id} className="-mx-2 flex items-start gap-2 text-xs [&_[role=gridcell]]:min-h-0 [&_[role=gridcell]]:py-0.5 [&_[role=gridcell]]:hover:bg-transparent">
              <span className="w-24 shrink-0 truncate px-2 py-0.5 text-neutral-400">{c.prop.name}</span>
              <div className="min-w-0 flex-1">
                <Cell
                  prop={c.prop}
                  value={row.values[c.prop.id] ?? null}
                  rowId={row.id}
                  databaseId={data.id}
                  people={data.people}
                  editable={false}
                  variant="panel"
                  fileUrl={fileUrl}
                  related={data.related}
                  rollupTarget={data.rollupTargets[c.prop.id]}
                  rowHref={(id) => rowHref({ id } as DatabaseRow)}
                  onChange={() => {}}
                  onCreateOption={() => Promise.reject(new Error("read-only"))}
                />
              </div>
            </div>
          ))}
      </article>
    </div>
  );

  const newButton = (group?: { prop: DatabaseProperty; key: string }) => (
    <button
      onClick={() => void addRow(group)}
      disabled={actions?.addRow.isPending}
      className="flex w-full items-center gap-1.5 rounded-lg px-2 py-2 text-neutral-500 active:bg-neutral-100 dark:active:bg-neutral-800"
    >
      <Plus size={16} /> {t("table.newRow")}
    </button>
  );

  const movable = !!groupProp && canMoveBetweenGroups(groupProp.type);
  return (
    <div className="pt-2 text-sm">
      {groups ? (
        groups.map((g) => (
          <section key={g.key} aria-label={t("table.group", { name: g.label })} className="mb-3">
            <header className="flex items-center gap-1.5 px-1 py-1.5">
              {g.option ? <OptionChip option={g.option} /> : <span className="font-medium">{g.label}</span>}
              <span className="text-xs text-neutral-400">{g.rows.length}</span>
            </header>
            <div role="list" className="space-y-2">{g.rows.map(card)}</div>
            {editable && movable && newButton({ prop: groupProp, key: g.key })}
          </section>
        ))
      ) : (
        <div role="list" className="space-y-2">{rows.map(card)}</div>
      )}
      {rows.length === 0 && !editable && <div className="px-1 py-2 text-neutral-400">{t("table.noRows")}</div>}
      {editable && !(groups && movable) && newButton()}
      <div className="px-1 pt-1 text-xs text-neutral-400">
        {rows.length !== data.rows.length ? t("table.countOf", { count: rows.length, total: data.rows.length }) : t("table.count", { count: rows.length })}
      </div>
    </div>
  );
}
