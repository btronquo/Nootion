import { useState } from "react";
import { Check, Plus } from "lucide-react";
import { OPTION_COLORS, STATUS_GROUPS, orderedOptions, statusGroupOf, type DatabaseProperty, type SelectOption, type StatusGroup } from "@nootion/shared";
import { OPTION_CLASSES } from "./format";
import { t } from "@nootion/shared";
import { randomId } from "../lib/browser";

/** An option's pill; a status shows a dot before its name, like Notion, filled as the work advances. */
export function OptionChip({ option, status }: { option: SelectOption; status?: boolean }) {
  if (!status) return <span className={`inline-block max-w-full truncate rounded px-1.5 py-0.5 text-xs ${OPTION_CLASSES[option.color]}`}>{option.name}</span>;
  const group = statusGroupOf(option);
  const dot = group === "done" ? "bg-current" : group === "in_progress" ? "bg-current opacity-60" : "border border-current opacity-70";
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs ${OPTION_CLASSES[option.color]}`}>
      <span aria-hidden className={`size-2 shrink-0 rounded-full ${dot}`} />
      <span className="truncate">{option.name}</span>
    </span>
  );
}

export const statusGroupLabel = (g: StatusGroup) => t(`status.group.${g}`);

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Choose (or create) one or several options of a select column. */
export function OptionPicker({
  prop,
  selected,
  multi,
  onChange,
  onCreate,
}: {
  prop: DatabaseProperty;
  selected: string[];
  multi: boolean;
  onChange: (ids: string[]) => void;
  onCreate: (name: string) => Promise<SelectOption>;
}) {
  const [query, setQuery] = useState("");
  const options = orderedOptions(prop);
  const status = prop.type === "status";
  const filtered = options.filter((o) => norm(o.name).includes(norm(query)));
  const exact = options.find((o) => norm(o.name) === norm(query));

  const toggle = (id: string) => {
    if (multi) onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
    else onChange(selected[0] === id ? [] : [id]);
  };

  return (
    <div>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={async (e) => {
          if (e.key !== "Enter" || !query.trim()) return;
          e.preventDefault();
          if (exact) toggle(exact.id);
          else {
            const o = await onCreate(query.trim());
            onChange(multi ? [...selected, o.id] : [o.id]);
          }
          setQuery("");
        }}
        placeholder={multi ? t("option.searchMany") : t("option.searchOne")}
        className="mb-1 w-full rounded border border-neutral-200 bg-transparent px-2 py-1.5 outline-none focus:border-neutral-400 dark:border-neutral-700"
      />
      <div className="max-h-64 overflow-y-auto">
        {(status ? STATUS_GROUPS.map((g) => ({ g, list: filtered.filter((o) => statusGroupOf(o) === g) })) : [{ g: null, list: filtered }]).map(
          ({ g, list }) =>
            (!g || list.length > 0) && (
              <div key={g ?? "all"}>
                {g && <p className="px-2 pb-0.5 pt-1.5 text-xs text-neutral-500">{statusGroupLabel(g)}</p>}
                {list.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => toggle(o.id)}
                    className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    <OptionChip option={o} status={status} />
                    {selected.includes(o.id) && <Check size={14} />}
                  </button>
                ))}
              </div>
            ),
        )}
        {query.trim() && !exact && (
          <button
            onClick={async () => {
              const o = await onCreate(query.trim());
              onChange(multi ? [...selected, o.id] : [o.id]);
              setQuery("");
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <Plus size={14} /> {t("option.create", { name: query.trim() })}
          </button>
        )}
        {!filtered.length && !query && <p className="px-2 py-1 text-neutral-500">{t("option.none")}</p>}
      </div>
    </div>
  );
}

export function newOption(name: string, existing: SelectOption[], group?: StatusGroup): SelectOption {
  return { id: randomId().slice(0, 8), name, color: OPTION_COLORS[(existing.length + 1) % OPTION_COLORS.length], ...(group ? { group } : {}) };
}
