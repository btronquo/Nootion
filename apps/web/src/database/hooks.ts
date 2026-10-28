import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CellValue, DatabaseData, DatabaseProperty, DatabaseRow, PropertyConfig, PropertyType, ViewConfig } from "@nootion/shared";
import { api } from "../lib/api";

export const dbKey = (id: string) => ["database", id] as const;

export function useDatabase(id: string) {
  return useQuery({
    queryKey: dbKey(id),
    queryFn: async () => (await api<{ database: DatabaseData }>(`/databases/${id}`)).database,
    // Picks up changes made by other people.
    refetchInterval: () => (document.visibilityState === "visible" ? 5000 : false),
  });
}

/** Mutations of a database, with the local copy updated right away. */
export function useDatabaseActions(id: string) {
  const qc = useQueryClient();
  const key = dbKey(id);
  const patch = (fn: (d: DatabaseData) => DatabaseData) => qc.setQueryData<DatabaseData>(key, (d) => (d ? fn(d) : d));
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const updateCell = useMutation({
    mutationFn: ({ rowId, propId, value }: { rowId: string; propId: string; value: CellValue }) =>
      api<{ row: DatabaseRow }>(`/databases/${id}/rows/${rowId}`, { method: "PATCH", body: { values: { [propId]: value } } }),
    onMutate: ({ rowId, propId, value }) =>
      patch((d) => ({
        ...d,
        rows: d.rows.map((r) =>
          r.id === rowId
            ? { ...r, values: { ...r.values, [propId]: value }, title: d.properties.find((p) => p.id === propId)?.type === "title" ? String(value ?? "") : r.title }
            : r,
        ),
      })),
    onSuccess: ({ row }) => patch((d) => ({ ...d, rows: d.rows.map((r) => (r.id === row.id ? row : r)) })),
    onError: (err) => {
      alert(err instanceof Error ? err.message : String(err));
      return refresh();
    },
  });

  const addRow = useMutation({
    mutationFn: (values: Record<string, CellValue> = {}) => api<{ row: DatabaseRow }>(`/databases/${id}/rows`, { method: "POST", body: { values } }),
    onSuccess: ({ row }) => patch((d) => ({ ...d, rows: [...d.rows, row] })),
  });

  const deleteRows = useMutation({
    mutationFn: (ids: string[]) => api(`/databases/${id}/rows/delete`, { method: "POST", body: { ids } }),
    onMutate: (ids) => patch((d) => ({ ...d, rows: d.rows.filter((r) => !ids.includes(r.id)) })),
    onSettled: () => Promise.all([refresh(), qc.invalidateQueries({ queryKey: ["trash"] })]),
  });

  const addProperty = useMutation({
    mutationFn: (p: { name: string; type: PropertyType; config?: PropertyConfig }) =>
      api<{ property: DatabaseProperty }>(`/databases/${id}/properties`, { method: "POST", body: { config: {}, ...p } }),
    onSuccess: ({ property }) => patch((d) => ({ ...d, properties: [...d.properties, property] })),
  });

  const updateProperty = useMutation({
    mutationFn: ({ propId, ...body }: { propId: string; name?: string; type?: PropertyType; config?: PropertyConfig; position?: number }) =>
      api<{ property: DatabaseProperty }>(`/databases/${id}/properties/${propId}`, { method: "PATCH", body }),
    onMutate: ({ propId, name, config }) =>
      patch((d) => ({ ...d, properties: d.properties.map((p) => (p.id === propId ? { ...p, ...(name ? { name } : {}), ...(config ? { config } : {}) } : p)) })),
    // Type changes convert values on the server: reload everything.
    onSettled: refresh,
    onError: (err) => alert(err instanceof Error ? err.message : String(err)),
  });

  const deleteProperty = useMutation({
    mutationFn: (propId: string) => api(`/databases/${id}/properties/${propId}`, { method: "DELETE" }),
    onMutate: (propId) => patch((d) => ({ ...d, properties: d.properties.filter((p) => p.id !== propId) })),
    onSettled: refresh,
  });

  const updateView = useMutation({
    mutationFn: ({ viewId, config }: { viewId: string; config: ViewConfig }) => api(`/databases/${id}/views/${viewId}`, { method: "PATCH", body: { config } }),
    onMutate: ({ viewId, config }) => patch((d) => ({ ...d, views: d.views.map((v) => (v.id === viewId ? { ...v, config } : v)) })),
  });

  return { updateCell, addRow, deleteRows, addProperty, updateProperty, deleteProperty, updateView, refresh };
}
