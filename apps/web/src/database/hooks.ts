import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CellValue, DatabaseData, DatabaseProperty, DatabaseRow, DatabaseSummary, PropertyConfig, PropertyType, RelatedRow, ViewConfig, ViewType, DatabaseViewInfo } from "@nootion/shared";
import { api } from "../lib/api";

export const dbKey = (id: string) => ["database", id] as const;

interface RowResponse {
  row: DatabaseRow;
  related: Record<string, RelatedRow>;
}

export function useDatabase(id: string) {
  return useQuery({
    queryKey: dbKey(id),
    queryFn: async () => (await api<{ database: DatabaseData }>(`/databases/${id}`)).database,
    enabled: !!id,
    // Picks up changes made by other people.
    refetchInterval: () => (document.visibilityState === "visible" ? 5000 : false),
  });
}

/** Databases the user can link to with a relation. */
export function useDatabaseList() {
  return useQuery({ queryKey: ["databases"], queryFn: async () => (await api<{ databases: DatabaseSummary[] }>("/databases")).databases });
}

/** Mutations of a database, with the local copy updated right away. */
export function useDatabaseActions(id: string) {
  const qc = useQueryClient();
  const key = dbKey(id);
  const patch = (fn: (d: DatabaseData) => DatabaseData) => qc.setQueryData<DatabaseData>(key, (d) => (d ? fn(d) : d));
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const updateCell = useMutation({
    mutationFn: ({ rowId, propId, value }: { rowId: string; propId: string; value: CellValue }) =>
      api<RowResponse>(`/databases/${id}/rows/${rowId}`, { method: "PATCH", body: { values: { [propId]: value } } }),
    onMutate: ({ rowId, propId, value }) =>
      patch((d) => ({
        ...d,
        rows: d.rows.map((r) =>
          r.id === rowId
            ? { ...r, values: { ...r.values, [propId]: value }, title: d.properties.find((p) => p.id === propId)?.type === "title" ? String(value ?? "") : r.title }
            : r,
        ),
      })),
    onSuccess: ({ row, related }) => {
      patch((d) => ({ ...d, related: { ...d.related, ...related }, rows: d.rows.map((r) => (r.id === row.id ? row : r)) }));
      // Other databases may show this row through relations and rollups.
      return qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "database" && q.queryKey[1] !== id });
    },
    onError: (err) => {
      alert(err instanceof Error ? err.message : String(err));
      return refresh();
    },
  });

  const addRow = useMutation({
    mutationFn: (values: Record<string, CellValue> = {}) => api<RowResponse>(`/databases/${id}/rows`, { method: "POST", body: { values } }),
    onSuccess: ({ row, related }) => patch((d) => ({ ...d, related: { ...d.related, ...related }, rows: [...d.rows, row] })),
  });

  const deleteRows = useMutation({
    mutationFn: (ids: string[]) => api(`/databases/${id}/rows/delete`, { method: "POST", body: { ids } }),
    onMutate: (ids) => patch((d) => ({ ...d, rows: d.rows.filter((r) => !ids.includes(r.id)) })),
    onSettled: () => Promise.all([refresh(), qc.invalidateQueries({ queryKey: ["trash"] })]),
  });

  const addProperty = useMutation({
    mutationFn: (p: { name: string; type: PropertyType; config?: PropertyConfig; twoWay?: boolean }) =>
      api<{ property: DatabaseProperty }>(`/databases/${id}/properties`, { method: "POST", body: { config: {}, ...p } }),
    onSuccess: ({ property }) => {
      patch((d) => ({ ...d, properties: [...d.properties, property] }));
      // Rollups are computed by the server; a two-way relation adds a column elsewhere.
      if (property.type === "rollup" || property.type === "relation") return qc.invalidateQueries({ queryKey: ["database"] });
    },
    onError: (err) => alert(err instanceof Error ? err.message : String(err)),
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
    mutationFn: ({ viewId, ...body }: { viewId: string; config?: ViewConfig; name?: string; type?: ViewType }) =>
      api(`/databases/${id}/views/${viewId}`, { method: "PATCH", body }),
    onMutate: ({ viewId, ...changes }) => patch((d) => ({ ...d, views: d.views.map((v) => (v.id === viewId ? { ...v, ...changes } : v)) })),
    onError: (err) => {
      alert(err instanceof Error ? err.message : String(err));
      return refresh();
    },
  });

  const createView = useMutation({
    mutationFn: (body: { name: string; type: ViewType; duplicateOf?: string }) => api<{ view: DatabaseViewInfo }>(`/databases/${id}/views`, { method: "POST", body }),
    onSuccess: ({ view }) => patch((d) => ({ ...d, views: [...d.views, view] })),
    onError: (err) => alert(err instanceof Error ? err.message : String(err)),
  });

  const deleteView = useMutation({
    mutationFn: (viewId: string) => api(`/databases/${id}/views/${viewId}`, { method: "DELETE" }),
    onMutate: (viewId) => patch((d) => ({ ...d, views: d.views.filter((v) => v.id !== viewId) })),
    onSettled: refresh,
  });

  return { updateCell, addRow, deleteRows, addProperty, updateProperty, deleteProperty, updateView, createView, deleteView, refresh };
}

const VIEW_KEY = "nootion-view-";

/** The view shown for a database, remembered per browser. */
export function useActiveView(databaseId: string, views: DatabaseViewInfo[]) {
  const [picked, setPicked] = useState<string | null>(() => {
    try {
      return localStorage.getItem(VIEW_KEY + databaseId);
    } catch {
      return null;
    }
  });
  const view = views.find((v) => v.id === picked) ?? views[0];
  const select = (viewId: string) => {
    setPicked(viewId);
    try {
      localStorage.setItem(VIEW_KEY + databaseId, viewId);
    } catch {
      // Private browsing: the choice just isn't remembered.
    }
  };
  return [view, select] as const;
}
