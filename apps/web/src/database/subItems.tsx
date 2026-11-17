import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Check, Plus } from "lucide-react";
import { atLeast, dependencyProps, rowDone, subItemProps, subItemsOf, t, type DatabaseData, type DatabaseRow } from "@nootion/shared";
import { useDatabase, useDatabaseActions } from "./hooks";
import { pageTitle } from "../lib/tree";
import { pageIcon } from "../lib/icons";

type Actions = ReturnType<typeof useDatabaseActions>;

const FOLD_KEY = "nootion-folded-";

/** Rows whose sub-items are folded away in tables, remembered per browser and database. */
export function useFoldedRows(databaseId: string): [ReadonlySet<string>, (rowId: string) => void] {
  const [folded, setFolded] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(FOLD_KEY + databaseId) ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });
  const toggle = useCallback(
    (rowId: string) =>
      setFolded((s) => {
        const next = new Set(s);
        if (next.has(rowId)) next.delete(rowId);
        else next.add(rowId);
        try {
          localStorage.setItem(FOLD_KEY + databaseId, JSON.stringify([...next].slice(-500)));
        } catch {
          // Private browsing: folds are kept until the page is left.
        }
        return next;
      }),
    [databaseId],
  );
  return [folded, toggle];
}

/** Adds a sub-item to a row, placed after its last sub-item in the database's order. */
export async function addSubItem(data: DatabaseData, actions: Actions, parent: DatabaseRow) {
  const sub = subItemProps(data.properties);
  if (!sub) return;
  const { items } = subItemsOf(data.properties, data.rows, parent);
  await actions.insertRow.mutateAsync({ values: { [sub.parent.id]: [parent.id] }, after: items[items.length - 1]?.id ?? parent.id });
  await actions.refresh();
}

/** Under the properties of a row opened as a page: its sub-items with their progress, and what it waits on. */
export function RowStructure({ databaseId, rowId }: { databaseId: string; rowId: string }) {
  const db = useDatabase(databaseId);
  const actions = useDatabaseActions(databaseId);
  const data = db.data;
  if (!data) return null;
  const row = data.rows.find((r) => r.id === rowId);
  const sub = subItemProps(data.properties);
  const deps = dependencyProps(data.properties);
  if (!row || (!sub && !deps)) return null;
  const editable = atLeast(data.role, "editor");
  const { items, done } = subItemsOf(data.properties, data.rows, row);
  const blockedBy = deps ? ((row.values[deps.blockedBy.id] as string[] | null) ?? []) : [];
  const waiting = data.rows.filter((r) => blockedBy.includes(r.id) && rowDone(data.properties, r) === false);
  return (
    <div className="mt-3 space-y-3 text-sm" data-row-structure>
      {deps && waiting.length > 0 && (
        <p className="flex items-center gap-1.5 rounded bg-amber-50 px-2 py-1.5 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-waiting>
          <AlertTriangle size={14} /> {t("dependencies.waiting", { count: waiting.length })}{" "}
          {waiting.map((r, i) => (
            <span key={r.id}>
              {i > 0 && ", "}
              <Link to={`/page/${r.id}`} className="underline">
                {pageTitle(r.title)}
              </Link>
            </span>
          ))}
        </p>
      )}
      {sub && (items.length > 0 || editable) && (
        <section aria-label={t("subItems.title")} data-sub-items>
          <div className="mb-1 flex items-center gap-2 text-neutral-500">
            <span className="font-medium">{t("subItems.title")}</span>
            {items.length > 0 && done !== null && (
              <>
                <span className="h-1.5 w-24 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
                  <span className="block h-full rounded-full bg-green-500" style={{ width: `${(done / items.length) * 100}%` }} />
                </span>
                <span className="text-xs tabular-nums">{t("subItems.progress", { done, count: items.length })}</span>
              </>
            )}
          </div>
          <ul>
            {items.map((r) => {
              const finished = rowDone(data.properties, r);
              return (
                <li key={r.id}>
                  <Link to={`/page/${r.id}`} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded-full border ${finished ? "border-green-500 bg-green-500 text-white" : "border-neutral-300 dark:border-neutral-600"}`}
                    >
                      {finished && <Check size={11} />}
                    </span>
                    {r.icon && <span className="[&_img]:h-4 [&_img]:w-4">{pageIcon(r.icon)}</span>}
                    <span className={`truncate ${finished ? "text-neutral-400 line-through" : ""}`}>{pageTitle(r.title)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {editable && (
            <button
              type="button"
              onClick={() => void addSubItem(data, actions, row)}
              className="mt-0.5 flex items-center gap-1.5 rounded px-1 py-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            >
              <Plus size={14} /> {t("subItems.add")}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
