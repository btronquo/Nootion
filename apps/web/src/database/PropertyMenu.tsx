import { useState } from "react";
import { EyeOff, Trash2, X } from "lucide-react";
import { CREATABLE_TYPES, OPTION_COLORS, type DatabaseProperty, type OptionColor, type PropertyConfig, type PropertyType } from "@nootion/shared";
import { COLOR_LABELS, CURRENCIES, OPTION_CLASSES, TYPE_LABELS } from "./format";

/** Settings of a column: name, type, type options, hide, delete. */
export function PropertyMenu({
  prop,
  onRename,
  onChangeType,
  onChangeConfig,
  onHide,
  onDelete,
}: {
  prop: DatabaseProperty;
  onRename: (name: string) => void;
  onChangeType: (type: PropertyType) => void;
  onChangeConfig: (config: PropertyConfig) => void;
  onHide?: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(prop.name);
  const commitName = () => name.trim() && name.trim() !== prop.name && onRename(name.trim());
  const isNumeric = prop.type === "number" || prop.type === "currency" || prop.type === "percent";
  const field = "w-full rounded border border-neutral-200 bg-transparent px-2 py-1 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900";

  return (
    <div className="space-y-2 p-1">
      <input
        autoFocus
        aria-label="Nom de la colonne"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => e.key === "Enter" && commitName()}
        className={field}
      />
      <label className="block">
        <span className="mb-0.5 block text-xs text-neutral-500">Type</span>
        <select
          aria-label="Type de la colonne"
          className={field}
          value={prop.type}
          disabled={prop.type === "title"}
          onChange={(e) => {
            const next = e.target.value as PropertyType;
            if (confirm(`Changer « ${prop.name} » en ${TYPE_LABELS[next]} ? Les valeurs existantes seront converties quand c'est possible.`)) onChangeType(next);
          }}
        >
          {(prop.type === "title" ? (["title"] as PropertyType[]) : CREATABLE_TYPES).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>

      {prop.type === "currency" && (
        <label className="block">
          <span className="mb-0.5 block text-xs text-neutral-500">Devise</span>
          <select className={field} value={prop.config.currency ?? "EUR"} onChange={(e) => onChangeConfig({ ...prop.config, currency: e.target.value })}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      )}
      {isNumeric && (
        <label className="block">
          <span className="mb-0.5 block text-xs text-neutral-500">Décimales</span>
          <select
            className={field}
            value={prop.config.decimals ?? ""}
            onChange={(e) => onChangeConfig({ ...prop.config, decimals: e.target.value === "" ? undefined : Number(e.target.value) })}
          >
            <option value="">Automatique</option>
            {[0, 1, 2, 3, 4].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      )}
      {prop.type === "date" && (
        <label className="flex items-center gap-2 px-1">
          <input type="checkbox" checked={!!prop.config.includeTime} onChange={(e) => onChangeConfig({ ...prop.config, includeTime: e.target.checked })} />
          Inclure l'heure
        </label>
      )}
      {(prop.type === "select" || prop.type === "multi_select") && (
        <div>
          <span className="mb-0.5 block text-xs text-neutral-500">Options</span>
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {(prop.config.options ?? []).map((o) => (
              <div key={o.id} className="flex items-center gap-1">
                <select
                  aria-label={`Couleur de ${o.name}`}
                  value={o.color}
                  onChange={(e) =>
                    onChangeConfig({ ...prop.config, options: prop.config.options!.map((x) => (x.id === o.id ? { ...x, color: e.target.value as OptionColor } : x)) })
                  }
                  className={`w-20 shrink-0 rounded px-1 py-0.5 text-xs ${OPTION_CLASSES[o.color]}`}
                >
                  {OPTION_COLORS.map((c) => (
                    <option key={c} value={c}>
                      {COLOR_LABELS[c]}
                    </option>
                  ))}
                </select>
                <input
                  defaultValue={o.name}
                  aria-label="Nom de l'option"
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== o.name) onChangeConfig({ ...prop.config, options: prop.config.options!.map((x) => (x.id === o.id ? { ...x, name: v } : x)) });
                  }}
                  className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-neutral-200 focus:border-neutral-400 dark:hover:border-neutral-700"
                />
                <button
                  title="Supprimer l'option"
                  className="text-neutral-400 hover:text-red-600"
                  onClick={() =>
                    confirm(`Supprimer l'option « ${o.name} » ? Elle sera retirée des lignes qui l'utilisent.`) &&
                    onChangeConfig({ ...prop.config, options: prop.config.options!.filter((x) => x.id !== o.id) })
                  }
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            {!prop.config.options?.length && <p className="px-1 text-xs text-neutral-500">Les options se créent en tapant dans une cellule.</p>}
          </div>
        </div>
      )}

      <div className="border-t border-neutral-200 pt-1 dark:border-neutral-700">
        {onHide && (
          <button onClick={onHide} className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
            <EyeOff size={14} /> Masquer dans cette vue
          </button>
        )}
        {prop.type !== "title" && (
          <button
            onClick={() => confirm(`Supprimer la colonne « ${prop.name} » et toutes ses valeurs ?`) && onDelete()}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
          >
            <Trash2 size={14} /> Supprimer la colonne
          </button>
        )}
      </div>
    </div>
  );
}
