import { useQuery, useQueryClient } from "@tanstack/react-query";
import { dayString, type TaskEntry, type TasksResponse } from "@nootion/shared";
import { api } from "../lib/api";

export interface TaskFilters {
  workspaceId?: string;
  mine?: boolean;
  dated?: boolean;
}

export const tasksKey = ["tasks"] as const;

/** Every to-do of the pages one can read, refreshed when the list comes back into view. */
export function useTasks(filters: TaskFilters = {}, opts: { enabled?: boolean } = {}) {
  const params = new URLSearchParams();
  if (filters.workspaceId) params.set("workspaceId", filters.workspaceId);
  if (filters.mine) params.set("mine", "1");
  if (filters.dated) params.set("dated", "1");
  const query = params.toString();
  return useQuery({
    queryKey: [...tasksKey, query],
    queryFn: () => api<TasksResponse>(`/tasks${query ? `?${query}` : ""}`),
    enabled: opts.enabled ?? true,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

/** Where a to-do is in its page: the page opens there and shows it for a moment. */
export function taskHref(task: TaskEntry): string {
  return `/page/${task.pageId}${task.key.startsWith("b:") ? `#block-${task.key.slice(2)}` : `#task-${task.key.slice(2)}`}`;
}

/** Checks or unchecks a to-do in its page, showing it at once in every list. */
export function useCheckTask() {
  const qc = useQueryClient();
  return async (task: TaskEntry, checked: boolean) => {
    const now = new Date().toISOString();
    const same = (x: TaskEntry) => x.pageId === task.pageId && x.key === task.key;
    qc.setQueriesData<TasksResponse>({ queryKey: tasksKey }, (old) => {
      if (!old) return old;
      const moved = { ...task, checked, checkedAt: checked ? now : null };
      return checked
        ? { ...old, tasks: old.tasks.filter((x) => !same(x)), done: [moved, ...old.done.filter((x) => !same(x))] }
        : { ...old, done: old.done.filter((x) => !same(x)), tasks: old.tasks.some(same) ? old.tasks : [moved, ...old.tasks] };
    });
    try {
      await api("/tasks/check", { method: "POST", body: { pageId: task.pageId, key: task.key, text: task.text, checked, today: dayString(new Date()) } });
    } catch (e) {
      // Offline, no right to edit, or the page changed meanwhile (409): the list is read again and says why.
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      await qc.invalidateQueries({ queryKey: tasksKey });
    }
  };
}
