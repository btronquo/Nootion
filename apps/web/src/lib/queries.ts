import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PageDetail, PageSummary, UserDirectoryEntry, WorkspaceSummary } from "@nootion/shared";
import { api } from "./api";

export const keys = {
  workspaces: ["workspaces"] as const,
  pages: (workspaceId: string) => ["pages", workspaceId] as const,
  shared: ["shared"] as const,
  page: (id: string) => ["page", id] as const,
  users: ["users"] as const,
};

export function useWorkspaces() {
  return useQuery({ queryKey: keys.workspaces, queryFn: async () => (await api<{ workspaces: WorkspaceSummary[] }>("/workspaces")).workspaces });
}

export function useWorkspacePages(workspaceId: string) {
  return useQuery({
    queryKey: keys.pages(workspaceId),
    queryFn: async () => (await api<{ pages: PageSummary[] }>(`/workspaces/${workspaceId}/pages`)).pages,
  });
}

export function useSharedPages() {
  return useQuery({
    queryKey: keys.shared,
    queryFn: async () => (await api<{ pages: (PageSummary & { shared: boolean })[] }>("/pages/shared")).pages,
  });
}

export function usePage(id: string) {
  return useQuery({ queryKey: keys.page(id), queryFn: async () => (await api<{ page: PageDetail }>(`/pages/${id}`)).page });
}

export function useUserDirectory() {
  return useQuery({ queryKey: keys.users, queryFn: async () => (await api<{ users: UserDirectoryEntry[] }>("/users")).users });
}

/** Refreshes everything that shows page lists (sidebar trees, shared section, open pages). */
export function useRefreshPages() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["pages"] }),
      qc.invalidateQueries({ queryKey: keys.shared }),
      qc.invalidateQueries({ queryKey: ["page"] }),
      qc.invalidateQueries({ queryKey: ["trash"] }),
    ]);
}
