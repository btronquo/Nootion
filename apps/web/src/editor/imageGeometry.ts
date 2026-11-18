/**
 * The arithmetic of image blocks, kept apart from the components to be tested on its own: the width set with the
 * handles, and the crop (the part of the image shown, as fractions of the whole image, so it survives a resized file).
 */

/** The part of the image that is shown: fractions of its width (x, w) and height (y, h), and its own ratio (width / height). */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

export type ImageAlign = "left" | "center" | "right";

/** Narrower than this, an image can't be pointed at any more. */
export const MIN_IMAGE_WIDTH = 48;
/** The smallest part of an image a crop keeps, on each side. */
export const MIN_CROP = 0.05;

const EPSILON = 0.001;
const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export const FULL_CROP = (r: number): Crop => ({ x: 0, y: 0, w: 1, h: 1, r });

export function parseAlign(value: unknown): ImageAlign {
  return value === "center" || value === "right" ? value : "left";
}

/** A width kept in the page: a whole number of pixels, or none (the image's own size, as wide as the page at most). */
export function parseWidth(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return finite(n) && n >= MIN_IMAGE_WIDTH ? Math.round(n) : null;
}

/** A crop kept in the page (an object, or its JSON in HTML), checked: null when it is missing, invalid or the whole image. */
export function parseCrop(value: unknown): Crop | null {
  let v = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object") return null;
  const { x, y, w, h, r } = v as Record<string, unknown>;
  if (!finite(x) || !finite(y) || !finite(w) || !finite(h) || !finite(r) || r <= 0) return null;
  if (x < -EPSILON || y < -EPSILON || w < MIN_CROP - EPSILON || h < MIN_CROP - EPSILON || x + w > 1 + EPSILON || y + h > 1 + EPSILON) return null;
  const crop = { x: clamp(x, 0, 1), y: clamp(y, 0, 1), w: clamp(w, MIN_CROP, 1), h: clamp(h, MIN_CROP, 1), r };
  return isFullCrop(crop) ? null : crop;
}

export function isFullCrop(c: Crop): boolean {
  return c.x < EPSILON && c.y < EPSILON && c.w > 1 - EPSILON && c.h > 1 - EPSILON;
}

/** Rounded to 4 decimals, enough for any screen, shorter to keep. */
export function roundCrop(c: Crop): Crop {
  const round = (v: number) => Math.round(v * 10000) / 10000;
  return { x: round(c.x), y: round(c.y), w: round(c.w), h: round(c.h), r: round(c.r) };
}

/** How a cropped image is drawn: a box of the crop's ratio, and the whole image inside it, moved and enlarged. */
export function cropStyles(c: Crop): { box: { aspectRatio: string }; image: { width: string; height: string; left: string; top: string } } {
  const pct = (v: number) => `${Math.round(v * 1e6) / 1e4}%`;
  return {
    box: { aspectRatio: `${Math.round(c.r * c.w * 1e4) / 1e4} / ${Math.round(c.h * 1e4) / 1e4}` },
    image: { width: pct(1 / c.w), height: pct(1 / c.h), left: pct(-c.x / c.w), top: pct(-c.y / c.h) },
  };
}

/**
 * The width of an image while one of its handles is dragged `dx` pixels: a centred image grows on both sides, so it
 * grows twice as fast. Kept between the smallest width and the width of the page.
 */
export function resizedWidth(start: number, dx: number, side: "left" | "right", align: ImageAlign, max: number): number {
  const grow = (side === "right" ? dx : -dx) * (align === "center" ? 2 : 1);
  return Math.round(clamp(start + grow, MIN_IMAGE_WIDTH, Math.max(MIN_IMAGE_WIDTH, max)));
}

/** The width that keeps the image at the same scale once its crop changes (it shows more or less of the image). */
export function widthAfterCrop(shownWidth: number, before: Crop | null, after: Crop | null): number {
  const from = before?.w ?? 1;
  const to = after?.w ?? 1;
  return Math.max(MIN_IMAGE_WIDTH, Math.round((shownWidth / from) * to));
}

export type CropHandle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/**
 * The crop while a handle is dragged by (dx, dy), as fractions of the image's size. `ratio` (width / height on screen)
 * keeps the shape when it is locked: then only the corners resize it, from the opposite corner.
 */
export function dragCrop(start: Crop, handle: CropHandle, dx: number, dy: number, ratio: number | null = null): Crop {
  const { x, y, w, h, r } = start;
  if (handle === "move") return { ...start, x: clamp(x + dx, 0, 1 - w), y: clamp(y + dy, 0, 1 - h) };
  const sx = handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0;
  const sy = handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0;
  // The edges that stay where they are.
  const anchorX = sx > 0 ? x : x + w;
  const anchorY = sy > 0 ? y : y + h;
  const roomX = sx > 0 ? 1 - x : x + w;
  const roomY = sy > 0 ? 1 - y : y + h;
  let nw = sx ? clamp(w + sx * dx, MIN_CROP, roomX) : w;
  let nh = sy ? clamp(h + sy * dy, MIN_CROP, roomY) : h;
  if (ratio && sx && sy) {
    // Height as a fraction of the image for a given width fraction, at the locked shape.
    const k = r / ratio;
    nw = clamp(nw, Math.max(MIN_CROP, MIN_CROP / k), Math.min(roomX, roomY / k));
    nh = nw * k;
  }
  return { x: sx > 0 ? anchorX : sx < 0 ? anchorX - nw : x, y: sy > 0 ? anchorY : sy < 0 ? anchorY - nh : y, w: nw, h: nh, r };
}

/** The largest crop of the given shape (width / height on screen) inside the current one, centred on it. */
export function fitRatio(c: Crop, ratio: number): Crop {
  const k = c.r / ratio;
  let w = c.w;
  let h = w * k;
  if (h > c.h) {
    h = c.h;
    w = h / k;
  }
  return { ...c, x: c.x + (c.w - w) / 2, y: c.y + (c.h - h) / 2, w, h };
}
