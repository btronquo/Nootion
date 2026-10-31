import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Shuffle, SmilePlus, X } from "lucide-react";
import { CUSTOM_ICON_PREFIX, currentLocale, ICON_MAX_BYTES, t, type CustomIcon } from "@nootion/shared";
import { api, ApiError } from "../lib/api";
import { pageIcon } from "../lib/icons";
import { Popover } from "../database/Popover";

interface Emoji {
  unicode: string;
  label: string;
  group?: number;
  tags?: string[];
}

// Unicode's groups, in their order; 2 (skin tones and hair) is not offered on its own.
const GROUPS = [0, 1, 3, 4, 5, 6, 7, 8, 9] as const;
const RECENT_KEY = "nootion-recent-icons";

/** Every emoji with its name and keywords in the interface language, loaded the first time the picker opens. */
function useEmojis() {
  const locale = currentLocale();
  return useQuery({
    queryKey: ["emojis", locale],
    queryFn: async () => {
      const data: Emoji[] = (locale === "fr" ? await import("emojibase-data/fr/compact.json") : await import("emojibase-data/en/compact.json")).default;
      return data.filter((e) => e.group !== undefined && e.group !== 2).map(({ unicode, label, group, tags }) => ({ unicode, label, group, tags }));
    },
    staleTime: Infinity,
  });
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();

function readRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function remember(icon: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([icon, ...readRecent().filter((i) => i !== icon)].slice(0, 16)));
  } catch {
    // Private browsing: nothing kept.
  }
}

