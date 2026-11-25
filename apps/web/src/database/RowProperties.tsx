import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { atLeast, type CellValue, type DatabaseProperty, type DatabaseRow, type PageRole, type RelatedRow, type SelectOption } from "@nootion/shared";
import { api } from "../lib/api";
import { sendOrQueue, useOfflineQueue, withQueuedRow } from "../lib/offline";
import { Cell } from "./Cell";
import { PropertyIcon } from "./icons";
import { newOption } from "./OptionPicker";
import { t } from "@nootion/shared";
import { RowStructure } from "./subItems";

interface RowData {
  properties: DatabaseProperty[];
  row: DatabaseRow;
  role: PageRole;
  people: Record<string, string>;
  related: Record<string, RelatedRow>;
  rollupTargets: Record<string, DatabaseProperty | null>;
}

/**
 * Name of a property in the list of an opened row. A long name goes on a second line, and past that the whole name
 * shows on hover.
 */
export function PropertyLabel({ prop }: { prop: DatabaseProperty }) {
  return (
    <div title={prop.name} className="flex w-32 shrink-0 items-start gap-1.5 py-1.5 text-neutral-500 sm:w-40">
      <span className="mt-[3px] flex">
        <PropertyIcon type={prop.type} size={14} />
      </span>
      <span className="line-clamp-2 min-w-0 break-words">{prop.name}</span>
    </div>
  );
}

/** Property list shown above the content of a database row opened as a page. */
export function RowProperties({ databaseId, rowId, locked = false }: { databaseId: string; rowId: string; locked?: boolean }) {
  const qc = useQueryClient();
  const key = ["database-row", rowId] as const;
  const { pending } = useOfflineQueue();
  const q = useQuery({
    queryKey: key,
    queryFn: () => api<RowData>(`/databases/${databaseId}/rows/${rowId}`),
    // Values changed offline show until the server has them.
    select: pending ? (d: RowData) => ({ ...d, row: withQueuedRow(databaseId, d.row) }) : undefined,
  });

  const update = useMutation({
    mutationFn: ({ propId, value }: { propId: string; value: CellValue }) =>
      sendOrQueue<{ row: DatabaseRow; related: Record<string, RelatedRow>; people: Record<string, string> }>(`/databases/${databaseId}/rows/${rowId}`, { values: { [propId]: value } }),
    onMutate: ({ propId, value }) =>
      qc.setQueryData<RowData>(key, (d) => (d ? { ...d, row: { ...d.row, values: { ...d.row.values, [propId]: value } } } : d)),
    onSuccess: (res) => res && qc.setQueryData<RowData>(key, (d) => (d ? { ...d, row: res.row, related: { ...d.related, ...res.related }, people: { ...d.people, ...res.people } } : d)),
    onError: (err) => alert(err instanceof Error ? err.message : String(err)),
    // Relations and rollups can show this row in other databases too.
    onSettled: () => qc.invalidateQueries({ queryKey: ["database"] }),
  });

  if (!q.data) return null;
  const { properties, row, role, people, related, rollupTargets } = q.data;
  // A row locked on its own keeps its cells too.
  const editable = atLeast(role, "editor") && !locked;

  const createOption = (prop: DatabaseProperty) => async (name: string): Promise<SelectOption> => {
    const options = prop.config.options ?? [];
    const o = newOption(name, options);
    await api(`/databases/${databaseId}/properties/${prop.id}`, { method: "PATCH", body: { config: { ...prop.config, options: [...options, o] } } });
    await qc.invalidateQueries({ queryKey: key });
    return o;
  };

  return (
    <div className="mt-4 space-y-0.5 border-b border-neutral-200 pb-4 text-sm dark:border-neutral-800" aria-label={t("row.properties")}>
      {properties
        .filter((p) => p.type !== "title")
        .map((p) => (
          <div key={p.id} className="flex items-start gap-2">
            <PropertyLabel prop={p} />
            <div className="min-w-0 flex-1">
              <Cell
                prop={p}
                value={row.values[p.id] ?? null}
                rowId={row.id}
                databaseId={databaseId}
                people={people}
                related={related}
                rollupTarget={rollupTargets[p.id]}
                editable={editable}
                variant="panel"
                onChange={(value) => update.mutate({ propId: p.id, value })}
                onCreateOption={createOption(p)}
              />
            </div>
          </div>
        ))}
      <RowStructure databaseId={databaseId} rowId={rowId} />
    </div>
  );
}
