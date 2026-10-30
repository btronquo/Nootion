import { useMemo, useRef, useState } from "react";
import { EyeOff, Trash2, X } from "lucide-react";
import {
  calcLabel,
  type CalcFunction,
  t,
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
import { colorLabel, CURRENCIES, OPTION_CLASSES, typeLabel } from "./format";
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
        aria-label={t("property.name")}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => e.key === "Enter" && commitName()}
        className={field}
      />
      <label className="block">
        <span className="mb-0.5 block text-xs text-neutral-500">{t("property.type")}</span>
        <select
          aria-label={t("property.type")}
          className={field}
          value={prop.type}
          disabled={prop.type === "title" || STRUCTURAL_TYPES.includes(prop.type)}
          onChange={(e) => {
            const next = e.target.value as PropertyType;
            if (confirm(t("property.confirmType", { name: prop.name, type: typeLabel(next) }))) onChangeType(next);
          }}
        >
          {(prop.type === "title" || STRUCTURAL_TYPES.includes(prop.type) ? [prop.type] : CREATABLE_TYPES.filter((t) => !STRUCTURAL_TYPES.includes(t))).map((t) => (
            <option key={t} value={t}>
              {typeLabel(t)}
            </option>
          ))}
        </select>
      </label>

      {prop.type === "formula" && <FormulaEditor prop={prop} properties={properties} onChange={onChangeConfig} field={field} />}
      {isCurrency && (
        <label className="block">
          <span className="mb-0.5 block text-xs text-neutral-500">{t("property.currency")}</span>
          <select className={field} value={prop.config.currency ?? "EUR"} onChange={(e) => onChangeConfig({ ...prop.config, currency: e.target.value })}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      )}
      {isNumeric && (
        <label className="block">
          <span className="mb-0.5 block text-xs text-neutral-500">{prop.type === "formula" ? t("property.decimalsFormula") : t("property.decimals")}</span>
          <select
            className={field}
            value={prop.config.decimals ?? ""}
            onChange={(e) => onChangeConfig({ ...prop.config, decimals: e.target.value === "" ? undefined : Number(e.target.value) })}
          >
            <option value="">{t("property.decimalsAuto")}</option>
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
          {t("property.includeTime")}
        </label>
      )}
      {(prop.type === "select" || prop.type === "multi_select") && (
        <div>
          <span className="mb-0.5 block text-xs text-neutral-500">{t("property.options")}</span>
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {(prop.config.options ?? []).map((o) => (
              <div key={o.id} className="flex items-center gap-1">
                <select
                  aria-label={t("option.colorOf", { name: o.name })}
                  value={o.color}
                  onChange={(e) =>
                    onChangeConfig({ ...prop.config, options: prop.config.options!.map((x) => (x.id === o.id ? { ...x, color: e.target.value as OptionColor } : x)) })
                  }
                  className={`w-20 shrink-0 rounded px-1 py-0.5 text-xs ${OPTION_CLASSES[o.color]}`}
                >
                  {OPTION_COLORS.map((c) => (
                    <option key={c} value={c}>
                      {colorLabel(c)}
                    </option>
                  ))}
                </select>
                <input
                  defaultValue={o.name}
                  aria-label={t("option.name")}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== o.name) onChangeConfig({ ...prop.config, options: prop.config.options!.map((x) => (x.id === o.id ? { ...x, name: v } : x)) });
                  }}
                  className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-neutral-200 focus:border-neutral-400 dark:hover:border-neutral-700"
                />
                <button
                  title={t("option.delete")}
                  className="text-neutral-400 hover:text-red-600"
                  onClick={() =>
                    confirm(t("option.confirmDelete", { name: o.name })) &&
                    onChangeConfig({ ...prop.config, options: prop.config.options!.filter((x) => x.id !== o.id) })
                  }
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            {!prop.config.options?.length && <p className="px-1 text-xs text-neutral-500">{t("option.help")}</p>}
          </div>
        </div>
      )}

      <div className="border-t border-neutral-200 pt-1 dark:border-neutral-700">
        {onHide && (
          <button onClick={onHide} className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
            <EyeOff size={14} /> {t("property.hideInView")}
          </button>
        )}
        {prop.type !== "title" && (
          <button
            onClick={() => confirm(t("property.confirmDelete", { name: prop.name })) && onDelete()}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
          >
            <Trash2 size={14} /> {t("property.delete")}
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
      {t("relation.linkedTo")}{" "}
      <span className="font-medium text-neutral-700 dark:text-neutral-200">{target.data ? pageTitle(target.data.title) : t("relation.unavailable")}</span>
      {prop.config.twinPropertyId ? t("relation.twoWay") : t("relation.oneWay")}
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
  if (!relations.length) return <p className="px-1 text-xs text-neutral-500">{t("rollup.needsRelation")}</p>;
  return (
    <div className="space-y-2">
      <label className="block">
        <span className="mb-0.5 block text-xs text-neutral-500">{t("type.relation")}</span>
        <select
          aria-label={t("rollup.relationLabel")}
          className={field}
          value={prop.config.relationPropertyId ?? ""}
          onChange={(e) => onChange({ ...prop.config, relationPropertyId: e.target.value, targetPropertyId: undefined, rollupFunction: undefined })}
        >
          <option value="">{t("common.choose")}</option>
          {relations.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      {relation && (
        <label className="block">
          <span className="mb-0.5 block text-xs text-neutral-500">{t("rollup.property")}</span>
          <select
            aria-label={t("rollup.propertyLabel")}
            className={field}
            value={prop.config.targetPropertyId ?? ""}
            onChange={(e) => onChange({ ...prop.config, targetPropertyId: e.target.value, rollupFunction: prop.config.rollupFunction ?? "show_original" })}
          >
            <option value="">{t("common.choose")}</option>
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
          <span className="mb-0.5 block text-xs text-neutral-500">{t("rollup.calc")}</span>
          <select
            aria-label={t("rollup.calcLabel")}
            className={field}
            value={prop.config.rollupFunction ?? "show_original"}
            onChange={(e) => onChange({ ...prop.config, rollupFunction: e.target.value })}
          >
            {functions.map((f) => (
              <option key={f} value={f}>
                {f === "show_original" ? t("rollup.showOriginal") : calcLabel(f as CalcFunction)}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

const FORMATS = ["number", "currency", "percent"] as const;

/** Problem in a formula as typed, checked in the browser before saving. */
function formulaProblem(expression: string, properties: DatabaseProperty[]): string | null {
  if (!expression.trim()) return null;
  try {
    const names = new Set(properties.map((p) => p.name));
    const unknown = formulaReferences(parseFormula(expression)).find((n) => !names.has(n));
    return unknown ? t("formula.error.unknownColumn", { name: unknown }) : null;
  } catch (e) {
    if (e instanceof FormulaError) return e.position !== undefined ? t("formula.error.atChar", { message: e.message, position: e.position + 1 }) : e.message;
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
        <span className="mb-0.5 block text-xs text-neutral-500">{t("type.formula")}</span>
        <textarea
          ref={area}
          aria-label={t("formula.expression")}
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
          {help ? t("formula.hideHelp") : t("formula.showHelp")}
        </button>
        <button
          type="button"
          disabled={!dirty || !!problem}
          onClick={() => onChange({ ...prop.config, expression })}
          className="rounded bg-neutral-900 px-3 py-1 text-xs text-white enabled:hover:bg-neutral-700 disabled:opacity-40 dark:bg-white dark:text-neutral-900"
        >
          {t("formula.save")}
        </button>
      </div>
      <div>
        <span className="mb-0.5 block text-xs text-neutral-500">{t("formula.columns")}</span>
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
          <li className="text-neutral-500">{t("formula.operators")}</li>
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
        <span className="mb-0.5 block text-xs text-neutral-500">{t("formula.numberFormat")}</span>
        <select
          aria-label={t("formula.numberFormat")}
          className={field}
          value={prop.config.formulaFormat ?? "number"}
          onChange={(e) => {
            const formulaFormat = e.target.value as "number" | "currency" | "percent";
            onChange({ ...prop.config, formulaFormat, ...(formulaFormat === "currency" && !prop.config.currency ? { currency: "EUR", decimals: 2 } : {}) });
          }}
        >
          {FORMATS.map((f) => (
            <option key={f} value={f}>
              {typeLabel(f)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
