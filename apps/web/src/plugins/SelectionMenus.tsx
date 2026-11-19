import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { ChevronDown } from "lucide-react";
import { selectionMenus, type PluginSelectionMenu } from "./registry";
import { openSelectionPanel, selectedText } from "../editor/selectionPanel";

/** Runs an entry of a plugin's selection menu on the current selection. */
export function runSelectionAction(editor: Editor, pageId: string, menu: PluginSelectionMenu, action: PluginSelectionMenu["actions"][number]) {
  const text = selectedText(editor);
  try {
    void Promise.resolve(action.run({ text, pageId, showPanel: (render) => openSelectionPanel(editor, render, { label: menu.label }) })).catch((e) =>
      console.warn("Selection menu entry failed", e),
    );
  } catch (e) {
    // One broken plugin must not break the editor.
    console.warn("Selection menu entry failed", e);
  }
}

/** The entries of a menu, and its note: in the selection menu's drop-down, or the sheet above the phone's keyboard. */
export function SelectionMenuEntries({ menu, onPick }: { menu: PluginSelectionMenu; onPick: (action: PluginSelectionMenu["actions"][number]) => void }) {
  let note: string | null | undefined = null;
  try {
    note = menu.note?.();
  } catch {
    note = null;
  }
  return (
    <div role="menu" aria-label={menu.label} className="min-w-56 py-1">
      {menu.actions.map((a) => (
        <button
          key={a.id}
          role="menuitem"
          type="button"
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-neutral-100 max-md:py-2.5 dark:hover:bg-neutral-800"
          onClick={() => onPick(a)}
        >
          <span className="w-5 text-center">{a.icon ?? ""}</span>
          {a.label}
        </button>
      ))}
      {note && (
        <div className="mt-1 border-t md:max-w-72 border-neutral-200 px-3 pt-1.5 pb-1 text-xs text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          {note}
        </div>
      )}
    </div>
  );
}

/** Buttons of plugins' selection menus, in the menu shown over a selection. */
export function PluginSelectionButtons({ editor, pageId }: { editor: Editor; pageId: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  // A click elsewhere closes the drop-down.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const menus = selectionMenus();
  if (!menus.length) return null;
  return (
    <div ref={ref} className="relative flex items-center">
      <span className="mx-0.5 h-5 w-px bg-neutral-200 dark:bg-neutral-700" />
      {menus.map(({ id, menu }) => (
        <div key={id} className="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={open === id}
            className={`flex items-center gap-1 rounded px-1.5 py-1 text-sm ${open === id ? "bg-neutral-200 dark:bg-neutral-700" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
            onClick={() => setOpen((o) => (o === id ? null : id))}
            data-selection-menu={id}
          >
            {menu.icon && <span>{menu.icon}</span>}
            <span className="whitespace-nowrap">{menu.label}</span>
            <ChevronDown size={13} />
          </button>
          {open === id && (
            <div className="nt-pop absolute top-full left-0 z-50 mt-1.5 rounded-lg border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
              <SelectionMenuEntries
                menu={menu}
                onPick={(a) => {
                  setOpen(null);
                  runSelectionAction(editor, pageId, menu, a);
                }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
