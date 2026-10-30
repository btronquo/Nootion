import { useNavigate } from "react-router-dom";
import { FileText, Plus } from "lucide-react";
import {
  initialValues,
  t,
  type DatabaseData,
  type DatabaseRow,
  type DatabaseViewInfo,
  type ViewContext,
} from "@nootion/shared";
import { Cell } from "./Cell";
import { orderedColumns } from "./DatabaseTable";
import { isEmpty } from "./BoardView";
import type { useDatabaseActions } from "./hooks";
import { CoverFill } from "../components/PageCover";
import { pageTitle } from "../lib/tree";

export interface MoreViewProps {
  data: DatabaseData;
  actions?: ReturnType<typeof useDatabaseActions>;
  rowHref: (row: DatabaseRow) => string;
  fileUrl?: (id: string) => string;
  view: DatabaseViewInfo;
  ctx: ViewContext;
  rows: DatabaseRow[];
  editable: boolean;
}

/** Properties shown on a line or a card: the view's visible ones that have a value. */
function shownProps(data: DatabaseData, view: DatabaseViewInfo, row: DatabaseRow) {
  return orderedColumns(data.properties, view.config.columns).filter((c) => !c.col.hidden && c.prop.type !== "title" && !isEmpty(row.values[c.prop.id]));
}

function RowValues({
  data,
  view,
  row,
  rowHref,
  fileUrl,
  className,
}: Omit<MoreViewProps, "ctx" | "rows" | "editable"> & { row: DatabaseRow; className: string }) {
  return (
    <>
      {shownProps(data, view, row).map((c) => (
        <div
          key={c.prop.id}
          className={`text-xs [&_[role=gridcell]]:min-h-0 [&_[role=gridcell]]:py-0.5 [&_[role=gridcell]]:hover:bg-transparent ${className}`}
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
            onCreateOption={() => Promise.reject(new Error("read-only"))}
          />
        </div>
      ))}
    </>
  );
}

export const RowTitle = ({ row }: { row: DatabaseRow }) => (
  <>
    {row.icon && <span className="mr-1">{row.icon}</span>}
    {row.title ? row.title : <span className="text-neutral-400">{pageTitle("")}</span>}
  </>
);

/** Adds a row with the view's values (and any given ones), then opens it. */
export function useAddRow({ actions, ctx, view, rowHref }: Pick<MoreViewProps, "actions" | "ctx" | "view" | "rowHref">) {
  const navigate = useNavigate();
  return async (values: Record<string, unknown> = {}) => {
    if (!actions) return;
    const { row } = await actions.addRow.mutateAsync({ ...initialValues(ctx, view.config), ...values } as Parameters<typeof actions.addRow.mutateAsync>[0]);
    navigate(rowHref(row));
  };
}

const newButton =
  "flex items-center gap-1 rounded px-1.5 py-1 text-sm text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200";

/** One compact line per row, with its properties on the right. */
export function ListView(props: MoreViewProps) {
  const { rows, editable, rowHref } = props;
  const navigate = useNavigate();
  const add = useAddRow(props);
  return (
    <div className="text-sm">
      <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {rows.map((row) => (
          <li
            key={row.id}
            onClick={(e) => !(e.target as HTMLElement).closest("a") && navigate(rowHref(row))}
            aria-label={row.title || t("common.untitled")}
            className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-0.5 rounded px-2 py-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
          >
            <span className="min-w-0 flex-1 truncate font-medium">
              <RowTitle row={row} />
            </span>
            <span className="flex max-w-full flex-wrap items-center justify-end gap-x-3 text-neutral-500">
              <RowValues {...props} row={row} className="max-w-56 truncate" />
            </span>
          </li>
        ))}
      </ul>
      {!rows.length && <p className="px-2 py-3 text-neutral-400">{t("view.noRows")}</p>}
      {editable && (
        <button onClick={() => add()} className={`${newButton} mt-1`}>
          <Plus size={14} /> {t("board.new")}
        </button>
      )}
    </div>
  );
}

/** Cards in a grid, topped by the row's cover or first image. */
export function GalleryView(props: MoreViewProps) {
  const { rows, editable, rowHref, view, fileUrl } = props;
  const navigate = useNavigate();
  const add = useAddRow(props);
  const preview = view.config.showPreview !== false;
  // Files of a public page go through its link.
  const coverUrl = (cover: string) => {
    const m = /^\/api\/attachments\/(.+)$/.exec(cover);
    return m && fileUrl ? fileUrl(m[1]!) : cover;
  };
  return (
    <div className="grid grid-cols-1 gap-3 text-sm min-[420px]:grid-cols-2 md:grid-cols-3">
      {rows.map((row) => (
        <article
          key={row.id}
          onClick={(e) => !(e.target as HTMLElement).closest("a") && navigate(rowHref(row))}
          aria-label={row.title || t("common.untitled")}
          className="cursor-pointer overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:bg-neutral-700/70"
        >
          {preview && (
            <div className="h-32 w-full bg-neutral-100 dark:bg-neutral-900" data-preview>
              {row.cover ? (
                <CoverFill cover={coverUrl(row.cover)} position={row.coverPosition} />
              ) : (
                <div className="flex h-full items-center justify-center text-3xl text-neutral-300 dark:text-neutral-600">
                  {row.icon ?? <FileText size={28} />}
                </div>
              )}
            </div>
          )}
          <div className="p-2.5">
            <div className="truncate font-medium">
              <RowTitle row={row} />
            </div>
            <RowValues {...props} row={row} className="-mx-2" />
          </div>
        </article>
      ))}
      {editable && (
        <button
          onClick={() => add()}
          className="flex min-h-24 items-center justify-center gap-1 rounded-lg border border-dashed border-neutral-300 text-neutral-400 hover:bg-neutral-50 hover:text-neutral-700 dark:border-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          <Plus size={14} /> {t("board.new")}
        </button>
      )}
    </div>
  );
}
