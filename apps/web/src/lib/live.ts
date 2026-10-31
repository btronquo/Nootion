import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { keys } from "./queries";

type LiveEvent = { type: "pages"; workspaceId: string } | { type: "access" };

/**
 * Listens to the server for changes made by others (a page added to a shared space, a new share…) and refetches
 * what they change, so the sidebar is up to date without reloading.
 */
export function useLiveEvents(signedIn: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!signedIn || typeof EventSource === "undefined") return;
    const source = new EventSource("/api/events");
    const refreshTree = (workspaceId?: string) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: workspaceId ? keys.pages(workspaceId) : ["pages"] }),
        qc.invalidateQueries({ queryKey: keys.shared }),
        qc.invalidateQueries({ queryKey: keys.favorites }),
        qc.invalidateQueries({ queryKey: ["trash"] }),
        qc.invalidateQueries({ queryKey: ["library"] }),
        qc.invalidateQueries({ queryKey: ["graph"] }),
      ]);
    let opened = false;
    source.onopen = () => {
      // After a lost connection, catch up on what was missed meanwhile.
      if (opened) void Promise.all([refreshTree(), qc.invalidateQueries({ queryKey: keys.workspaces })]);
      opened = true;
    };
    source.onmessage = (e) => {
      const event = JSON.parse(e.data) as LiveEvent;
      if (event.type === "pages") void refreshTree(event.workspaceId);
      else void Promise.all([qc.invalidateQueries({ queryKey: keys.workspaces }), refreshTree()]);
    };
    return () => source.close();
  }, [signedIn, qc]);
}
