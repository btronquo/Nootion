import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Captions,
  Crop as CropIcon,
  Download,
  Maximize2,
  MessageSquare,
  MessageSquarePlus,
  MoreHorizontal,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { t } from "@nootion/shared";
import { Popover } from "../database/Popover";
import { useIsTouch } from "../lib/mobile";
import { openImageViewer } from "./imageViewer";
import { ImageCropDialog } from "./ImageCropDialog";
import { cropStyles, parseAlign, parseCrop, parseWidth, resizedWidth, roundCrop, widthAfterCrop, type Crop, type ImageAlign } from "./imageGeometry";

const ALIGN_ICONS: Record<ImageAlign, ReactNode> = {
  left: <AlignLeft size={16} />,
  center: <AlignCenter size={16} />,
  right: <AlignRight size={16} />,
};
const ALIGN_LABELS: Record<ImageAlign, () => string> = {
  left: () => t("image.alignLeft"),
  center: () => t("image.alignCenter"),
  right: () => t("image.alignRight"),
};

/** The address that downloads a file of this server instead of showing it. */
function downloadUrl(src: string): string {
  return /^\/api\/(attachments|public)\//.test(src) ? `${src}${src.includes("?") ? "&" : "?"}download` : src;
}

/**
 * An image of the page. On hover (or once tapped on a touch screen) it shows a bar to align it, give it a caption,
 * comment on it, crop it, see it full screen or download it, and a handle on each side to change its width.
 */
