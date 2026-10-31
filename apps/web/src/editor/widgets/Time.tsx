import { useEffect, useMemo, useRef, useState } from "react";
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
import { Clock3, Gauge, Hourglass, Minus, Pause, Play, Plus, RotateCcw, SkipForward, Timer } from "lucide-react";
import { intlLocale, t } from "@nootion/shared";
import { Widget, empty, isPublic } from "../HomeWidgets";
import { DatabaseFields, Field, field, useNow, useSettings, useViewRows } from "./shared";

const box = "rounded-xl border border-neutral-200 p-4 dark:border-neutral-800";

/* ---------- Progress bar ---------- */

type ProgressMode = "year" | "month" | "week" | "day" | "database" | "manual";

/** Share of the current year, month, week or day that has gone by. */
function timeShare(mode: "year" | "month" | "week" | "day", now: Date) {
  const start = new Date(now);
  const end = new Date(now);
  if (mode === "year") {
    start.setMonth(0, 1);
    end.setFullYear(now.getFullYear() + 1, 0, 1);
  } else if (mode === "month") {
    start.setDate(1);
    end.setMonth(now.getMonth() + 1, 1);
  } else if (mode === "week") {
    start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    end.setTime(start.getTime());
    end.setDate(start.getDate() + 7);
  } else {
    end.setDate(now.getDate() + 1);
  }
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return (now.getTime() - start.getTime()) / (end.getTime() - start.getTime());
}

