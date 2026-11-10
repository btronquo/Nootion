import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, Link2, Maximize2, SmilePlus, Star, Trash2 } from "lucide-react";
import { intlLocale, t, type DatabaseData, type DatabaseRow } from "@nootion/shared";
import { api } from "../lib/api";
import { copyText } from "../lib/browser";
import { keys, useFavorites } from "../lib/queries";
import { Popover } from "./Popover";
import { toElement, type MenuAnchor } from "../components/PageMenu";
import { IconPanel, remember } from "../components/IconPicker";
import type { useDatabaseActions } from "./hooks";

type Actions = ReturnType<typeof useDatabaseActions>;

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl+";

interface Entry {
  key: string;
  icon: ReactNode;
  label: string;
  shortcut?: string;
  danger?: boolean;
  run: () => unknown;
  /** Starts a new section above it. */
  section?: string;
}

/**
 * The menu of a database row, as in Notion: on a right click on the row, or a click on its ⋮⋮ handle.
 * With several selected rows, it acts on all of them (duplicate, trash).
 */
export function RowMenu({
  data,
  rows,
  anchor,
  actions,
  editable,
  rowHref,
  onClose,
  onDone,
}: {
  data: DatabaseData;
  rows: DatabaseRow[];
  anchor: MenuAnchor;
  actions: Actions;
  editable: boolean;
  rowHref: (row: DatabaseRow) => string;
  onClose: () => void;
  /** After the rows were trashed or duplicated (to clear the selection). */
  onDone?: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const favorites = useFavorites();
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState(false);
  const element = useMemo(() => toElement(anchor), [anchor]);
  const search = useRef<HTMLInputElement>(null);
  const row = rows.length === 1 ? rows[0] : null;
  const starred = !!row && !!favorites.data?.some((p) => p.id === row.id);

  const close = (action: () => unknown) => () => {
    onClose();
    void Promise.resolve(action()).catch((e: Error) => alert(e.message));
  };

  function trash() {
    if (rows.length > 1 && !confirm(t("table.confirmTrash", { count: rows.length }))) return;
    actions.deleteRows.mutate(rows.map((r) => r.id));
    onDone?.();
  }

  async function duplicate() {
    for (const r of rows) await actions.duplicateRow.mutateAsync(r.id);
    onDone?.();
  }

  async function toggleFavorite() {
    if (!row) return;
    await api(`/favorites/${row.id}`, { method: starred ? "DELETE" : "PUT" });
    await qc.invalidateQueries({ queryKey: keys.favorites });
  }

  const entries: Entry[] = [];
  if (row) {
    entries.push({
      key: "favorite",
      section: t("rowMenu.page"),
      icon: <Star size={15} className={starred ? "fill-amber-400 text-amber-400" : ""} />,
      label: starred ? t("favorites.remove") : t("favorites.add"),
      run: close(toggleFavorite),
    });
    if (editable) entries.push({ key: "icon", icon: <SmilePlus size={15} />, label: t("rowMenu.editIcon"), run: () => setPicking(true) });
    entries.push(
      { key: "open", section: "", icon: <Maximize2 size={15} />, label: t("common.open"), run: close(() => navigate(rowHref(row))) },
      { key: "tab", icon: <ExternalLink size={15} />, label: t("page.openNewTab"), run: close(() => void window.open(rowHref(row), "_blank", "noopener")) },
      { key: "link", section: "", icon: <Link2 size={15} />, label: t("page.copyLink"), run: close(() => copyText(`${location.origin}${rowHref(row)}`)) },
    );
  }
  if (editable) {
    entries.push(
      { key: "duplicate", section: row ? undefined : t("rowMenu.rows", { count: rows.length }), icon: <Copy size={15} />, label: t("page.duplicate"), shortcut: `${MOD}D`, run: close(duplicate) },
      { key: "trash", icon: <Trash2 size={15} />, label: t("page.trash"), shortcut: t("rowMenu.del"), danger: true, run: close(trash) },
    );
  }

  const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();
  const shown = query ? entries.filter((e) => fold(e.label).includes(fold(query))) : entries;
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [query]);

  // The shortcuts work while the menu is open, as in Notion.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (picking) return;
      const byKey = (k: string) => entries.find((x) => x.key === k);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d" && byKey("duplicate")) {
        e.preventDefault();
        byKey("duplicate")!.run();
      } else if (e.key === "Delete" && byKey("trash")) {
        e.preventDefault();
        byKey("trash")!.run();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  if (picking && row) {
    return (
      <IconPanel
        anchor={element}
        hasIcon={!!row.icon}
        onClose={onClose}
        onPick={(icon) => {
          if (icon) remember(icon);
          actions.setRowIcon.mutate({ rowId: row.id, icon });
          onClose();
        }}
      />
    );
  }

  const when = (iso: string) => new Intl.DateTimeFormat(intlLocale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  const author = row?.createdBy ? data.people[row.createdBy] : undefined;

  return (
    <Popover anchor={element} onClose={onClose} width={280}>
      <div role="menu" aria-label={t("rowMenu.label")} data-row-menu>
        <input
          ref={search}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const n = shown.length || 1;
              setActive((a) => (a + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
            } else if (e.key === "Enter" && shown[active]) {
              e.preventDefault();
              shown[active].run();
            }
          }}
          placeholder={t("rowMenu.search")}
          aria-label={t("rowMenu.search")}
          className="mb-1 w-full rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 outline-none focus:border-blue-500 dark:border-neutral-700"
        />
        {shown.map((e, i) => (
          <div key={e.key}>
            {!query && e.section !== undefined && i > 0 && <div className="my-1 h-px bg-neutral-200 dark:bg-neutral-800" />}
            {!query && e.section && <div className="px-2 pb-0.5 pt-1 text-xs font-medium text-neutral-500">{e.section}</div>}
            <button
              type="button"
              role="menuitem"
              onClick={e.run}
              onMouseEnter={() => setActive(i)}
              className={`flex w-full items-center gap-2 whitespace-nowrap rounded px-2 py-1.5 text-left ${i === active ? "bg-neutral-100 dark:bg-neutral-800" : ""} ${e.danger ? "text-red-600 dark:text-red-400" : ""}`}
            >
              <span className="flex w-4 shrink-0 justify-center text-neutral-500">{e.icon}</span>
              <span className="flex-1">{e.label}</span>
              {e.shortcut && <span className="text-xs text-neutral-400">{e.shortcut}</span>}
            </button>
          </div>
        ))}
        {shown.length === 0 && <p className="px-2 py-1.5 text-neutral-500">{t("rowMenu.none")}</p>}
        {row && !query && (
          <div className="mt-1 border-t border-neutral-200 px-2 pb-1 pt-2 text-xs text-neutral-500 dark:border-neutral-800">
            <div>{t("rowMenu.edited", { date: when(row.updatedAt) })}</div>
            <div>{author ? t("rowMenu.createdBy", { name: author, date: when(row.createdAt) }) : t("rowMenu.created", { date: when(row.createdAt) })}</div>
          </div>
        )}
      </div>
    </Popover>
  );
}
