import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { t } from "@nootion/shared";
import { useClosing } from "../components/ui";
import { dragCrop, FULL_CROP, fitRatio, isFullCrop, type Crop, type CropHandle } from "./imageGeometry";

/** Shapes the crop can be locked to (width / height). */
const RATIOS: { id: string; label: () => string; value: number | null }[] = [
  { id: "free", label: () => t("image.cropFree"), value: null },
  { id: "1:1", label: () => "1:1", value: 1 },
  { id: "4:3", label: () => "4:3", value: 4 / 3 },
  { id: "16:9", label: () => "16:9", value: 16 / 9 },
  { id: "3:4", label: () => "3:4", value: 3 / 4 },
];
const CORNERS: CropHandle[] = ["nw", "ne", "sw", "se"];
const EDGES: CropHandle[] = ["n", "s", "e", "w"];

/**
 * Crops an image: a frame over the whole image, moved by dragging it and resized by its corners and sides (with the
 * mouse or a finger), free or at a fixed shape. Nothing changes until "Apply"; the file itself is never changed.
 */
export function ImageCropDialog({
  src,
  alt,
  crop,
  onCancel,
  onApply,
}: {
  src: string;
  alt: string;
  crop: Crop | null;
  onCancel: () => void;
  onApply: (crop: Crop | null) => void;
}) {
  const { closing, close } = useClosing(onCancel);
  const [ratio, setRatio] = useState<number | null>(null);
  // Known once the image is loaded: its own width / height.
  const [natural, setNatural] = useState<number | null>(crop?.r ?? null);
  const [value, setValue] = useState<Crop | null>(crop);
  const box = useRef<HTMLDivElement>(null);
  const current = value ?? (natural ? FULL_CROP(natural) : null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  function start(handle: CropHandle, e: ReactPointerEvent<HTMLElement>) {
    if (!current || !box.current || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const rect = box.current.getBoundingClientRect();
    const from = current;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const move = (ev: PointerEvent) => setValue(dragCrop(from, handle, (ev.clientX - x0) / rect.width, (ev.clientY - y0) / rect.height, ratio));
    const end = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }

  function pickRatio(next: number | null) {
    setRatio(next);
    if (next && current) setValue(fitRatio(current, next));
  }

  const pct = (v: number) => `${v * 100}%`;

  return createPortal(
    <div
      className="nt-backdrop fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/80 p-4"
      data-closing={closing || undefined}
      role="dialog"
      aria-modal="true"
      aria-label={t("image.cropTitle")}
      data-image-crop-dialog=""
    >
      <div className="nt-dialog flex max-h-full w-full max-w-4xl flex-col items-center gap-3">
        <h2 className="self-start text-base font-semibold text-white">{t("image.cropTitle")}</h2>
        <div className="flex min-h-0 w-full flex-1 items-center justify-center">
          <div ref={box} className="relative w-fit max-w-full touch-none select-none">
            <img
              src={src}
              alt={alt}
              draggable={false}
              className="block max-h-[65dvh] max-w-full"
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.naturalWidth && img.naturalHeight) setNatural(img.naturalWidth / img.naturalHeight);
              }}
            />
            {current && (
              <>
                {/* Darkens what is cut off, around the frame. */}
                <div
                  className="pointer-events-none absolute"
                  style={{
                    left: pct(current.x),
                    top: pct(current.y),
                    width: pct(current.w),
                    height: pct(current.h),
                    boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.55)",
                  }}
                />
                <div
                  className="crop-frame absolute cursor-move border-2 border-white"
                  style={{ left: pct(current.x), top: pct(current.y), width: pct(current.w), height: pct(current.h) }}
                  onPointerDown={(e) => start("move", e)}
                  data-crop-frame=""
                >
                  {/* Thirds, to place what matters. */}
                  <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
                    {Array.from({ length: 9 }, (_, i) => (
                      <div key={i} className="border border-white/25" />
                    ))}
                  </div>
                  {[...CORNERS, ...(ratio ? [] : EDGES)].map((h) => (
                    <span key={h} className="crop-handle" data-handle={h} onPointerDown={(e) => start(h, e)} />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t("image.cropShape")}>
            {RATIOS.map((r) => (
              <button
                key={r.id}
                type="button"
                role="radio"
                aria-checked={ratio === r.value}
                onClick={() => pickRatio(r.value)}
                className={`rounded-md px-2.5 py-1.5 text-sm ${ratio === r.value ? "bg-white text-neutral-900" : "text-white hover:bg-white/15"}`}
              >
                {r.label()}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setRatio(null);
                setValue(null);
              }}
              disabled={!current || isFullCrop(current)}
              className="rounded-md px-3 py-1.5 text-sm text-white hover:bg-white/15 disabled:opacity-40"
            >
              {t("image.cropReset")}
            </button>
            <button type="button" onClick={close} className="rounded-md px-3 py-1.5 text-sm text-white hover:bg-white/15">
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={!current}
              onClick={() => onApply(current && !isFullCrop(current) ? current : null)}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
              data-crop-apply=""
            >
              {t("image.cropApply")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
