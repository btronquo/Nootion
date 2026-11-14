import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { PageSummary } from "@nootion/shared";
import { api } from "./api";
import { copyText } from "./browser";
import { keys, useFavorites, useRefreshPages } from "./queries";

/**
 * What can be done to a page from its menu in the sidebar, its header, or the command palette: written once
 * here so that the three behave the same.
 */
export function usePageActions(page: PageSummary) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const refresh = useRefreshPages();
  const favorites = useFavorites();
  const starred = !!favorites.data?.some((p) => p.id === page.id);

  return {
    starred,
    async toggleFavorite() {
      // Read again: the palette may run it after the list changed.
      const now = !!qc.getQueryData<PageSummary[]>(keys.favorites)?.some((p) => p.id === page.id);
      qc.setQueryData<PageSummary[]>(keys.favorites, (old = []) => (now ? old.filter((p) => p.id !== page.id) : [...old, page]));
      await api(`/favorites/${page.id}`, { method: now ? "DELETE" : "PUT" }).catch(() => {});
      await qc.invalidateQueries({ queryKey: keys.favorites });
    },
    async duplicate() {
      const { page: copy } = await api<{ page: PageSummary }>(`/pages/${page.id}/duplicate`, { method: "POST" });
      await refresh();
      navigate(`/page/${copy.id}`);
    },
    copyLink: () => copyText(`${location.origin}/page/${page.id}`),
    openInNewTab: () => void window.open(`/page/${page.id}`, "_blank", "noopener"),
    exportMarkdown() {
      const a = document.createElement("a");
      a.href = `/api/pages/${page.id}/export`;
      a.download = "";
      document.body.append(a);
      a.click();
      a.remove();
    },
  };
}