export function ProgressView({ node, updateAttributes, editor, extension }: NodeViewProps) {
  const a = node.attrs as {
    mode: ProgressMode;
    label: string;
    value: number;
    goal: number;
    databaseId: string | null;
    viewId: string | null;
    checkbox: string | null;
  };
  const editable = editor.isEditable && !isPublic(extension);
  const settings = useSettings();
  const now = useNow(60_000);
  const fromDb = a.mode === "database" && !isPublic(extension);
  const { data, rows } = useViewRows(fromDb ? a.databaseId : null, a.viewId);
  const check = data?.properties.find((p) => p.id === a.checkbox) ?? data?.properties.find((p) => p.type === "checkbox");

  let share = 0;
  let detail = "";
  if (a.mode === "database") {
    const done = check ? rows.filter((r) => r.values[check.id] === true).length : 0;
    share = rows.length ? done / rows.length : 0;
    detail = t("widget.progressDone", { done, total: rows.length });
  } else if (a.mode === "manual") {
    share = a.goal > 0 ? a.value / a.goal : 0;
    detail = `${a.value.toLocaleString(intlLocale())} / ${a.goal.toLocaleString(intlLocale())}`;
  } else {
    share = timeShare(a.mode, new Date(now));
  }
  share = Math.min(Math.max(share, 0), 1);
  const pct = Math.floor(share * 1000) / 10;
  const label = a.label || t(`widget.progress_${a.mode}`);
  if (a.mode === "database" && isPublic(extension)) return <NodeViewWrapper />;

  return (
    <Widget name="progress" icon={<Gauge size={14} />} title={label} tools={editable && settings.button}>
      {a.mode === "database" && !a.databaseId ? (
        <p className={empty}>{t("widget.progressChoose")}</p>
      ) : (
        <div className={box} data-progress={pct}>
          <div className="mb-2 flex items-baseline justify-between gap-2 text-sm">
            <span className="text-2xl font-semibold tabular-nums">{pct.toLocaleString(intlLocale())} %</span>
            <span className="flex items-center gap-1 text-xs text-neutral-500">
              {detail}
              {a.mode === "manual" && editable && (
                <>
                  <button
                    className="rounded p-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    aria-label={t("widget.progressLess")}
                    onClick={() => updateAttributes({ value: Math.max(0, a.value - 1) })}
                  >
                    <Minus size={13} />
                  </button>
                  <button
                    className="rounded p-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    aria-label={t("widget.progressMore")}
                    onClick={() => updateAttributes({ value: a.value + 1 })}
                  >
                    <Plus size={13} />
                  </button>
                </>
              )}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
            <div className="h-full rounded-full bg-[#2383e2] transition-[width] duration-700 ease-out" style={{ width: `${share * 100}%` }} />
          </div>
        </div>
      )}
      {settings.panel(
        <>
          <Field label={t("widget.progressMode")}>
            <select className={field} value={a.mode} onChange={(e) => updateAttributes({ mode: e.target.value })}>
              {(["year", "month", "week", "day", "database", "manual"] as ProgressMode[]).map((m) => (
                <option key={m} value={m}>
                  {t(`widget.progress_${m}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("widget.label")}>
            <input
              className={field}
              value={a.label}
              placeholder={t(`widget.progress_${a.mode}`)}
              onChange={(e) => updateAttributes({ label: e.target.value })}
            />
          </Field>
          {a.mode === "database" && (
            <>
              <DatabaseFields databaseId={a.databaseId} viewId={a.viewId} onChange={(x) => updateAttributes(x.databaseId ? { ...x, checkbox: null } : x)} />
              {data && (
                <Field label={t("widget.progressCheckbox")}>
                  <select className={field} value={check?.id ?? ""} onChange={(e) => updateAttributes({ checkbox: e.target.value })}>
                    {!check && <option value="">{t("widget.progressNoCheckbox")}</option>}
                    {data.properties
                      .filter((p) => p.type === "checkbox")
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </Field>
              )}
            </>
          )}
          {a.mode === "manual" && (
            <div className="flex gap-2">
              <Field label={t("widget.progressValue")}>
                <input
                  type="number"
                  min={0}
                  className={field}
                  value={a.value}
                  onChange={(e) => updateAttributes({ value: Math.max(0, Number(e.target.value) || 0) })}
                />
              </Field>
              <Field label={t("widget.progressGoal")}>
                <input
                  type="number"
                  min={1}
                  className={field}
                  value={a.goal}
                  onChange={(e) => updateAttributes({ goal: Math.max(1, Number(e.target.value) || 1) })}
                />
              </Field>
            </div>
          )}
        </>,
      )}
    </Widget>
  );
}

/* ---------- Countdown ---------- */

export function CountdownView({ node, updateAttributes, editor, extension }: NodeViewProps) {
  const a = node.attrs as { target: string; label: string };
  const editable = editor.isEditable && !isPublic(extension);
  const settings = useSettings();
  const now = useNow(1000);
  const target = a.target ? new Date(a.target.length > 10 ? a.target : `${a.target}T00:00:00`).getTime() : NaN;
  const diff = target - now;
  const past = diff < 0;
  const abs = Math.abs(diff);
  const units = [
    [Math.floor(abs / 86_400_000), t("widget.days")],
    [Math.floor(abs / 3_600_000) % 24, t("widget.hours")],
    [Math.floor(abs / 60_000) % 60, t("widget.minutes")],
    [Math.floor(abs / 1000) % 60, t("widget.seconds")],
  ] as const;
  const when = Number.isNaN(target)
    ? ""
    : new Date(target).toLocaleString(intlLocale(), { dateStyle: "full", ...(a.target.length > 10 ? { timeStyle: "short" } : {}) });

  return (
    <Widget name="countdown" icon={<Hourglass size={14} />} title={a.label || t("widget.countdown")} tools={editable && settings.button}>
      {Number.isNaN(target) ? (
        <div className={`${empty} flex flex-col items-start gap-2`}>
          <span>{editable ? t("widget.countdownChoose") : t("calendarBlock.emptyReadOnly")}</span>
          {editable && (
            <button className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700" onClick={(e) => settings.open(e.currentTarget)}>
              {t("widget.countdownSet")}
            </button>
          )}
        </div>
      ) : (
        <div className={`${box} text-center`} data-countdown>
          {past && <p className="mb-2 text-xs text-neutral-500">{abs < 86_400_000 ? `🎉 ${t("widget.countdownToday")}` : t("widget.countdownSince")}</p>}
          <div className="flex justify-center gap-2 sm:gap-4">
            {units.map(([n, unit]) => (
              <div key={unit} className="min-w-14 rounded-lg bg-neutral-50 px-2 py-2 dark:bg-neutral-800/60 sm:min-w-18">
                <div className="text-2xl font-semibold tabular-nums sm:text-3xl">{String(n).padStart(2, "0")}</div>
                <div className="text-[11px] text-neutral-500">{unit}</div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-neutral-400 first-letter:uppercase">{when}</p>
        </div>
      )}
      {settings.panel(
        <>
          <Field label={t("widget.label")}>
            <input className={field} value={a.label} placeholder={t("widget.countdown")} onChange={(e) => updateAttributes({ label: e.target.value })} />
          </Field>
          <div className="flex gap-2">
            <Field label={t("cell.date")}>
              <input
                type="date"
                className={field}
                value={a.target.slice(0, 10)}
                onChange={(e) => updateAttributes({ target: e.target.value ? e.target.value + a.target.slice(10) : "" })}
              />
            </Field>
            <Field label={t("widget.time")}>
              <input
                type="time"
                className={field}
                value={a.target.slice(11, 16)}
                disabled={!a.target}
                onChange={(e) => updateAttributes({ target: a.target.slice(0, 10) + (e.target.value ? `T${e.target.value}` : "") })}
              />
            </Field>
          </div>
        </>,
      )}
    </Widget>
  );
}

/* ---------- Clock ---------- */

export function ClockView({ node, updateAttributes, editor, extension }: NodeViewProps) {
  const a = node.attrs as { timeZone: string; label: string; seconds: boolean };
  const editable = editor.isEditable && !isPublic(extension);
  const settings = useSettings();
  const now = useNow(a.seconds ? 1000 : 5000);
  const zone = a.timeZone || undefined;
  const opts = { timeZone: zone };
  let time: string;
  let date: string;
  try {
    time = new Date(now).toLocaleTimeString(intlLocale(), { ...opts, hour: "2-digit", minute: "2-digit", ...(a.seconds ? { second: "2-digit" } : {}) });
    date = new Date(now).toLocaleDateString(intlLocale(), { ...opts, weekday: "long", day: "numeric", month: "long" });
  } catch {
    time = "--:--";
    date = a.timeZone;
  }
  const zones = useMemo(() => (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [], []);
  const city = a.label || (a.timeZone ? a.timeZone.split("/").pop()!.replace(/_/g, " ") : "");

  return (
    <Widget name="clock" icon={<Clock3 size={14} />} title={city || t("widget.clock")} tools={editable && settings.button}>
      <div className={`${box} text-center`} data-clock>
        <div className="text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">{time}</div>
        <div className="mt-1 text-sm text-neutral-500 first-letter:uppercase">{date}</div>
      </div>
      {settings.panel(
        <>
          <Field label={t("widget.timeZone")}>
            <select className={field} value={a.timeZone} onChange={(e) => updateAttributes({ timeZone: e.target.value })}>
              <option value="">{t("widget.timeZoneLocal")}</option>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("widget.label")}>
            <input className={field} value={a.label} placeholder={city || t("widget.clock")} onChange={(e) => updateAttributes({ label: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={a.seconds} onChange={(e) => updateAttributes({ seconds: e.target.checked })} /> {t("widget.clockSeconds")}
          </label>
        </>,
      )}
    </Widget>
  );
}

/* ---------- Pomodoro ---------- */

type Phase = "work" | "rest" | "longRest";

/** A soft two-note chime when a phase ends. */
function chime() {
  try {
    const ctx = new AudioContext();
    [660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      const at = ctx.currentTime + i * 0.25;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.2, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.6);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.65);
    });
    window.setTimeout(() => void ctx.close(), 1500);
  } catch {
    // No sound available.
  }
}

export function PomodoroView({ node, updateAttributes, editor, extension }: NodeViewProps) {
  const a = node.attrs as { work: number; rest: number; longRest: number; rounds: number };
  const editable = editor.isEditable && !isPublic(extension);
  const settings = useSettings();
  const minutes = (p: Phase) => (p === "work" ? a.work : p === "rest" ? a.rest : a.longRest);
  const [phase, setPhase] = useState<Phase>("work");
  const [round, setRound] = useState(1);
  // Running: when the phase ends. Paused: what is left.
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [left, setLeft] = useState(minutes("work") * 60_000);
  const now = useNow(endsAt ? 250 : 60_000);
  const remaining = endsAt ? Math.max(0, endsAt - now) : left;
  const total = minutes(phase) * 60_000;

  const next = (sound: boolean) => {
    if (sound) {
      chime();
      if (document.hidden && "Notification" in window && Notification.permission === "granted")
        new Notification(phase === "work" ? t("widget.pomodoroBreakTime") : t("widget.pomodoroWorkTime"));
    }
    const p: Phase = phase === "work" ? (round % a.rounds === 0 ? "longRest" : "rest") : "work";
    if (phase !== "work") setRound((r) => r + 1);
    setPhase(p);
    setEndsAt(sound ? Date.now() + minutes(p) * 60_000 : null);
    setLeft(minutes(p) * 60_000);
  };
  const nextRef = useRef(next);
  nextRef.current = next;
  useEffect(() => {
    if (endsAt && remaining <= 0) nextRef.current(true);
  }, [endsAt, remaining]);
  // Settings changed while idle: the timer follows.
  useEffect(() => {
    if (!endsAt) setLeft(minutes(phase) * 60_000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.work, a.rest, a.longRest]);
  // The tab's title shows the time left while running.
  const mmss = `${String(Math.floor(remaining / 60_000)).padStart(2, "0")}:${String(Math.floor(remaining / 1000) % 60).padStart(2, "0")}`;
  useEffect(() => {
    if (!endsAt) return;
    const before = document.title;
    document.title = `${mmss} · ${phase === "work" ? "🍅" : "☕"}`;
    return () => {
      document.title = before;
    };
  }, [endsAt, mmss, phase]);

  const start = () => {
    if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
    setEndsAt(Date.now() + left);
  };
  const pause = () => {
    setLeft(remaining);
    setEndsAt(null);
  };
  const reset = () => {
    setEndsAt(null);
    setPhase("work");
    setRound(1);
    setLeft(minutes("work") * 60_000);
  };
  const R = 52;
  const C = 2 * Math.PI * R;
  const share = total ? 1 - remaining / total : 0;
  const color = phase === "work" ? "#e03e3e" : "#4d9f6f";
  const btn = "flex h-9 w-9 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800";

  return (
    <Widget name="pomodoro" icon={<Timer size={14} />} title={t("widget.pomodoro")} tools={editable && settings.button}>
      <div className={`${box} flex flex-col items-center gap-3 sm:flex-row sm:justify-center sm:gap-8`} data-pomodoro={phase}>
        <div className="relative h-32 w-32">
          <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
            <circle cx={60} cy={60} r={R} fill="none" strokeWidth={6} className="stroke-neutral-100 dark:stroke-neutral-800" />
            <circle
              cx={60}
              cy={60}
              r={R}
              fill="none"
              stroke={color}
              strokeWidth={6}
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - share)}
              className="transition-[stroke-dashoffset] duration-300 ease-linear"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-semibold tabular-nums">{mmss}</span>
            <span className="text-[11px] text-neutral-500">{t(`widget.pomodoro_${phase}`)}</span>
          </div>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-1">
            <button className={btn} onClick={reset} aria-label={t("widget.pomodoroReset")} title={t("widget.pomodoroReset")}>
              <RotateCcw size={16} />
            </button>
            <button
              className="flex h-11 w-11 items-center justify-center rounded-full text-white shadow-sm transition-transform active:scale-95"
              style={{ background: color }}
              onClick={endsAt ? pause : start}
              aria-label={endsAt ? t("widget.pomodoroPause") : t("widget.pomodoroStart")}
            >
              {endsAt ? <Pause size={18} /> : <Play size={18} className="translate-x-px" />}
            </button>
            <button className={btn} onClick={() => next(false)} aria-label={t("widget.pomodoroSkip")} title={t("widget.pomodoroSkip")}>
              <SkipForward size={16} />
            </button>
          </div>
          <div className="flex gap-1" aria-label={t("widget.pomodoroRound", { round: ((round - 1) % a.rounds) + 1, rounds: a.rounds })}>
            {Array.from({ length: a.rounds }, (_, i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-full ${i < ((round - 1) % a.rounds) + (phase === "work" ? 0 : 1) ? "bg-[#e03e3e]" : "bg-neutral-200 dark:bg-neutral-700"}`}
              />
            ))}
          </div>
        </div>
      </div>
      {settings.panel(
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["work", "widget.pomodoroWorkMin", 1, 120],
              ["rest", "widget.pomodoroRestMin", 1, 60],
              ["longRest", "widget.pomodoroLongRestMin", 1, 60],
              ["rounds", "widget.pomodoroRounds", 1, 12],
            ] as const
          ).map(([key, label, min, max]) => (
            <Field key={key} label={t(label)}>
              <input
                type="number"
                min={min}
                max={max}
                className={field}
                value={a[key]}
                onChange={(e) => updateAttributes({ [key]: Math.min(max, Math.max(min, Number(e.target.value) || min)) })}
              />
            </Field>
          ))}
        </div>,
      )}
    </Widget>
  );
}
