import { useMemo, useRef, useState } from "react";
import { EyeOff, Trash2, X } from "lucide-react";
import {
  CALC_LABELS,
  CREATABLE_TYPES,
  OPTION_COLORS,
  STRUCTURAL_TYPES,
  FUNCTIONS,
  FormulaError,
  calcFunctionsFor,
  formulaReferences,
  parseFormula,
  type DatabaseProperty,
  type OptionColor,
  type PropertyConfig,
  type PropertyType,
} from "@nootion/shared";
import { COLOR_LABELS, CURRENCIES, OPTION_CLASSES, TYPE_LABELS } from "./format";
import { useDatabase } from "./hooks";
import { pageTitle } from "../lib/tree";

/** Settings of a column: name, type, type options, hide, delete. */
export function PropertyMenu({
  prop,
  properties,
  onRename,
  onChangeType,
  onChangeConfig,
  onHide,
  onDelete,
}: {
  prop: DatabaseProperty;
  /** Every column of the database (rollups pick one of its relations). */
  properties: DatabaseProperty[];
  onRename: (name: string) => void;
  onChangeType: (type: PropertyType) => void;
  onChangeConfig: (config: PropertyConfig) => void;
  onHide?: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(prop.name);
  const commitName = () => name.trim() && name.trim() !== prop.name && onRename(name.trim());
  const isNumeric = prop.type === "number" || prop.type === "currency" || prop.type === "percent" || prop.type === "formula";
  const isCurrency = prop.type === "currency" || (prop.type === "formula" && prop.config.formulaFormat === "currency");
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
          disabled={prop.type === "title" || STRUCTURAL_TYPES.includes(prop.type)}
          onChange={(e) => {
            const next = e.target.value as PropertyType;
            if (confirm(`Changer « ${prop.name} » en ${TYPE_LABELS[next]} ? Les valeurs existantes seront converties quand c'est possible.`)) onChangeType(next);
          }}
        >
          {(prop.type === "title" || STRUCTURAL_TYPES.includes(prop.type) ? [prop.type] : CREATABLE_TYPES.filter((t) => !STRUCTURAL_TYPES.includes(t))).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>

      {prop.type === "formula" && <FormulaEditor prop={prop} properties={properties} onChange={onChangeConfig} field={field} />}
      {isCurrency && (
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
          <span className="mb-0.5 block text-xs text-neutral-500">{prop.type === "formula" ? "Décimales (résultats numériques)" : "Décimales"}</span>
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
      {prop.type === "relation" && <RelationInfo prop={prop} />}
      {prop.type === "rollup" && <RollupSettings prop={prop} properties={properties} onChange={onChangeConfig} field={field} />}
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

function RelationInfo({ prop }: { prop: DatabaseProperty }) {
  const target = useDatabase(prop.config.databaseId ?? "");
  return (
    <p className="px-1 text-xs text-neutral-500">
      Liée à <span className="font-medium text-neutral-700 dark:text-neutral-200">{target.data ? pageTitle(target.data.title) : "une database inaccessible"}</span>
      {prop.config.twinPropertyId ? ", dans les deux sens." : ", dans un seul sens."}
    </p>
  );
}

function RollupSettings({
  prop,
  properties,
  onChange,
  field,
}: {
  prop: DatabaseProperty;
  properties: DatabaseProperty[];
  onChange: (config: PropertyConfig) => void;
  field: string;
}) {
  const relations = properties.filter((p) => p.type === "relation");
  const relation = relations.find((p) => p.id === prop.config.relationPropertyId);
  const target = useDatabase(relation?.config.databaseId ?? "");
  const targets = (target.data?.properties ?? []).filter((p) => p.type !== "relation" && p.type !== "rollup");
  const targetProp = targets.find((p) => p.id === prop.config.targetPropertyId);
  const functions = targetProp ? ["show_original", ...calcFunctionsFor(targetProp.type)] : [];
  if (!relations.length) return <p className="px-1 text-xs text-neutral-500">Ajoutez d'abord une colonne Relation à cette database.</p>;
  return (
    <div className="space-y-2">
      <label className="block">
        <span className="mb-0.5 block text-xs text-neutral-500">Relation</span>
        <select
          aria-label="Relation du rollup"
          className={field}
          value={prop.config.relationPropertyId ?? ""}
          onChange={(e) => onChange({ ...prop.config, relationPropertyId: e.target.value, targetPropertyId: undefined, rollupFunction: undefined })}
        >
          <option value="">Choisir…</option>
          {relations.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      {relation && (
        <label className="block">
          <span className="mb-0.5 block text-xs text-neutral-500">Propriété</span>
          <select
            aria-label="Propriété du rollup"
            className={field}
            value={prop.config.targetPropertyId ?? ""}
            onChange={(e) => onChange({ ...prop.config, targetPropertyId: e.target.value, rollupFunction: prop.config.rollupFunction ?? "show_original" })}
          >
            <option value="">Choisir…</option>
            {targets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {targetProp && (
        <label className="block">
          <span className="mb-0.5 block text-xs text-neutral-500">Calcul</span>
          <select
            aria-label="Calcul du rollup"
            className={field}
            value={prop.config.rollupFunction ?? "show_original"}
            onChange={(e) => onChange({ ...prop.config, rollupFunction: e.target.value })}
          >
            {functions.map((f) => (
              <option key={f} value={f}>
                {f === "show_original" ? "Afficher les valeurs" : CALC_LABELS[f as keyof typeof CALC_LABELS]}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

const FORMATS = [
  { value: "number", label: "Nombre" },
  { value: "currency", label: "Montant (devise)" },
  { value: "percent", label: "Pourcentage" },
] as const;

/** Problem in a formula as typed, checked in the browser before saving. */
function formulaProblem(expression: string, properties: DatabaseProperty[]): string | null {
  if (!expression.trim()) return null;
  try {
    const names = new Set(properties.map((p) => p.name));
    const unknown = formulaReferences(parseFormula(expression)).find((n) => !names.has(n));
    return unknown ? `Colonne inconnue « ${unknown} ».` : null;
  } catch (e) {
    if (e instanceof FormulaError) return e.position !== undefined ? `${e.message} (caractère ${e.position + 1})` : e.message;
    throw e;
  }
}

function FormulaEditor({
  prop,
  properties,
  onChange,
  field,
}: {
  prop: DatabaseProperty;
  properties: DatabaseProperty[];
  onChange: (config: PropertyConfig) => void;
  field: string;
}) {
  const [expression, setExpression] = useState(prop.config.expression ?? "");
  const [help, setHelp] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const problem = useMemo(() => formulaProblem(expression, properties), [expression, properties]);
  const dirty = expression !== (prop.config.expression ?? "");
  const columns = properties.filter((p) => p.id !== prop.id);

  const insert = (text: string) => {
    const el = area.current;
    const start = el?.selectionStart ?? expression.length;
    const end = el?.selectionEnd ?? expression.length;
    setExpression(expression.slice(0, start) + text + expression.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + text.length, start + text.length);
    });
  };

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="mb-0.5 block text-xs text-neutral-500">Formule</span>
        <textarea
          ref={area}
          aria-label="Expression de la formule"
          value={expression}
          onChange={(e) => setExpression(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !problem) onChange({ ...prop.config, expression });
          }}
          rows={3}
          spellCheck={false}
          placeholder={'prop("Montant") * 1.2'}
          className={`${field} font-mono text-xs`}
        />
      </label>
      {problem ? <p className="px-1 text-xs text-red-600 dark:text-red-400">{problem}</p> : null}
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => setHelp(!help)} className="text-xs text-blue-600 hover:underline dark:text-blue-400">
          {help ? "Masquer l'aide" : "Fonctions disponibles"}
        </button>
        <button
          type="button"
          disabled={!dirty || !!problem}
          onClick={() => onChange({ ...prop.config, expression })}
          className="rounded bg-neutral-900 px-3 py-1 text-xs text-white enabled:hover:bg-neutral-700 disabled:opacity-40 dark:bg-white dark:text-neutral-900"
        >
          Enregistrer la formule
        </button>
      </div>
      <div>
        <span className="mb-0.5 block text-xs text-neutral-500">Colonnes (clic pour insérer)</span>
        <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
          {columns.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => insert(`prop("${p.name}")`)}
              className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700"
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>
      {help && (
        <ul className="max-h-48 space-y-1 overflow-y-auto rounded border border-neutral-200 p-2 text-xs dark:border-neutral-700">
          <li className="text-neutral-500">Opérateurs : + - * / % ^, == != &gt; &lt; &gt;= &lt;=, and, or, not, condition ? a : b</li>
          {Object.entries(FUNCTIONS).map(([name, f]) => (
            <li key={name}>
              <button type="button" onClick={() => insert(`${name}(`)} className="text-left font-mono hover:underline">
                {f.help}
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="block">
        <span className="mb-0.5 block text-xs text-neutral-500">Affichage des nombres</span>
        <select
          aria-label="Affichage des nombres"
          className={field}
          value={prop.config.formulaFormat ?? "number"}
          onChange={(e) => {
            const formulaFormat = e.target.value as "number" | "currency" | "percent";
            onChange({ ...prop.config, formulaFormat, ...(formulaFormat === "currency" && !prop.config.currency ? { currency: "EUR", decimals: 2 } : {}) });
          }}
        >
          {FORMATS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
