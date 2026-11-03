import { useSyncExternalStore } from "react";

/** When each open page was last saved on the server, as seen from this tab (own edits or others'). */
const saved = new Map<string, { at: number; own: boolean }>();
const listeners = new Set<() => void>();

export function markSaved(pageId: string, own: boolean) {
  saved.set(pageId, { at: Date.now(), own });
  for (const l of listeners) l();
}

export function useLastSaved(pageId: string) {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => saved.get(pageId),
  );
}