export function IconPicker({ icon, editable, onChange }: { icon: string | null; editable: boolean; onChange: (icon: string | null) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (!editable && !icon) return null;
  return (
    <div className="mb-2">
      {icon ? (
        <button
          disabled={!editable}
          onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
          aria-label={t("icon.change")}
          className="rounded-lg p-1 text-5xl leading-none hover:bg-neutral-100 disabled:hover:bg-transparent dark:hover:bg-neutral-800"
        >
          {pageIcon(icon)}
        </button>
      ) : (
        <button
          onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
          className="flex items-center gap-1 rounded px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <SmilePlus size={16} /> {t("icon.add")}
        </button>
      )}
      {anchor && (
        <IconPanel
          anchor={anchor}
          hasIcon={!!icon}
          onClose={() => setAnchor(null)}
          onPick={(i) => {
            if (i) remember(i);
            onChange(i);
            setAnchor(null);
          }}
        />
      )}
    </div>
  );
}

function IconPanel({
  anchor,
  hasIcon,
  onClose,
  onPick,
}: {
  anchor: HTMLElement;
  hasIcon: boolean;
  onClose: () => void;
  onPick: (icon: string | null) => void;
}) {
  const [tab, setTab] = useState<"emoji" | "custom">("emoji");
  const tabClass = (on: boolean) =>
    `rounded px-2 py-1 text-sm ${on ? "bg-neutral-100 font-medium dark:bg-neutral-800" : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"}`;
  return (
    <Popover anchor={anchor} onClose={onClose} width={360}>
      <div data-icon-picker>
        <div className="mb-1 flex items-center gap-1 border-b border-neutral-200 px-1 pb-1 dark:border-neutral-800">
          <button type="button" className={tabClass(tab === "emoji")} onClick={() => setTab("emoji")}>
            {t("icon.emoji")}
          </button>
          <button type="button" className={tabClass(tab === "custom")} onClick={() => setTab("custom")}>
            {t("icon.customTab")}
          </button>
          {hasIcon && (
            <button
              type="button"
              className="ml-auto rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              onClick={() => onPick(null)}
            >
              {t("icon.remove")}
            </button>
          )}
        </div>
        {tab === "emoji" ? <EmojiTab onPick={onPick} /> : <CustomTab onPick={onPick} />}
      </div>
    </Popover>
  );
}

const cell = "flex h-8 w-8 items-center justify-center rounded text-2xl leading-none hover:bg-neutral-100 dark:hover:bg-neutral-800";

function EmojiTab({ onPick }: { onPick: (icon: string) => void }) {
  const emojis = useEmojis();
  const [query, setQuery] = useState("");
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => box.current?.focus(), []);
  const recent = useMemo(() => readRecent(), []);
  const found = useMemo(() => {
    const q = fold(query.trim());
    if (!q || !emojis.data) return null;
    return emojis.data.filter((e) => fold(e.label).includes(q) || e.tags?.some((tag) => fold(tag).startsWith(q)));
  }, [query, emojis.data]);
  const grid = (list: { unicode: string; label: string }[]) => (
    <div className="grid grid-cols-10 gap-0.5">
      {list.map((e) => (
        <button key={e.unicode} type="button" className={cell} title={e.label} onClick={() => onPick(e.unicode)}>
          {e.unicode}
        </button>
      ))}
    </div>
  );
  const heading = (text: string) => <p className="sticky top-0 bg-white px-1 pt-2 pb-1 text-xs font-medium text-neutral-500 dark:bg-neutral-900">{text}</p>;

  return (
    <div>
      <div className="flex gap-1 px-1">
        <input
          ref={box}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("icon.search")}
          aria-label={t("icon.search")}
          className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="button"
          title={t("icon.random")}
          aria-label={t("icon.random")}
          disabled={!emojis.data}
          className="rounded-md border border-neutral-300 px-2 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          onClick={() => emojis.data && onPick(emojis.data[Math.floor(Math.random() * emojis.data.length)]!.unicode)}
        >
          <Shuffle size={14} />
        </button>
      </div>
      <div className="mt-1 h-72 overflow-y-auto px-1" data-emoji-grid>
        {!emojis.data ? (
          <p className="p-2 text-sm text-neutral-500">{t("common.loading")}</p>
        ) : found ? (
          found.length ? (
            grid(found.slice(0, 300))
          ) : (
            <p className="p-2 text-sm text-neutral-500">{t("icon.noEmoji")}</p>
          )
        ) : (
          <>
            {recent.length > 0 && (
              <>
                {heading(t("icon.recent"))}
                <div className="grid grid-cols-10 gap-0.5">
                  {recent.map((i) => (
                    <button key={i} type="button" className={cell} onClick={() => onPick(i)}>
                      {pageIcon(i)}
                    </button>
                  ))}
                </div>
              </>
            )}
            {GROUPS.map((g) => (
              <div key={g}>
                {heading(t(`icon.group.${g}`))}
                {grid(emojis.data.filter((e) => e.group === g))}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/** Images uploaded by people on this server, and a button to add one. */
function CustomTab({ onPick }: { onPick: (icon: string) => void }) {
  const qc = useQueryClient();
  const icons = useQuery({ queryKey: ["custom-icons"], queryFn: async () => (await api<{ icons: CustomIcon[] }>("/icons")).icons });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  async function upload(f: File) {
    setError(null);
    if (f.size > ICON_MAX_BYTES) return setError(t("error.iconTooLarge"));
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", f, f.name);
      const res = await fetch("/api/icons", { method: "POST", body: form, credentials: "same-origin" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, data?.error ?? "error", data?.message ?? t("common.errorStatus", { status: res.status }));
      const icon = (data as { icon: CustomIcon }).icon;
      await qc.invalidateQueries({ queryKey: ["custom-icons"] });
      onPick(CUSTOM_ICON_PREFIX + icon.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(icon: CustomIcon) {
    if (!confirm(t("icon.confirmDelete", { name: icon.name }))) return;
    await api(`/icons/${icon.id}`, { method: "DELETE" }).catch((e: Error) => setError(e.message));
    await qc.invalidateQueries({ queryKey: ["custom-icons"] });
  }

  return (
    <div className="px-1">
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => file.current?.click()}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-neutral-300 px-2 py-2 text-sm text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        <ImagePlus size={15} /> {busy ? t("common.loading") : t("icon.upload")}
      </button>
      <p className="mt-1 text-xs text-neutral-500">{t("icon.uploadHelp")}</p>
      {error && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="mt-2 grid max-h-60 grid-cols-8 gap-1 overflow-y-auto" data-custom-icons>
        {(icons.data ?? []).map((i) => (
          <div key={i.id} className="group relative">
            <button type="button" className={`${cell} w-full`} title={i.name} onClick={() => onPick(CUSTOM_ICON_PREFIX + i.id)}>
              <img src={i.url} alt={i.name} className="h-7 w-7 rounded-[3px] object-contain" />
            </button>
            {i.canDelete && (
              <button
                type="button"
                title={t("icon.delete")}
                aria-label={t("icon.delete")}
                onClick={() => void remove(i)}
                className="absolute -top-1 -right-1 hidden h-4 w-4 items-center justify-center rounded-full bg-neutral-700 text-white group-hover:flex"
              >
                <X size={10} />
              </button>
            )}
          </div>
        ))}
      </div>
      {icons.data?.length === 0 && <p className="py-2 text-sm text-neutral-500">{t("icon.noCustom")}</p>}
    </div>
  );
}
