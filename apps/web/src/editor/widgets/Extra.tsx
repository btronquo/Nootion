import { useEffect, useMemo, useRef, useState } from "react";
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, CloudSun, Flame, Grid3x3, ImagePlus, Images, MessageSquareQuote, Shuffle, Trash2, Upload } from "lucide-react";
import { currentLocale, intlLocale, localDay, t } from "@nootion/shared";
import { pageTitle } from "../../lib/tree";
import { pickFiles, uploadFile } from "../upload";
import { Widget, empty, isPublic } from "../HomeWidgets";
import { DatabaseFields, Field, OPTION_HEX, field, useNow, useSettings, useViewRows } from "./shared";

const box = "rounded-xl border border-neutral-200 p-4 dark:border-neutral-800";

/* ---------- Habit tracker ---------- */

/** As many weeks as fit the width, between 8 and 53. */
function useWeeks() {
  const ref = useRef<HTMLDivElement>(null);
  const [weeks, setWeeks] = useState(26);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWeeks(Math.min(53, Math.max(8, Math.floor((el.clientWidth + 3) / 16)))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, weeks] as const;
}

export function HabitView({ node, updateAttributes, editor, extension }: NodeViewProps) {
  const a = node.attrs as { name: string; days: string[]; color: string };
  const editable = editor.isEditable && !isPublic(extension);
  const settings = useSettings();
  useNow(60_000);
  const [gridRef, WEEKS] = useWeeks();
  const done = useMemo(() => new Set(a.days), [a.days]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = localDay(today);
  // Columns are weeks (Monday first), the last one is this week.
  const first = new Date(today);
  first.setDate(today.getDate() - ((today.getDay() + 6) % 7) - (WEEKS - 1) * 7);
  const weeks = Array.from({ length: WEEKS }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const day = new Date(first);
      day.setDate(first.getDate() + w * 7 + d);
      return day;
    }),
  );
  const toggle = (key: string) => updateAttributes({ days: done.has(key) ? a.days.filter((d) => d !== key) : [...a.days, key].sort() });
  // Streak: days in a row up to today (or yesterday, while today is not done yet).
  let streak = 0;
  const cursor = new Date(today);
  if (!done.has(todayKey)) cursor.setDate(cursor.getDate() - 1);
  while (done.has(localDay(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  const month = new Date(today);
  month.setDate(today.getDate() - 29);
  const last30 = a.days.filter((d) => d >= localDay(month) && d <= todayKey).length;
  const color = OPTION_HEX[a.color] ?? OPTION_HEX.green!;
  const fmt = (d: Date) => d.toLocaleDateString(intlLocale(), { weekday: "short", day: "numeric", month: "short" });

  return (
    <Widget name="habit" icon={<Grid3x3 size={14} />} title={a.name || t("widget.habit")} tools={editable && settings.button}>
      <div className={box} data-habit>
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="flex items-center gap-1 font-medium">
            <Flame size={15} className={streak ? "text-orange-500" : "text-neutral-300"} /> {t("widget.habitStreak", { count: streak })}
          </span>
          <span className="text-xs text-neutral-500">{t("widget.habitLast30", { count: last30 })}</span>
          {editable && (
            <button
              onClick={() => toggle(todayKey)}
              className={`ml-auto rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${done.has(todayKey) ? "text-white" : "border border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"}`}
              style={done.has(todayKey) ? { background: color } : undefined}
              aria-pressed={done.has(todayKey)}
            >
              {done.has(todayKey) ? `✓ ${t("widget.habitDone")}` : t("widget.habitMark")}
            </button>
          )}
        </div>
        <div ref={gridRef} className="flex gap-[3px] pb-1">
          {weeks.map((week, w) => (
            <div key={w} className="flex flex-col gap-[3px]">
              {week.map((day) => {
                const key = localDay(day);
                const future = day > today;
                const on = done.has(key);
                return (
                  <button
                    key={key}
                    disabled={!editable || future}
                    onClick={() => toggle(key)}
                    title={`${fmt(day)}${on ? " ✓" : ""}`}
                    aria-label={`${fmt(day)}${on ? ` ✓` : ""}`}
                    aria-pressed={on}
                    className={`h-[13px] w-[13px] rounded-[3px] transition-colors duration-200 ${future ? "opacity-0" : on ? "" : "bg-neutral-100 dark:bg-neutral-800"} ${key === todayKey ? "ring-1 ring-neutral-400 ring-offset-1 dark:ring-offset-neutral-900" : ""} ${editable && !future ? "hover:opacity-80" : ""}`}
                    style={on ? { background: color } : undefined}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {settings.panel(
        <>
          <Field label={t("widget.habitName")}>
            <input className={field} value={a.name} placeholder={t("widget.habitPlaceholder")} onChange={(e) => updateAttributes({ name: e.target.value })} />
          </Field>
          <Field label={t("widget.color")}>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(OPTION_HEX).map(([name, hex]) => (
                <button
                  key={name}
                  onClick={() => updateAttributes({ color: name })}
                  aria-label={t(`color.${name}` as "color.gray")}
                  className={`h-6 w-6 rounded-full ${a.color === name ? "ring-2 ring-offset-2 dark:ring-offset-neutral-900" : ""}`}
                  style={{ background: hex, ["--tw-ring-color" as string]: hex }}
                />
              ))}
            </div>
          </Field>
        </>,
      )}
    </Widget>
  );
}

/* ---------- Weather ---------- */

interface Place {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
}
interface Forecast {
  current: { temperature_2m: number; weather_code: number; wind_speed_10m: number; apparent_temperature: number };
  daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[] };
}

/** Emoji and label of a WMO weather code (as Open-Meteo gives them). */
function weather(code: number): [string, string] {
  if (code === 0) return ["☀️", t("weather.clear")];
  if (code <= 2) return ["🌤️", t("weather.partly")];
  if (code === 3) return ["☁️", t("weather.cloudy")];
  if (code <= 48) return ["🌫️", t("weather.fog")];
  if (code <= 57) return ["🌦️", t("weather.drizzle")];
  if (code <= 67) return ["🌧️", t("weather.rain")];
  if (code <= 77) return ["🌨️", t("weather.snow")];
  if (code <= 82) return ["🌦️", t("weather.showers")];
  if (code <= 86) return ["🌨️", t("weather.snow")];
  return ["⛈️", t("weather.storm")];
}

export function WeatherView({ node, updateAttributes, editor, extension }: NodeViewProps) {
  const a = node.attrs as { city: string; latitude: number | null; longitude: number | null };
  const editable = editor.isEditable && !isPublic(extension);
  const settings = useSettings();
  const [query, setQuery] = useState("");
  const has = a.latitude !== null && a.longitude !== null;
  const forecast = useQuery({
    queryKey: ["weather", a.latitude, a.longitude],
    enabled: has,
    staleTime: 15 * 60_000,
    refetchInterval: 30 * 60_000,
    queryFn: async () => {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${a.latitude}&longitude=${a.longitude}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=5`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as Forecast;
    },
  });
  const search = useQuery({
    queryKey: ["geocode", query.trim()],
    enabled: query.trim().length >= 2,
    staleTime: Infinity,
    queryFn: async () => {
      const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query.trim())}&count=6&language=${currentLocale()}`);
      return ((await res.json()) as { results?: Place[] }).results ?? [];
    },
  });
  const f = forecast.data;
  const round = (n: number) => `${Math.round(n)}°`;

  return (
    <Widget name="weather" icon={<CloudSun size={14} />} title={a.city || t("widget.weather")} tools={editable && settings.button}>
      {!has ? (
        <div className={`${empty} flex flex-col items-start gap-2`}>
          <span>{editable ? t("widget.weatherChoose") : t("calendarBlock.emptyReadOnly")}</span>
          {editable && (
            <button className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700" onClick={(e) => settings.open(e.currentTarget)}>
              {t("widget.weatherCity")}
            </button>
          )}
        </div>
      ) : forecast.isError ? (
        <p className={empty}>{t("widget.weatherError")}</p>
      ) : !f ? (
        <div className={`${box} h-[132px] animate-pulse bg-neutral-50 dark:bg-neutral-800/40`} />
      ) : (
        <div className={`${box} flex flex-wrap items-center gap-x-8 gap-y-4`} data-weather>
          <div className="flex items-center gap-3">
            <span className="text-5xl leading-none">{weather(f.current.weather_code)[0]}</span>
            <div>
              <div className="text-3xl font-semibold tabular-nums">{round(f.current.temperature_2m)}</div>
              <div className="text-xs text-neutral-500">
                {weather(f.current.weather_code)[1]} · {t("weather.feels", { temp: round(f.current.apparent_temperature) })} ·{" "}
                {Math.round(f.current.wind_speed_10m)} km/h
              </div>
            </div>
          </div>
          <div className="flex flex-1 justify-between gap-2">
            {f.daily.time.map((day, i) => (
              <div key={day} className="flex min-w-10 flex-col items-center gap-0.5 text-xs">
                <span className="text-neutral-500 first-letter:uppercase">
                  {i === 0 ? t("widget.today") : new Date(`${day}T12:00:00`).toLocaleDateString(intlLocale(), { weekday: "short" })}
                </span>
                <span className="text-lg" title={weather(f.daily.weather_code[i]!)[1]}>
                  {weather(f.daily.weather_code[i]!)[0]}
                </span>
                <span className="tabular-nums">
                  {round(f.daily.temperature_2m_max[i]!)} <span className="text-neutral-400">{round(f.daily.temperature_2m_min[i]!)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {settings.panel(
        <>
          <Field label={t("widget.weatherCity")}>
            <input className={field} value={query} autoFocus placeholder={a.city || t("widget.weatherSearch")} onChange={(e) => setQuery(e.target.value)} />
          </Field>
          {(search.data ?? []).map((p) => (
            <button
              key={`${p.latitude},${p.longitude}`}
              className="block w-full truncate rounded px-2 py-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
              onClick={() => {
                updateAttributes({ city: p.name, latitude: p.latitude, longitude: p.longitude });
                setQuery("");
              }}
            >
              {p.name} <span className="text-xs text-neutral-400">{[p.admin1, p.country].filter(Boolean).join(", ")}</span>
            </button>
          ))}
          <p className="text-xs text-neutral-400">{t("widget.weatherSource")}</p>
        </>,
      )}
    </Widget>
  );
}

/* ---------- Quote ---------- */

// Old enough to be quoted freely; translated both ways.
const QUOTES: { fr: string; en: string; by: string }[] = [
  {
    fr: "Ce n'est pas parce que les choses sont difficiles que nous n'osons pas, c'est parce que nous n'osons pas qu'elles sont difficiles.",
    en: "It is not because things are difficult that we do not dare; it is because we do not dare that they are difficult.",
    by: "Sénèque · Seneca",
  },
  {
    fr: "Il n'est pas de vent favorable pour celui qui ne sait où il va.",
    en: "If one does not know to which port one is sailing, no wind is favorable.",
    by: "Sénèque · Seneca",
  },
  { fr: "Nous souffrons plus souvent en imagination que dans la réalité.", en: "We suffer more often in imagination than in reality.", by: "Sénèque · Seneca" },
  {
    fr: "Le bonheur de ta vie dépend de la qualité de tes pensées.",
    en: "The happiness of your life depends upon the quality of your thoughts.",
    by: "Marc Aurèle · Marcus Aurelius",
  },
  {
    fr: "Ce qui trouble les hommes, ce ne sont pas les choses, mais les jugements qu'ils portent sur les choses.",
    en: "Men are disturbed not by things, but by the views which they take of them.",
    by: "Épictète · Epictetus",
  },
  {
    fr: "Un voyage de mille lieues commence toujours par un premier pas.",
    en: "A journey of a thousand miles begins with a single step.",
    by: "Lao Tseu · Lao Tzu",
  },
  { fr: "Il faut cultiver notre jardin.", en: "We must cultivate our garden.", by: "Voltaire" },
  { fr: "Rien ne sert de courir ; il faut partir à point.", en: "There is no use running; one must set out on time.", by: "Jean de La Fontaine" },
  {
    fr: "Je n'ai fait celle-ci plus longue que parce que je n'ai pas eu le loisir de la faire plus courte.",
    en: "I have made this longer than usual because I have not had time to make it shorter.",
    by: "Blaise Pascal",
  },
  { fr: "Vingt fois sur le métier remettez votre ouvrage.", en: "Twenty times upon the loom, set your work again.", by: "Nicolas Boileau" },
  { fr: "Qui veut voyager loin ménage sa monture.", en: "Whoever wants to travel far spares their mount.", by: "Jean Racine" },
  { fr: "Hâte-toi lentement.", en: "Make haste slowly.", by: "Auguste · Augustus" },
  { fr: "Bien commencer, c'est la moitié du travail.", en: "Well begun is half done.", by: "Aristote · Aristotle" },
  {
    fr: "Le temps est ce que nous voulons le plus, mais ce que nous utilisons le plus mal.",
    en: "Time is what we want most, but what we use worst.",
    by: "William Penn",
  },
  { fr: "Tout est difficile avant d'être facile.", en: "All things are difficult before they are easy.", by: "Thomas Fuller" },
  {
    fr: "Le génie, c'est un pour cent d'inspiration et quatre-vingt-dix-neuf pour cent de transpiration.",
    en: "Genius is one percent inspiration and ninety-nine percent perspiration.",
    by: "Thomas Edison",
  },
  {
    fr: "La vie, c'est comme une bicyclette : il faut avancer pour ne pas perdre l'équilibre.",
    en: "Life is like riding a bicycle. To keep your balance, you must keep moving.",
    by: "Albert Einstein",
  },
  {
    fr: "Le meilleur moment pour planter un arbre, c'était il y a vingt ans. Le deuxième meilleur moment, c'est maintenant.",
    en: "The best time to plant a tree was twenty years ago. The second best time is now.",
    by: "Proverbe chinois · Chinese proverb",
  },
];

const dayNumber = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60_000) / 86_400_000);

export function QuoteView({ node, updateAttributes, editor, extension }: NodeViewProps) {
  const a = node.attrs as { databaseId: string | null; viewId: string | null; authorProp: string | null };
  const editable = editor.isEditable && !isPublic(extension);
  const settings = useSettings();
  useNow(60 * 60_000);
  const [shift, setShift] = useState(0);
  const fromDb = !!a.databaseId && !isPublic(extension);
  const { data, rows } = useViewRows(fromDb ? a.databaseId : null, a.viewId);
  const authorProp = data?.properties.find((p) => p.id === a.authorProp);
  const fr = currentLocale() === "fr";
  let text = "";
  let by = "";
  if (fromDb) {
    const list = rows.filter((r) => pageTitle(r.title).trim());
    const row = list.length ? list[(dayNumber() + shift) % list.length] : undefined;
    text = row ? pageTitle(row.title) : "";
    const v = row && authorProp ? row.values[authorProp.id] : null;
    by = typeof v === "string" ? (authorProp?.type === "select" ? (authorProp.config.options?.find((o) => o.id === v)?.name ?? "") : v) : "";
  } else {
    const q = QUOTES[(dayNumber() + shift) % QUOTES.length]!;
    text = fr ? q.fr : q.en;
    by = q.by.split(" · ")[fr ? 0 : 1] ?? q.by;
  }

  return (
    <Widget
      name="quote"
      icon={<MessageSquareQuote size={14} />}
      title={t("widget.quote")}
      tools={
        <>
          <button
            className="rounded px-1.5 py-0.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            onClick={() => setShift((s) => s + 1 + Math.floor(Math.random() * 5))}
            aria-label={t("widget.quoteAnother")}
            title={t("widget.quoteAnother")}
          >
            <Shuffle size={14} />
          </button>
          {editable && settings.button}
        </>
      }
    >
      {!text ? (
        <p className={empty}>{t("widget.rowsEmpty")}</p>
      ) : (
        <figure key={text} className={`${box} relative animate-[nt-fade-in_400ms_ease-out] pl-10`} data-quote>
          <span className="absolute top-1 left-3 font-serif text-5xl leading-none text-neutral-200 dark:text-neutral-700">“</span>
          <p className="text-lg leading-relaxed text-pretty">{text}</p>
          {by && <figcaption className="mt-2 text-sm text-neutral-500">— {by}</figcaption>}
        </figure>
      )}
      {settings.panel(
        <>
          <Field label={t("widget.quoteSource")}>
            <select
              className={field}
              value={a.databaseId ? "db" : "builtin"}
              onChange={(e) => e.target.value === "builtin" && updateAttributes({ databaseId: null, viewId: null, authorProp: null })}
            >
              <option value="builtin">{t("widget.quoteBuiltin")}</option>
              <option value="db" disabled={!a.databaseId}>
                {t("widget.quoteDatabase")}
              </option>
            </select>
          </Field>
          <DatabaseFields databaseId={a.databaseId} viewId={a.viewId} onChange={(x) => updateAttributes(x.databaseId ? { ...x, authorProp: null } : x)} />
          {data && (
            <Field label={t("widget.quoteAuthor")}>
              <select className={field} value={authorProp?.id ?? ""} onChange={(e) => updateAttributes({ authorProp: e.target.value || null })}>
                <option value="">—</option>
                {data.properties
                  .filter((p) => p.type === "text" || p.type === "select")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </Field>
          )}
          <p className="text-xs text-neutral-400">{t("widget.quoteHelp")}</p>
        </>,
      )}
    </Widget>
  );
}

/* ---------- Image carousel ---------- */

export function CarouselView({ node, updateAttributes, editor, extension }: NodeViewProps) {
  const a = node.attrs as { images: string[]; interval: number; ratio: string };
  const pageId = extension.options.pageId as string | null;
  const editable = editor.isEditable && !isPublic(extension) && !!pageId;
  const settings = useSettings();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const count = a.images.length;
  const current = count ? ((index % count) + count) % count : 0;
  const go = (d: number) => setIndex((i) => i + d);
  const reduced = useRef(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    if (!a.interval || count < 2 || paused || reduced.current) return;
    const timer = window.setInterval(() => setIndex((i) => i + 1), a.interval * 1000);
    return () => window.clearInterval(timer);
  }, [a.interval, count, paused]);

  const upload = async () => {
    if (!pageId) return;
    const files = await pickFiles("image/*");
    setBusy(true);
    try {
      const added: string[] = [];
      for (const file of files) added.push((await uploadFile(pageId, file)).url);
      updateAttributes({ images: [...a.images, ...added] });
    } finally {
      setBusy(false);
    }
  };
  const remove = (i: number) => updateAttributes({ images: a.images.filter((_, j) => j !== i) });
  const move = (i: number, d: number) => {
    const list = [...a.images];
    const [img] = list.splice(i, 1);
    list.splice(i + d, 0, img!);
    updateAttributes({ images: list });
  };
  const arrow =
    "absolute top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 text-neutral-700 opacity-0 shadow transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-white dark:bg-neutral-900/80 dark:text-neutral-200";

  return (
    <Widget name="carousel" icon={<Images size={14} />} title={t("widget.carousel")} tools={editable && settings.button}>
      {!count ? (
        <div className={`${empty} flex flex-col items-start gap-2`}>
          <span>{editable ? t("widget.carouselEmpty") : t("calendarBlock.emptyReadOnly")}</span>
          {editable && (
            <button
              className="flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-60"
              disabled={busy}
              onClick={() => void upload()}
            >
              <Upload size={13} /> {busy ? t("common.loading") : t("widget.carouselAdd")}
            </button>
          )}
        </div>
      ) : (
        <div
          className="group relative overflow-hidden rounded-xl bg-neutral-100 outline-none dark:bg-neutral-800"
          style={{ aspectRatio: a.ratio || "16 / 9" }}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") go(-1);
            if (e.key === "ArrowRight") go(1);
          }}
          role="region"
          aria-roledescription="carousel"
          aria-label={t("widget.carousel")}
          data-carousel={current}
        >
          {a.images.map((src, i) => (
            <img
              key={`${src}-${i}`}
              src={src}
              alt=""
              loading="lazy"
              draggable={false}
              className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ease-in-out ${i === current ? "opacity-100" : "opacity-0"}`}
              aria-hidden={i !== current}
            />
          ))}
          {count > 1 && (
            <>
              <button className={`${arrow} left-2`} onClick={() => go(-1)} aria-label={t("widget.previous")}>
                <ChevronLeft size={18} />
              </button>
              <button className={`${arrow} right-2`} onClick={() => go(1)} aria-label={t("widget.next")}>
                <ChevronRight size={18} />
              </button>
              <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
                {a.images.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setIndex(i)}
                    aria-label={t("widget.carouselImage", { n: i + 1 })}
                    aria-current={i === current}
                    className={`h-1.5 rounded-full bg-white shadow transition-all duration-300 ${i === current ? "w-4 opacity-100" : "w-1.5 opacity-60 hover:opacity-90"}`}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {settings.panel(
        <>
          <div className="grid grid-cols-4 gap-1.5">
            {a.images.map((src, i) => (
              <div key={`${src}-${i}`} className="group/t relative aspect-square overflow-hidden rounded bg-neutral-100 dark:bg-neutral-800">
                <img src={src} alt="" className="h-full w-full object-cover" />
                <div className="absolute inset-0 flex items-end justify-between bg-black/40 p-0.5 opacity-0 transition-opacity group-hover/t:opacity-100">
                  <button
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    className="rounded p-0.5 text-white disabled:opacity-30"
                    aria-label={t("widget.moveLeft")}
                  >
                    <ChevronLeft size={12} />
                  </button>
                  <button onClick={() => remove(i)} className="rounded p-0.5 text-white" aria-label={t("common.remove")}>
                    <Trash2 size={12} />
                  </button>
                  <button
                    disabled={i === count - 1}
                    onClick={() => move(i, 1)}
                    className="rounded p-0.5 text-white disabled:opacity-30"
                    aria-label={t("widget.moveRight")}
                  >
                    <ChevronRight size={12} />
                  </button>
                </div>
              </div>
            ))}
            <button
              onClick={() => void upload()}
              disabled={busy}
              className="flex aspect-square items-center justify-center rounded border border-dashed border-neutral-300 text-neutral-400 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
              aria-label={t("widget.carouselAdd")}
            >
              <ImagePlus size={16} />
            </button>
          </div>
          <form
            className="flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (/^https?:\/\//.test(url.trim())) updateAttributes({ images: [...a.images, url.trim()] });
              setUrl("");
            }}
          >
            <input className={field} value={url} placeholder={t("widget.carouselUrl")} onChange={(e) => setUrl(e.target.value)} />
          </form>
          <div className="flex gap-2">
            <Field label={t("widget.carouselInterval")}>
              <select className={field} value={a.interval} onChange={(e) => updateAttributes({ interval: Number(e.target.value) })}>
                {[0, 3, 5, 8, 15].map((s) => (
                  <option key={s} value={s}>
                    {s ? `${s} s` : t("widget.carouselManual")}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("widget.carouselRatio")}>
              <select className={field} value={a.ratio} onChange={(e) => updateAttributes({ ratio: e.target.value })}>
                {["16 / 9", "4 / 3", "1 / 1", "21 / 9"].map((r) => (
                  <option key={r} value={r}>
                    {r.replace(/ /g, "")}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </>,
        300,
      )}
    </Widget>
  );
}
