import { useState } from "react";
import { SmilePlus } from "lucide-react";
import { t } from "@nootion/shared";

const ICONS = ["📄", "📝", "📒", "📚", "💡", "✅", "📌", "📅", "💰", "🧾", "📊", "🏠", "🛒", "🍳", "✈️", "🎯", "🔧", "💼", "❤️", "⭐"];

export function IconPicker({ icon, editable, onChange }: { icon: string | null; editable: boolean; onChange: (icon: string | null) => void }) {
  const [open, setOpen] = useState(false);
  if (!editable && !icon) return null;
  return (
    <div className="relative mb-2">
      {icon ? (
        <button disabled={!editable} onClick={() => setOpen(!open)} className="rounded-lg p-1 text-5xl hover:bg-neutral-100 disabled:hover:bg-transparent dark:hover:bg-neutral-800">
          {icon}
        </button>
      ) : (
        <button onClick={() => setOpen(!open)} className="flex items-center gap-1 rounded px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800">
          <SmilePlus size={16} /> {t("icon.add")}
        </button>
      )}
      {open && (
        <div className="nt-pop absolute z-10 mt-1 w-64 rounded-lg border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          <div className="grid grid-cols-8 gap-1">
            {ICONS.map((i) => (
              <button
                key={i}
                className="rounded p-1 text-xl hover:bg-neutral-100 dark:hover:bg-neutral-800"
                onClick={() => {
                  onChange(i);
                  setOpen(false);
                }}
              >
                {i}
              </button>
            ))}
          </div>
          {icon && (
            <button
              className="mt-2 w-full rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              {t("icon.remove")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
