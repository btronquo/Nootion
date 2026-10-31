import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
import { BarChart3 } from "lucide-react";
import { intlLocale, t, type DatabaseProperty, type DatabaseRow, type DateValue } from "@nootion/shared";
import { useUserDirectory } from "../../lib/queries";
import { pageTitle } from "../../lib/tree";
import { pageIcon } from "../../lib/icons";
import { formatNumber, formatValue } from "../../database/format";
import { Widget, empty, isPublic } from "../HomeWidgets";
import { DatabaseFields, Field, OPTION_HEX, PALETTE, field, useSettings, useViewRows } from "./shared";

type Kind = "bar" | "column" | "line" | "donut";
interface Group {
  key: string;
  label: string;
  value: number;
  color: string;
}

const GROUPABLE = ["select", "multi_select", "checkbox", "person", "created_by", "date", "created_time", "last_edited_time", "text", "url", "email", "number"];
const MAX_GROUPS = 12;

const monthLabel = (key: string) => new Date(`${key}-01T00:00:00`).toLocaleDateString(intlLocale(), { month: "short", year: "numeric" });

/** Keys (with labels and colors) a row falls under, for a grouping column. */
function keysOf(
  row: DatabaseRow,
  prop: DatabaseProperty | undefined,
  people: Record<string, string>,
): { key: string; label: string; color?: string; order?: number }[] {
  if (!prop) return [{ key: "all", label: t("widget.chartAll") }];
  const v = prop.type === "title" ? row.title : row.values[prop.id];
  const none = { key: "", label: t("widget.chartNone"), order: 1e9 };
  if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length))
    return prop.type === "checkbox" ? [{ key: "no", label: t("common.no"), order: 1 }] : [none];
  switch (prop.type) {
    case "select":
    case "multi_select": {
      const ids = Array.isArray(v) ? (v as string[]) : [v as string];
      return ids.map((id) => {
        const i = prop.config.options?.findIndex((o) => o.id === id) ?? -1;
        const o = prop.config.options?.[i];
        return o ? { key: id, label: o.name, color: OPTION_HEX[o.color], order: i } : none;
      });
    }
    case "checkbox":
      return v ? [{ key: "yes", label: t("common.yes"), order: 0 }] : [{ key: "no", label: t("common.no"), order: 1 }];
    case "person":
    case "created_by":
      return (v as string[]).map((id) => ({ key: id, label: people[id] ?? "?" }));
    case "date":
    case "created_time":
    case "last_edited_time": {
      const iso = typeof v === "string" ? v : (v as DateValue).start;
      const key = iso.slice(0, 7);
      return [{ key, label: monthLabel(key), order: Number(key.replace("-", "")) }];
    }
    default: {
      const text = formatValue(prop, v, people);
      return [{ key: text, label: text }];
    }
  }
}

function groups(rows: DatabaseRow[], props: DatabaseProperty[], groupBy: string | null, measure: string, people: Record<string, string>): Group[] {
  const prop = props.find((p) => p.id === groupBy);
  const num = props.find((p) => p.id === measure);
  const map = new Map<string, { label: string; value: number; color?: string; order?: number }>();
  for (const row of rows) {
    const n = num ? Number(row.values[num.id]) : 1;
    if (num && !Number.isFinite(n)) continue;
    for (const k of keysOf(row, prop, people)) {
      const g = map.get(k.key) ?? { label: k.label, value: 0, color: k.color, order: k.order };
      g.value += n;
      map.set(k.key, g);
    }
  }
  let list = [...map].map(([key, g]) => ({ key, ...g }));
  // Options and dates keep their order; anything else goes from the biggest.
  const ordered = list.some((g) => g.order !== undefined && g.order < 1e9);
  list.sort((a, b) => (ordered ? (a.order ?? 1e8) - (b.order ?? 1e8) : b.value - a.value));
  if (list.length > MAX_GROUPS) {
    const rest = list.slice(MAX_GROUPS - 1);
    list = [
      ...list.slice(0, MAX_GROUPS - 1),
      { key: "_other", label: t("widget.chartOther"), value: rest.reduce((s, g) => s + g.value, 0), color: undefined, order: undefined },
    ];
  }
  return list.map((g, i) => ({ key: g.key, label: g.label, value: g.value, color: g.color ?? PALETTE[i % PALETTE.length]! }));
}

