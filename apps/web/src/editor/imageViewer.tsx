import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react";
import { t } from "@nootion/shared";
import { useClosing } from "../components/ui";

export type ViewerImage = { src: string; alt: string };

/**
 * Opens a page's images in a full-screen viewer when they are clicked, in the editor and in the read-only views.
 * Alt+click or Shift+click selects the image instead, as a click used to (to delete or move it).
 */
export const ImageViewer = Extension.create({
  name: "imageViewer",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("imageViewer"),
        props: {
          handleClick: (view, _pos, event) => {
            if (event.button !== 0 || event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) return false;
            const target = event.target as HTMLElement | null;
            // Only the image blocks: blocks drawn by their own components (widgets, carousels...) handle their own clicks.
            if (!(target instanceof HTMLImageElement) || !isImageBlock(target, view.dom)) return false;
            const imgs = pageImages(view.dom);
            event.preventDefault();
            openImageViewer(
              imgs.map((img) => ({ src: img.currentSrc || img.src, alt: img.alt })),
              Math.max(0, imgs.indexOf(target)),
            );
            return true;
          },
        },
      }),
    ];
  },
});

/** The image blocks of the page, in reading order. */
function pageImages(root: HTMLElement): HTMLImageElement[] {
  return [...root.querySelectorAll("img")].filter((img) => isImageBlock(img, root));
}

/**
 * An image of the content itself, not one inside a block drawn by its own component, nor a link.
 * (ProseMirror marks the image itself contenteditable="false", and the whole read-only view too.)
 */
function isImageBlock(img: HTMLImageElement, root: HTMLElement): boolean {
  const drawn = img.parentElement?.closest('[contenteditable="false"]');
  return !!img.src && root.contains(img) && (!drawn || drawn === root) && !img.closest("a[href]");
}

let host: { root: Root; el: HTMLElement } | null = null;

/** Shows images in the full-screen viewer, starting at the given one. */
export function openImageViewer(images: ViewerImage[], index = 0) {
  if (!images.length) return;
  if (!host) {
    const el = document.createElement("div");
    document.body.appendChild(el);
    host = { root: createRoot(el), el };
  }
  const close = () => {
    host?.root.unmount();
    host?.el.remove();
    host = null;
  };
  // A new key restarts the viewer if one was already open.
  host.root.render(<Viewer key={Date.now()} images={images} start={Math.min(index, images.length - 1)} onClose={close} />);
}

function Viewer({ images, start, onClose }: { images: ViewerImage[]; start: number; onClose: () => void }) {
  const { closing, close } = useClosing(onClose);
  const [index, setIndex] = useState(start);
  // Full size: the image at its own size, to scroll around in (when it is bigger than the screen).
  const [full, setFull] = useState(false);
  const [bigger, setBigger] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const image = images[index]!;
  const many = images.length > 1;

  const go = useCallback(
    (d: number) => {
      setFull(false);
      setIndex((i) => (i + d + images.length) % images.length);
    },
    [images.length],
  );

  // Whether the fitted image is shrunk, so that showing it at full size shows more.
  const measure = useCallback(() => {
    const el = img.current;
    if (el?.naturalWidth) setBigger(el.naturalWidth > window.innerWidth * 0.92 || el.naturalHeight > window.innerHeight * 0.86);
  }, []);
  useEffect(() => {
    setBigger(false);
    if (img.current?.complete) measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [index, measure]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft" && many) go(-1);
      else if (e.key === "ArrowRight" && many) go(1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    // Capture: the editor and the page's own shortcuts must not get these keys while the viewer is open.
    window.addEventListener("keydown", onKey, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focused = document.activeElement as HTMLElement | null;
    focused?.blur?.();
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
    };
  }, [close, go, many]);

  // Full size: starts on the middle of the image.
  useLayoutEffect(() => {
    const s = scroller.current;
    if (full && s) {
      s.scrollLeft = (s.scrollWidth - s.clientWidth) / 2;
      s.scrollTop = (s.scrollHeight - s.clientHeight) / 2;
    }
  }, [full]);

  // Swipe left or right to change image, on touch screens (small screens have no arrows, which would cover the image).
  const touch = useRef<{ x: number; y: number } | null>(null);

  const button = "flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white/85 transition hover:bg-black/70 hover:text-white";
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={image.alt || t("imageViewer.close")}
      className="nt-backdrop fixed inset-0 z-[100] bg-black/95 select-none"
      data-closing={closing || undefined}
      onTouchStart={(e) => {
        const p = e.touches[0];
        touch.current = !full && e.touches.length === 1 && p ? { x: p.clientX, y: p.clientY } : null;
      }}
      onTouchEnd={(e) => {
        const from = touch.current;
        const p = e.changedTouches[0];
        touch.current = null;
        if (!from || !p || !many) return;
        const dx = p.clientX - from.x;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(p.clientY - from.y) * 1.5) go(dx < 0 ? 1 : -1);
      }}
    >
      <div
        ref={scroller}
        className={`absolute inset-0 overflow-auto ${full ? "" : "flex items-center justify-center p-4 sm:p-12"}`}
        // A click beside the image closes the viewer.
        onClick={(e) => e.target === e.currentTarget && close()}
      >
        <img
          ref={img}
          key={image.src}
          src={image.src}
          alt={image.alt}
          draggable={false}
          onLoad={measure}
          onClick={() => bigger && setFull((f) => !f)}
          title={bigger ? t(full ? "imageViewer.zoomOut" : "imageViewer.zoomIn") : undefined}
          className={
            full
              ? "m-auto block max-w-none cursor-zoom-out"
              : `nt-dialog max-h-full max-w-full rounded-sm object-contain shadow-2xl ${bigger ? "cursor-zoom-in" : ""}`
          }
        />
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 p-3">
        {many && (
          <span className="rounded-full bg-black/40 px-3 py-1 text-sm text-white/85 tabular-nums">
            {index + 1} / {images.length}
          </span>
        )}
        {image.alt && <span className="min-w-0 truncate text-sm text-white/70">{image.alt}</span>}
        <div className="pointer-events-auto ml-auto flex gap-2">
          <a className={button} href={image.src} target="_blank" rel="noopener noreferrer" title={t("imageViewer.open")} aria-label={t("imageViewer.open")}>
            <ExternalLink size={18} />
          </a>
          <button type="button" className={button} onClick={close} title={t("imageViewer.close")} aria-label={t("imageViewer.close")}>
            <X size={20} />
          </button>
        </div>
      </div>

      {many && (
        <>
          <button
            type="button"
            className={`${button} absolute top-1/2 left-3 max-sm:hidden -translate-y-1/2`}
            onClick={() => go(-1)}
            title={t("imageViewer.previous")}
            aria-label={t("imageViewer.previous")}
          >
            <ChevronLeft size={22} />
          </button>
          <button
            type="button"
            className={`${button} absolute top-1/2 right-3 max-sm:hidden -translate-y-1/2`}
            onClick={() => go(1)}
            title={t("imageViewer.next")}
            aria-label={t("imageViewer.next")}
          >
            <ChevronRight size={22} />
          </button>
        </>
      )}
    </div>
  );
}
