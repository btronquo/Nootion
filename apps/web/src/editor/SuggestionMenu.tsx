import { forwardRef, useEffect, useImperativeHandle, useState, type ReactNode } from "react";

export interface MenuItem {
  title: string;
  hint?: string;
  icon?: ReactNode;
  run: () => void;
}

export interface SuggestionMenuHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

/** Keyboard-driven popup list used by the "/" and "@" menus. */
export const SuggestionMenu = forwardRef<SuggestionMenuHandle, { items: MenuItem[]; empty: string }>(function SuggestionMenu({ items, empty }, ref) {
  const [selected, setSelected] = useState(0);
  useEffect(() => setSelected(0), [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown(event) {
      if (!items.length) return false;
      if (event.key === "ArrowDown") {
        setSelected((s) => (s + 1) % items.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        setSelected((s) => (s - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        items[selected]?.run();
        return true;
      }
      return false;
    },
  }));

  return (
    <div className="max-h-80 w-72 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
      {items.length === 0 && <div className="px-2 py-1.5 text-sm text-neutral-500">{empty}</div>}
      {items.map((item, i) => (
        <button
          key={item.title + i}
          ref={(el) => {
            if (i === selected) el?.scrollIntoView({ block: "nearest" });
          }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => item.run()}
          onMouseEnter={() => setSelected(i)}
          className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${i === selected ? "bg-neutral-100 dark:bg-neutral-800" : ""}`}
        >
          {item.icon && <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-neutral-200 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">{item.icon}</span>}
          <span className="min-w-0">
            <span className="block truncate">{item.title}</span>
            {item.hint && <span className="block truncate text-xs text-neutral-500">{item.hint}</span>}
          </span>
        </button>
      ))}
    </div>
  );
});