export function ChartView({ node, updateAttributes, editor, extension }: NodeViewProps) {
  const attrs = node.attrs as { databaseId: string | null; viewId: string | null; kind: Kind; groupBy: string | null; measure: string };
  const editable = editor.isEditable && !isPublic(extension);
  const settings = useSettings();
  const { db, data, view, rows } = useViewRows(isPublic(extension) ? null : attrs.databaseId, attrs.viewId);
  const directory = useUserDirectory();
  const people = useMemo(() => Object.fromEntries((directory.data ?? []).map((u) => [u.id, u.name])), [directory.data]);
  const props = data?.properties ?? [];
  const groupProp = props.find((p) => p.id === attrs.groupBy) ?? props.find((p) => p.type === "select") ?? props.find((p) => GROUPABLE.includes(p.type));
  const numberProp = props.find((p) => p.id === attrs.measure);
  const list = useMemo(
    () => (data ? groups(rows, props, groupProp?.id ?? null, attrs.measure, people) : []),
    [data, rows, props, groupProp?.id, attrs.measure, people],
  );
  const fmt = (n: number) => (numberProp ? formatNumber(n, numberProp) : n.toLocaleString(intlLocale()));
  if (isPublic(extension)) return <NodeViewWrapper />;

  const title = data ? (
    <Link to={`/page/${attrs.databaseId}`} className="hover:underline">
      {pageIcon(data.icon) ?? "🗃"} {pageTitle(data.title)}
      {groupProp && <span className="font-normal text-neutral-400"> · {numberProp ? `${numberProp.name} / ${groupProp.name}` : groupProp.name}</span>}
    </Link>
  ) : (
    t("widget.chart")
  );

  return (
    <Widget name="chart" icon={<BarChart3 size={14} />} title={title} tools={editable && settings.button}>
      {!attrs.databaseId ? (
        <div className={`${empty} flex flex-col items-start gap-2`}>
          <span>{editable ? t("widget.chartChoose") : t("calendarBlock.emptyReadOnly")}</span>
          {editable && (
            <button className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700" onClick={(e) => settings.open(e.currentTarget)}>
              {t("widget.chooseDatabase")}
            </button>
          )}
        </div>
      ) : db.isError ? (
        <p className={empty}>🔒 {t("database.private")}</p>
      ) : data && !list.length ? (
        <p className={empty}>{t("widget.rowsEmpty")}</p>
      ) : (
        data && <ChartBody kind={attrs.kind} list={list} fmt={fmt} />
      )}
      {settings.panel(
        <>
          <DatabaseFields
            databaseId={attrs.databaseId}
            viewId={attrs.viewId}
            onChange={(a) => updateAttributes(a.databaseId ? { ...a, groupBy: null, measure: "count" } : a)}
          />
          {data && (
            <>
              <Field label={t("widget.chartKind")}>
                <div className="grid grid-cols-4 gap-1">
                  {(["bar", "column", "line", "donut"] as Kind[]).map((k) => (
                    <button
                      key={k}
                      onClick={() => updateAttributes({ kind: k })}
                      className={`rounded border px-1 py-1 text-xs ${attrs.kind === k ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" : "border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"}`}
                    >
                      {t(`widget.chart_${k}`)}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label={t("widget.chartGroupBy")}>
                <select className={field} value={groupProp?.id ?? ""} onChange={(e) => updateAttributes({ groupBy: e.target.value })}>
                  {props
                    .filter((p) => GROUPABLE.includes(p.type) || p.type === "title")
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label={t("widget.chartMeasure")}>
                <select className={field} value={numberProp?.id ?? "count"} onChange={(e) => updateAttributes({ measure: e.target.value })}>
                  <option value="count">{t("widget.chartCount")}</option>
                  {props
                    .filter((p) => p.type === "number" || p.type === "currency" || p.type === "percent")
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {t("widget.chartSum", { name: p.name })}
                      </option>
                    ))}
                </select>
              </Field>
              <p className="text-xs text-neutral-400">{t("widget.viewHelp")}</p>
            </>
          )}
        </>,
      )}
    </Widget>
  );
}

function ChartBody({ kind, list, fmt }: { kind: Kind; list: Group[]; fmt: (n: number) => string }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(...list.map((g) => g.value), 0) || 1;
  const box = "rounded-xl border border-neutral-200 p-3 dark:border-neutral-800";
  const dim = (g: Group) => (hover && hover !== g.key ? 0.35 : 1);

  if (kind === "bar")
    return (
      <div className={`${box} space-y-1.5`} data-chart="bar">
        {list.map((g) => (
          <div key={g.key} className="flex items-center gap-2 text-xs" onMouseEnter={() => setHover(g.key)} onMouseLeave={() => setHover(null)}>
            <span className="w-28 shrink-0 truncate text-right text-neutral-500" title={g.label}>
              {g.label}
            </span>
            <span className="h-5 min-w-0 flex-1">
              <span
                className="block h-full rounded-sm transition-[width,opacity] duration-500 ease-out"
                style={{ width: `${Math.max((g.value / max) * 100, 0.5)}%`, background: g.color, opacity: dim(g) }}
              />
            </span>
            <span className="w-16 shrink-0 tabular-nums text-neutral-600 dark:text-neutral-300">{fmt(g.value)}</span>
          </div>
        ))}
      </div>
    );

  if (kind === "donut") {
    const total = list.reduce((s, g) => s + Math.max(g.value, 0), 0) || 1;
    let angle = -Math.PI / 2;
    const R = 60;
    const r = 38;
    const shown = list.find((g) => g.key === hover);
    return (
      <div className={`${box} flex flex-wrap items-center gap-6`} data-chart="donut">
        <svg viewBox="-70 -70 140 140" className="h-40 w-40 shrink-0">
          {list.map((g) => {
            const share = Math.max(g.value, 0) / total;
            const a0 = angle;
            const a1 = (angle += share * Math.PI * 2);
            if (share >= 0.9999) return <circle key={g.key} r={(R + r) / 2} fill="none" stroke={g.color} strokeWidth={R - r} />;
            const large = a1 - a0 > Math.PI ? 1 : 0;
            const p = (rad: number, a: number) => `${rad * Math.cos(a)} ${rad * Math.sin(a)}`;
            return (
              <path
                key={g.key}
                d={`M ${p(R, a0)} A ${R} ${R} 0 ${large} 1 ${p(R, a1)} L ${p(r, a1)} A ${r} ${r} 0 ${large} 0 ${p(r, a0)} Z`}
                fill={g.color}
                opacity={dim(g)}
                className="transition-opacity duration-200"
                onMouseEnter={() => setHover(g.key)}
                onMouseLeave={() => setHover(null)}
              />
            );
          })}
          <text textAnchor="middle" dominantBaseline="middle" className="fill-neutral-700 text-[13px] font-semibold dark:fill-neutral-200">
            {fmt(shown ? shown.value : total)}
          </text>
        </svg>
        <ul className="min-w-0 flex-1 space-y-1 text-xs">
          {list.map((g) => (
            <li
              key={g.key}
              className="flex items-center gap-2"
              style={{ opacity: dim(g) }}
              onMouseEnter={() => setHover(g.key)}
              onMouseLeave={() => setHover(null)}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: g.color }} />
              <span className="min-w-0 truncate">{g.label}</span>
              <span className="ml-auto tabular-nums text-neutral-500">
                {fmt(g.value)} · {Math.round((Math.max(g.value, 0) / total) * 100)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // Columns and line share a plot: values up, groups along.
  const W = 600;
  const H = 200;
  const pad = { l: 8, r: 8, t: 14, b: 34 };
  const step = (W - pad.l - pad.r) / list.length;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - Math.max(v, 0) / max);
  const x = (i: number) => pad.l + step * (i + 0.5);
  const label = (s: string) => (s.length > 12 ? `${s.slice(0, 11)}…` : s);
  return (
    <div className={box} data-chart={kind}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full overflow-visible">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={pad.l}
            x2={W - pad.r}
            y1={y(max * f)}
            y2={y(max * f)}
            className="stroke-neutral-200 dark:stroke-neutral-800"
            strokeDasharray="2 3"
          />
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} className="stroke-neutral-300 dark:stroke-neutral-700" />
        {kind === "line" && (
          <>
            <path
              d={`M ${list.map((g, i) => `${x(i)} ${y(g.value)}`).join(" L ")} L ${x(list.length - 1)} ${y(0)} L ${x(0)} ${y(0)} Z`}
              fill="#2383e2"
              opacity={0.08}
            />
            <polyline points={list.map((g, i) => `${x(i)},${y(g.value)}`).join(" ")} fill="none" stroke="#2383e2" strokeWidth={2} strokeLinejoin="round" />
          </>
        )}
        {list.map((g, i) => (
          <g key={g.key} onMouseEnter={() => setHover(g.key)} onMouseLeave={() => setHover(null)}>
            <rect x={x(i) - step / 2} y={pad.t} width={step} height={H - pad.t - pad.b} fill="transparent" />
            {kind === "column" ? (
              <rect
                x={x(i) - Math.min(step * 0.35, 28)}
                y={y(g.value)}
                width={Math.min(step * 0.7, 56)}
                height={Math.max(y(0) - y(g.value), 1)}
                rx={3}
                fill={g.color}
                opacity={dim(g)}
                className="transition-opacity duration-200"
              />
            ) : (
              <circle
                cx={x(i)}
                cy={y(g.value)}
                r={hover === g.key ? 5 : 3.5}
                fill="#fff"
                stroke="#2383e2"
                strokeWidth={2}
                className="transition-all duration-150"
              />
            )}
            {(hover === g.key || list.length <= 8) && (
              <text x={x(i)} y={y(g.value) - 6} textAnchor="middle" className="fill-neutral-600 text-[11px] tabular-nums dark:fill-neutral-300">
                {fmt(g.value)}
              </text>
            )}
            <text x={x(i)} y={H - pad.b + 16} textAnchor="middle" className="fill-neutral-500 text-[11px]">
              {label(g.label)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
