import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PageDetail, PageSummary, UserDirectoryEntry, WorkspaceSummary } from "@nootion/shared";
import { api } from "./api";
import { useOfflineQueue, withQueuedPage, withQueuedPages } from "./offline";

export const keys = {
  workspaces: ["workspaces"] as const,
  pages: (workspaceId: string) => ["pages", workspaceId] as const,
  shared: ["shared"] as const,
  page: (id: string) => ["page", id] as const,
  users: ["users"] as const,
  favorites: ["favorites"] as const,
};

export function useWorkspaces() {
  return useQuery({ queryKey: keys.workspaces, queryFn: async () => (await api<{ workspaces: WorkspaceSummary[] }>("/workspaces")).workspaces });
}

export function useWorkspacePages(workspaceId: string) {
  const { pending } = useOfflineQueue();
  return useQuery({
    queryKey: keys.pages(workspaceId),
    queryFn: async () => (await api<{ pages: PageSummary[] }>(`/workspaces/${workspaceId}/pages`)).pages,
    select: pending ? withQueuedPages : undefined,
  });
}

export function useSharedPages() {
  const { pending } = useOfflineQueue();
  return useQuery({
    queryKey: keys.shared,
    queryFn: async () => (await api<{ pages: (PageSummary & { shared: boolean })[] }>("/pages/shared")).pages,
    select: pending ? withQueuedPages : undefined,
  });
}

export function usePage(id: string) {
  const { pending } = useOfflineQueue();
  return useQuery({
    queryKey: keys.page(id),
    queryFn: async () => (await api<{ page: PageDetail }>(`/pages/${id}`)).page,
    // Title or icon changed offline shows until the server has it.
    select: pending ? withQueuedPage : undefined,
    enabled: !!id,
  });
}

/** The current user's starred pages, in their chosen order. */
export function useFavorites() {
  return useQuery({ queryKey: keys.favorites, queryFn: async () => (await api<{ pages: PageSummary[] }>("/favorites")).pages });
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
      qc.invalidateQueries({ queryKey: keys.favorites }),
      qc.invalidateQueries({ queryKey: ["library"] }),
      qc.invalidateQueries({ queryKey: ["graph"] }),
    ]);
}
