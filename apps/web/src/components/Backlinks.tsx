import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Link2 } from "lucide-react";
import { t, type Backlink } from "@nootion/shared";
import { api } from "../lib/api";
import { pageTitle } from "../lib/tree";

/** "Linked from": the pages that link to or mention this one. Hidden when there are none. */
export function Backlinks({ pageId }: { pageId: string }) {
  const [open, setOpen] = useState(true);
  const links = useQuery({
    queryKey: ["backlinks", pageId],
    queryFn: async () => (await api<{ pages: Backlink[] }>(`/pages/${pageId}/backlinks`)).pages,
    staleTime: 0,
  });
  if (!links.data?.length) return null;
  return (
    <section className="mt-12 border-t border-neutral-200 pt-4 dark:border-neutral-800" data-backlinks>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-sm font-medium text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
      >
        <ChevronRight size={14} className={`transition ${open ? "rotate-90" : ""}`} />
        <Link2 size={14} /> {t("backlinks.title", { count: links.data.length })}
      </button>
      {open && (
        <ul className="mt-2 space-y-1">
          {links.data.map((p) => (
            <li key={p.id}>
              <Link to={`/page/${p.id}`} className="block rounded px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <span className="w-5 shrink-0 text-center">{p.icon ?? (p.kind === "database" ? "🗃" : "📄")}</span>
                  <span className="truncate">{pageTitle(p.title)}</span>
                </span>
                {p.excerpt && <span className="ml-7 block truncate text-xs text-neutral-500">{p.excerpt}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
