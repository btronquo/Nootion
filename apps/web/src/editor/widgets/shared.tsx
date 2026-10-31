import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Settings2 } from "lucide-react";
import { applyView, t, type ViewContext } from "@nootion/shared";
import { useSession } from "../../lib/session";
import { pageTitle } from "../../lib/tree";
import { pageIcon } from "../../lib/icons";
import { useDatabase, useDatabaseList } from "../../database/hooks";
import { Popover } from "../../database/Popover";
import { tool } from "../HomeWidgets";

export const field =
  "w-full rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-900 dark:[color-scheme:dark]";

/** The gear of a widget, and its settings panel. */
export function useSettings() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const button = (
    <button className={tool} onClick={(e) => setAnchor(e.currentTarget)} aria-label={t("widget.settings")} title={t("widget.settings")}>
      <Settings2 size={14} />
    </button>
  );
  const panel = (children: ReactNode, width = 280) =>
    anchor && (
      <Popover anchor={anchor} onClose={() => setAnchor(null)} width={width}>
        <div className="space-y-2 p-2 text-sm" onKeyDown={(e) => e.key !== "Escape" && e.stopPropagation()}>
          {children}
        </div>
      </Popover>
    );
  return { button, panel, open: (el: HTMLElement) => setAnchor(el) };
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-xs text-neutral-500">{label}</span>
      {children}
    </label>
  );
}

/** Picks a database and one of its views (whose filters and sorts apply). */
export function DatabaseFields({
  databaseId,
  viewId,
  onChange,
}: {
  databaseId: string | null;
  viewId: string | null;
  onChange: (attrs: { databaseId?: string; viewId?: string | null }) => void;
}) {
  const list = useDatabaseList();
  const db = useDatabase(databaseId ?? "");
  return (
    <>
      <Field label={t("common.database")}>
        <select className={field} value={databaseId ?? ""} onChange={(e) => onChange({ databaseId: e.target.value, viewId: null })}>
          <option value="" disabled>
            {t("widget.chooseDatabase")}
          </option>
          {list.data?.map((d) => (
            <option key={d.id} value={d.id}>
              {pageIcon(d.icon) ?? "🗃"} {pageTitle(d.title)}
            </option>
          ))}
        </select>
      </Field>
      {databaseId && db.data && db.data.views.length > 1 && (
        <Field label={t("widget.view")}>
          <select className={field} value={viewId ?? db.data.views[0]!.id} onChange={(e) => onChange({ viewId: e.target.value })}>
            {db.data.views.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </Field>
      )}
    </>
  );
}

/** Rows of a database as one of its views shows them. */
export function useViewRows(databaseId: string | null, viewId: string | null) {
  const db = useDatabase(databaseId ?? "");
  const me = useSession().user?.id ?? null;
  const data = databaseId ? db.data : undefined;
  const view = data?.views.find((v) => v.id === viewId) ?? data?.views[0];
  const ctx: ViewContext | null = useMemo(() => (data ? { ...data, me } : null), [data, me]);
  const rows = useMemo(() => (ctx ? applyView(ctx, view?.config ?? {}) : []), [ctx, view?.config]);
  return { db, data, view, rows };
}

/** Re-renders every `ms` milliseconds; returns the current time. */
export function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(timer);
  }, [ms]);
  return now;
}

/** Hex colors of select options, for charts and dots. */
export const OPTION_HEX: Record<string, string> = {
  gray: "#9b9a97",
  brown: "#a27763",
  orange: "#d9730d",
  yellow: "#dfab01",
  green: "#4d9f6f",
  blue: "#2383e2",
  purple: "#9065b0",
  pink: "#c14c8a",
  red: "#e03e3e",
};
export const PALETTE = ["#2383e2", "#4d9f6f", "#d9730d", "#9065b0", "#e03e3e", "#dfab01", "#c14c8a", "#a27763", "#0f9fa8", "#9b9a97"];
