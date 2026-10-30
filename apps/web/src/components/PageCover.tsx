import { useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { COVER_GRADIENTS, t, type MessageKey } from "@nootion/shared";
import { Popover } from "../database/Popover";
import { pickFiles, uploadFile } from "../editor/upload";

const GRADIENTS: Record<(typeof COVER_GRADIENTS)[number], string> = {
  sunset: "linear-gradient(135deg, #f6d365, #fda085)",
  ocean: "linear-gradient(135deg, #89f7fe, #66a6ff)",
  forest: "linear-gradient(135deg, #c1e59f, #56ab2f)",
  dusk: "linear-gradient(135deg, #a18cd1, #fbc2eb)",
  peach: "linear-gradient(135deg, #ffecd2, #fcb69f)",
  slate: "linear-gradient(135deg, #8e9eab, #3f4c6b)",
};

const gradientOf = (cover: string) => (cover.startsWith("gradient:") ? (GRADIENTS[cover.slice(9) as keyof typeof GRADIENTS] ?? null) : null);

export interface CoverPatch {
  cover?: string | null;
  coverPosition?: number;
}

const BANNER = "relative h-36 w-full overflow-hidden bg-neutral-100 sm:h-52 dark:bg-neutral-800";

/** Banner at the top of a page. Editors change it, and drag an image up or down to choose the part shown. */
export function PageCover({
  pageId,
  cover,
  position,
  editable,
  onChange,
}: {
  pageId: string;
  cover: string;
  position: number;
  editable: boolean;
  onChange: (patch: CoverPatch) => void;
}) {
  const [picker, setPicker] = useState<HTMLElement | null>(null);
  // Position while repositioning, saved or dropped at the end.
  const [moving, setMoving] = useState<number | null>(null);
  const img = useRef<HTMLImageElement>(null);
  const drag = useRef<{ y: number; from: number; range: number } | null>(null);
  const gradient = gradientOf(cover);
  const shown = moving ?? position;

  function onPointerDown(e: React.PointerEvent) {
    const el = img.current;
    if (moving === null || !el?.naturalWidth) return;
    // How far the image overflows its banner, once scaled to cover it.
    const box = el.getBoundingClientRect();
    const scale = Math.max(box.width / el.naturalWidth, box.height / el.naturalHeight);
    const range = el.naturalHeight * scale - box.height;
    if (range <= 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, from: moving, range };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    setMoving(Math.round(Math.min(100, Math.max(0, d.from - ((e.clientY - d.y) / d.range) * 100))));
  }

  const btn = "rounded bg-white/90 px-2 py-1 text-xs text-neutral-700 shadow-sm hover:bg-white dark:bg-neutral-900/90 dark:text-neutral-200 dark:hover:bg-neutral-900";
  return (
    <div className={`group ${BANNER}`} data-cover>
      {gradient ? (
        <div className="h-full w-full" style={{ background: gradient }} />
      ) : (
        <img
          ref={img}
          src={cover}
          alt=""
          draggable={false}
          className={`h-full w-full select-none object-cover ${moving !== null ? "cursor-ns-resize touch-none" : ""}`}
          style={{ objectPosition: `center ${shown}%` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => (drag.current = null)}
        />
      )}
      {editable && moving !== null && (
        <>
          <span className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm font-medium text-white drop-shadow">
            {t("cover.dragHint")}
          </span>
          <div className="absolute bottom-2 right-2 flex gap-1">
            <button
              className={btn}
              onClick={() => {
                onChange({ coverPosition: moving });
                setMoving(null);
              }}
            >
              {t("cover.savePosition")}
            </button>
            <button className={btn} onClick={() => setMoving(null)}>
              {t("common.cancel")}
            </button>
          </div>
        </>
      )}
      {editable && moving === null && (
        <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100">
          <button className={btn} onClick={(e) => setPicker(e.currentTarget)}>
            {t("cover.change")}
          </button>
          {!gradient && (
            <button className={btn} onClick={() => setMoving(position)}>
              {t("cover.reposition")}
            </button>
          )}
        </div>
      )}
      {picker && <CoverPicker anchor={picker} pageId={pageId} hasCover onClose={() => setPicker(null)} onChange={onChange} />}
    </div>
  );
}

/** "Add a cover" button, shown next to "Add an icon" on pages without one. */
export function AddCoverButton({ pageId, onChange }: { pageId: string; onChange: (patch: CoverPatch) => void }) {
  const [picker, setPicker] = useState<HTMLElement | null>(null);
  return (
    <>
      <button
        onClick={(e) => setPicker(e.currentTarget)}
        className="mb-2 flex items-center gap-1 rounded px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        <ImagePlus size={16} /> {t("cover.add")}
      </button>
      {picker && <CoverPicker anchor={picker} pageId={pageId} hasCover={false} onClose={() => setPicker(null)} onChange={onChange} />}
    </>
  );
}

function CoverPicker({
  anchor,
  pageId,
  hasCover,
  onClose,
  onChange,
}: {
  anchor: HTMLElement;
  pageId: string;
  hasCover: boolean;
  onClose: () => void;
  onChange: (patch: CoverPatch) => void;
}) {
  const [link, setLink] = useState("");
  const [uploading, setUploading] = useState(false);
  const pick = (cover: string | null) => {
    onChange({ cover, coverPosition: 50 });
    onClose();
  };

  async function upload() {
    const [file] = await pickFiles("image/*");
    if (!file) return;
    setUploading(true);
    try {
      pick((await uploadFile(pageId, file)).url);
    } catch (err) {
      alert(t("editor.uploadFailed", { name: file.name, error: err instanceof Error ? err.message : String(err) }));
      setUploading(false);
    }
  }

  const item = "w-full rounded px-2 py-1.5 text-left hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800";
  return (
    <Popover anchor={anchor} onClose={onClose} width={280}>
      <div className="px-2 pb-1 pt-1 text-xs font-medium text-neutral-500">{t("cover.gradients")}</div>
      <div className="grid grid-cols-3 gap-1.5 px-2 pb-2">
        {COVER_GRADIENTS.map((name) => (
          <button
            key={name}
            onClick={() => pick(`gradient:${name}`)}
            aria-label={t(`cover.gradient.${name}` as MessageKey)}
            className="h-10 rounded ring-blue-500 hover:ring-2"
            style={{ background: GRADIENTS[name] }}
          />
        ))}
      </div>
      <button className={item} onClick={upload} disabled={uploading}>
        {uploading ? t("common.uploading") : t("cover.upload")}
      </button>
      <form
        className="flex gap-1 px-2 py-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (/^https?:\/\/\S+$/.test(link.trim())) pick(link.trim());
        }}
      >
        <input
          type="url"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder={t("cover.linkPlaceholder")}
          aria-label={t("cover.link")}
          className="min-w-0 flex-1 rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700"
        />
        <button type="submit" className="rounded bg-blue-600 px-2 py-1 text-sm text-white hover:bg-blue-700">
          {t("common.add")}
        </button>
      </form>
      {hasCover && (
        <button className={`${item} text-red-600`} onClick={() => pick(null)}>
          {t("cover.remove")}
        </button>
      )}
    </Popover>
  );
}

/** Read-only banner, for public pages. */
export function CoverBanner({ cover, position }: { cover: string; position: number }) {
  return (
    <div className={BANNER}>
      <CoverFill cover={cover} position={position} />
    </div>
  );
}

/** A cover filling its box: a gradient, or an image cropped at the chosen position. */
export function CoverFill({ cover, position }: { cover: string; position: number }) {
  const gradient = gradientOf(cover);
  return gradient ? (
    <div className="h-full w-full" style={{ background: gradient }} />
  ) : (
    <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover" style={{ objectPosition: `center ${position}%` }} />
  );
}