export function ImageBlockView({ node, editor, updateAttributes, deleteNode, getPos, selected, decorations }: NodeViewProps) {
  const editable = editor.isEditable;
  const touch = useIsTouch();
  const src = String(node.attrs.src ?? "");
  const alt = String(node.attrs.alt ?? "");
  const width = parseWidth(node.attrs.width);
  const align = parseAlign(node.attrs.align);
  const crop = parseCrop(node.attrs.crop);
  const caption = typeof node.attrs.caption === "string" ? node.attrs.caption : null;
  const storage = editor.storage.image;
  const canComment = !!storage?.onComment;

  const figure = useRef<HTMLElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLTextAreaElement>(null);
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ kind: "align" | "more"; anchor: HTMLElement } | null>(null);
  const [cropping, setCropping] = useState(false);
  const [focusCaption, setFocusCaption] = useState(false);

  // Comments on the image itself: the editor marks it with a decoration carrying the thread.
  const threads = decorations
    .map((d) => (d as unknown as { spec?: { commentThread?: string; active?: boolean } }).spec)
    .filter((s): s is { commentThread: string; active?: boolean } => !!s?.commentThread);
  const activeThread = threads.some((s) => s.active);
  // The comment being written shows on the image, but has no thread to open yet.
  const saved = threads.filter((s) => s.commentThread !== "draft");

  useEffect(() => {
    if (!focusCaption) return;
    setFocusCaption(false);
    captionRef.current?.focus();
  }, [focusCaption]);

  // The caption's box grows with its text.
  useLayoutEffect(() => {
    const el = captionRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [caption, liveWidth, width]);

  const shownWidth = liveWidth ?? width;
  const active = selected || !!menu || liveWidth !== null || activeThread;

  function startResize(side: "left" | "right", e: ReactPointerEvent<HTMLDivElement>) {
    if (!frame.current || !figure.current || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const start = frame.current.getBoundingClientRect().width;
    const max = figure.current.clientWidth;
    let current = Math.round(start);
    setLiveWidth(current);
    const move = (ev: PointerEvent) => {
      current = resizedWidth(start, ev.clientX - startX, side, align, max);
      setLiveWidth(current);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      setLiveWidth(null);
      // As wide as the page: kept as "full width", so it follows the page if it gets wider.
      if (current !== Math.round(start)) updateAttributes({ width: current >= max ? null : current });
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  function resizeByKey(side: "left" | "right", e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const start = frame.current?.getBoundingClientRect().width ?? 0;
    const max = figure.current?.clientWidth ?? start;
    const step = (e.shiftKey ? 50 : 10) * (e.key === "ArrowRight" ? 1 : -1);
    const next = resizedWidth(start, side === "right" ? step : -step, side, align === "center" ? "left" : align, max);
    updateAttributes({ width: next >= max ? null : next });
  }

  function toggleCaption() {
    if (caption === null) {
      updateAttributes({ caption: "" });
      setFocusCaption(true);
    } else updateAttributes({ caption: null });
  }

  function comment() {
    const pos = getPos();
    if (typeof pos === "number") storage.onComment?.(pos);
  }

  function applyCrop(next: Crop | null) {
    setCropping(false);
    const shown = frame.current?.getBoundingClientRect().width ?? width ?? 0;
    const kept = next ? roundCrop(next) : null;
    updateAttributes({ crop: kept, width: shown ? widthAfterCrop(shown, crop, kept) : width });
  }

  function fullScreen() {
    const imgs = [...(editor.view.dom as HTMLElement).querySelectorAll<HTMLImageElement>("img[data-image-img]")].filter(
      (img) => img.closest(".ProseMirror") === editor.view.dom,
    );
    const own = frame.current?.querySelector("img");
    openImageViewer(
      imgs.map((img) => ({ src: img.currentSrc || img.src, alt: img.alt })),
      Math.max(0, own ? imgs.indexOf(own as HTMLImageElement) : 0),
    );
  }

  const frameStyle: CSSProperties = shownWidth ? { width: shownWidth } : {};
  const styles = crop ? cropStyles(crop) : null;
  // Comment and full screen are for everyone who can see the bar; the rest changes the page.
  const showBar = !!src && (editable || canComment);
  const showHandles = !!src && editable;

  const button =
    "flex items-center justify-center rounded text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-white";
  const size = touch ? "h-9 w-9" : "h-7 w-7";

  return (
    <NodeViewWrapper
      as="figure"
      ref={figure}
      className="image-block"
      data-image-block=""
      data-align={align}
      data-active={active || undefined}
      data-selected={selected || undefined}
      contentEditable={false}
    >
      <div className="image-inner" style={shownWidth ? { width: shownWidth } : undefined}>
        <div ref={frame} className={`image-frame ${activeThread ? "image-frame-commented" : ""}`} style={frameStyle}>
          {styles ? (
            <div className="image-crop" style={styles.box}>
              <img src={src} alt={alt} draggable={false} data-image-img="" style={styles.image} />
            </div>
          ) : (
            <img src={src} alt={alt} draggable={false} data-image-img="" style={shownWidth ? { width: "100%" } : undefined} />
          )}

          {showHandles &&
            (["left", "right"] as const).map((side) => (
              <div
                key={side}
                data-image-ui=""
                data-side={side}
                className="image-handle"
                role="slider"
                tabIndex={-1}
                aria-label={t("image.resize")}
                aria-valuenow={Math.round(shownWidth ?? frame.current?.getBoundingClientRect().width ?? 0)}
                onPointerDown={(e) => startResize(side, e)}
                onKeyDown={(e) => resizeByKey(side, e)}
              />
            ))}

          {showBar && (
            <div data-image-ui="" className="image-toolbar" role="toolbar" aria-label={t("image.toolbar")}>
              {editable && (
                <Tool className={`${button} ${size}`} label={t("image.align")} onClick={(e) => setMenu({ kind: "align", anchor: e.currentTarget })}>
                  {ALIGN_ICONS[align]}
                </Tool>
              )}
              {editable && (
                <Tool
                  className={`${button} ${size} ${caption !== null ? "text-blue-600 dark:text-blue-400" : ""}`}
                  label={caption === null ? t("image.addCaption") : t("image.removeCaption")}
                  pressed={caption !== null}
                  onClick={toggleCaption}
                >
                  <Captions size={16} />
                </Tool>
              )}
              {canComment && (
                <Tool className={`${button} ${size}`} label={t("image.comment")} onClick={comment} data-image-comment="">
                  <MessageSquarePlus size={16} />
                </Tool>
              )}
              {editable && (
                <Tool className={`${button} ${size}`} label={t("image.crop")} onClick={() => setCropping(true)} data-image-crop="">
                  <CropIcon size={16} />
                </Tool>
              )}
              <Tool className={`${button} ${size}`} label={t("image.fullScreen")} onClick={fullScreen}>
                <Maximize2 size={16} />
              </Tool>
              <Tool className={`${button} ${size}`} label={t("image.more")} onClick={(e) => setMenu({ kind: "more", anchor: e.currentTarget })}>
                <MoreHorizontal size={16} />
              </Tool>
            </div>
          )}

          {saved.length > 0 && (
            <button
              type="button"
              data-image-ui=""
              data-comment-thread={saved[0]!.commentThread}
              className="image-comments"
              aria-label={t("image.openComments")}
              title={t("image.openComments")}
              onClick={() => storage.openThread?.(saved[0]!.commentThread)}
            >
              <MessageSquare size={14} />
              {saved.length > 1 && <span>{saved.length}</span>}
            </button>
          )}
        </div>

        {caption !== null &&
          (editable ? (
            <textarea
              ref={captionRef}
              data-image-ui=""
              className="image-caption"
              rows={1}
              value={caption}
              placeholder={t("image.captionPlaceholder")}
              aria-label={t("image.caption")}
              onChange={(e) => updateAttributes({ caption: e.target.value.replace(/\n/g, " ") })}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") {
                  e.preventDefault();
                  e.currentTarget.blur();
                  editor.commands.focus();
                } else if (e.key === "Backspace" && !caption) {
                  e.preventDefault();
                  updateAttributes({ caption: null });
                  editor.commands.focus();
                }
              }}
            />
          ) : caption.trim() ? (
            <figcaption className="image-caption">{caption}</figcaption>
          ) : null)}
      </div>

      {menu?.kind === "align" && (
        <Popover anchor={menu.anchor} onClose={() => setMenu(null)} width={200}>
          {(["left", "center", "right"] as const).map((a) => (
            <MenuItem
              key={a}
              icon={ALIGN_ICONS[a]}
              label={ALIGN_LABELS[a]()}
              checked={a === align}
              onClick={() => {
                updateAttributes({ align: a === "left" ? null : a });
                setMenu(null);
              }}
            />
          ))}
        </Popover>
      )}
      {menu?.kind === "more" && (
        <Popover anchor={menu.anchor} onClose={() => setMenu(null)} width={220}>
          <a
            href={downloadUrl(src)}
            download
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setMenu(null)}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <Download size={16} /> {t("image.download")}
          </a>
          {editable && (width !== null || crop) && (
            <MenuItem
              icon={<RotateCcw size={16} />}
              label={t("image.reset")}
              onClick={() => {
                updateAttributes({ width: null, crop: null });
                setMenu(null);
              }}
            />
          )}
          {editable && (
            <>
              <div className="my-1 h-px bg-neutral-200 dark:bg-neutral-800" />
              <MenuItem
                icon={<Trash2 size={16} />}
                label={t("common.delete")}
                danger
                onClick={() => {
                  setMenu(null);
                  deleteNode();
                }}
              />
            </>
          )}
        </Popover>
      )}
      {cropping && <ImageCropDialog src={src} alt={alt} crop={crop} onCancel={() => setCropping(false)} onApply={applyCrop} />}
    </NodeViewWrapper>
  );
}

function Tool({
  label,
  className,
  onClick,
  pressed,
  children,
  ...rest
}: {
  label: string;
  className: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  pressed?: boolean;
  children: ReactNode;
} & Record<`data-${string}`, string>) {
  return (
    <button
      type="button"
      className={className}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      // Keeps the focus (and the selection) where it is.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  );
}

function MenuItem({ icon, label, onClick, checked, danger }: { icon: ReactNode; label: string; onClick: () => void; checked?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-checked={checked}
      role={checked === undefined ? undefined : "menuitemradio"}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 ${danger ? "text-red-600 dark:text-red-400" : ""} ${checked ? "font-medium" : ""}`}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {checked && <span className="text-blue-600 dark:text-blue-400">✓</span>}
    </button>
  );
}
