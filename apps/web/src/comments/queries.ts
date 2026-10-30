import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CommentNotification, CommentThread } from "@nootion/shared";
import { api } from "../lib/api";

export const commentsKey = (pageId: string) => ["comments", pageId] as const;
export const commentNotificationsKey = ["comment-notifications"] as const;

/** A page's comment threads, refreshed now and then to see the others' comments. */
export function useComments(pageId: string, enabled = true) {
  return useQuery({
    queryKey: commentsKey(pageId),
    queryFn: async () => (await api<{ threads: CommentThread[] }>(`/pages/${pageId}/comments`)).threads,
    refetchInterval: 20_000,
    enabled,
  });
}

/** Mentions and replies for the user. */
export function useCommentNotifications() {
  return useQuery({
    queryKey: commentNotificationsKey,
    queryFn: async () => (await api<{ notifications: CommentNotification[] }>("/comments/notifications")).notifications,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });
}

/** Runs a change on a thread and puts the thread the server sends back in the page's list. */
export function useThreadUpdate(pageId: string) {
  const qc = useQueryClient();
  return async (call: () => Promise<{ thread: CommentThread | null }>, threadId?: string) => {
    const { thread } = await call();
    qc.setQueryData<CommentThread[]>(commentsKey(pageId), (old = []) => {
      const id = thread?.id ?? threadId;
      const rest = old.filter((th) => th.id !== id);
      return thread ? (old.some((th) => th.id === id) ? old.map((th) => (th.id === id ? thread : th)) : [...rest, thread]) : rest;
    });
    return thread;
  };
}
