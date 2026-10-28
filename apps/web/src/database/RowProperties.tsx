import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { atLeast, type CellValue, type DatabaseProperty, type DatabaseRow, type PageRole, type SelectOption } from "@nootion/shared";
import { api } from "../lib/api";
import { Cell } from "./Cell";
import { PropertyIcon } from "./icons";
import { newOption } from "./OptionPicker";
import { dbKey } from "./hooks";

interface RowData {
  properties: DatabaseProperty[];
  row: DatabaseRow;
  role: PageRole;
  people: Record<string, string>;
}

/** Property list shown above the content of a database row opened as a page. */
export function RowProperties({ databaseId, rowId }: { databaseId: string; rowId: string }) {
  const qc = useQueryClient();
  const key = ["database-row", rowId] as const;
  const q = useQuery({ queryKey: key, queryFn: () => api<RowData>(`/databases/${databaseId}/rows/${rowId}`) });

  const update = useMutation({
    mutationFn: ({ propId, value }: { propId: string; value: CellValue }) =>
      api<{ row: DatabaseRow }>(`/databases/${databaseId}/rows/${rowId}`, { method: "PATCH", body: { values: { [propId]: value } } }),
    onMutate: ({ propId, value }) =>
      qc.setQueryData<RowData>(key, (d) => (d ? { ...d, row: { ...d.row, values: { ...d.row.values, [propId]: value } } } : d)),
    onSuccess: ({ row }) => qc.setQueryData<RowData>(key, (d) => (d ? { ...d, row } : d)),
    onError: (err) => alert(err instanceof Error ? err.message : String(err)),
    onSettled: () => qc.invalidateQueries({ queryKey: dbKey(databaseId) }),
  });

  if (!q.data) return null;
  const { properties, row, role, people } = q.data;
  const editable = atLeast(role, "editor");

  const createOption = (prop: DatabaseProperty) => async (name: string): Promise<SelectOption> => {
    const options = prop.config.options ?? [];
    const o = newOption(name, options);
    await api(`/databases/${databaseId}/properties/${prop.id}`, { method: "PATCH", body: { config: { ...prop.config, options: [...options, o] } } });
    await qc.invalidateQueries({ queryKey: key });
    return o;
  };

  return (
    <div className="mt-4 space-y-0.5 border-b border-neutral-200 pb-4 text-sm dark:border-neutral-800" aria-label="Propriétés">
      {properties
        .filter((p) => p.type !== "title")
        .map((p) => (
          <div key={p.id} className="flex items-start gap-2">
            <div className="flex w-40 shrink-0 items-center gap-1.5 truncate py-1.5 text-neutral-500">
              <PropertyIcon type={p.type} size={14} /> <span className="truncate">{p.name}</span>
            </div>
            <div className="min-w-0 flex-1">
              <Cell
                prop={p}
                value={row.values[p.id] ?? null}
                rowId={row.id}
                people={people}
                editable={editable}
                variant="panel"
                onChange={(value) => update.mutate({ propId: p.id, value })}
                onCreateOption={createOption(p)}
              />
            </div>
          </div>
        ))}
    </div>
  );
}
