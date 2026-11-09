import { OPTION_COLORS } from "./databases.js";

/**
 * Drawing block: freehand strokes and simple shapes, stored in the block itself.
 *
 * Coordinates are "world" units. The frame shown in the page is DRAWING_WIDTH units wide (it is scaled to the
 * width of the page, so a drawing looks the same on a phone and on a computer) and `height` units high.
 * In full screen the canvas has no edges: strokes outside the frame widen what the page shows.
 */
export const DRAWING_WIDTH = 1000;
export const DRAWING_DEFAULT_HEIGHT = 400;
export const DRAWING_MIN_HEIGHT = 120;
export const DRAWING_MAX_HEIGHT = 3000;

export const DRAWING_TOOLS = ["pen", "highlighter", "line", "arrow", "rect", "ellipse"] as const;
export type DrawingTool = (typeof DRAWING_TOOLS)[number];

/** "default" is the text colour: black in light mode, white in dark mode. */
export const DRAWING_COLORS = ["default", ...OPTION_COLORS] as const;
export type DrawingColor = (typeof DRAWING_COLORS)[number];

export const DRAWING_SIZES = [2, 4, 8, 16] as const;

/** Colours used outside the app (exported SVG, Markdown): those of the light theme. */
export const DRAWING_LIGHT_COLORS: Record<DrawingColor, string> = {
  default: "#37352f",
  gray: "#787774",
  brown: "#9f6b53",
  orange: "#d9730d",
  yellow: "#cb912f",
  green: "#448361",
  blue: "#337ea9",
  purple: "#9065b0",
  pink: "#c14c8a",
  red: "#d44c47",
};

export interface DrawingStroke {
  id: string;
  tool: DrawingTool;
  color: DrawingColor;
  size: number;
  /** Flat list x0, y0, x1, y1… A shape has two points: where it was started and where it ended. */
  points: number[];
}

const MAX_STROKES = 5000;
const MAX_POINTS = 20_000;
const round = (n: number) => Math.round(n * 10) / 10;

/** Strokes of a drawing block, as stored in its node: anything that doesn't parse is left out. */
export function drawingStrokes(raw: unknown): DrawingStroke[] {
  if (!Array.isArray(raw)) return [];
  const out: DrawingStroke[] = [];
  for (const s of raw.slice(0, MAX_STROKES)) {
    if (!s || typeof s !== "object") continue;
    const v = s as Record<string, unknown>;
    const tool = DRAWING_TOOLS.find((x) => x === v.tool);
    if (!tool || !Array.isArray(v.points)) continue;
    const points = v.points.slice(0, MAX_POINTS * 2).map(Number);
    if (points.length < 2 || points.length % 2 || points.some((n) => !Number.isFinite(n))) continue;
    out.push({
      id: typeof v.id === "string" && v.id ? v.id.slice(0, 64) : `s${out.length}`,
      tool,
      color: DRAWING_COLORS.find((x) => x === v.color) ?? "default",
      size: Math.min(64, Math.max(1, Number(v.size) || 4)),
      points: points.map(round),
    });
  }
  return out;
}

export function drawingHeight(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(DRAWING_MAX_HEIGHT, Math.max(DRAWING_MIN_HEIGHT, Math.round(n))) : DRAWING_DEFAULT_HEIGHT;
}

/** Width of the line actually drawn: a highlighter is wider, and see-through. */
export const strokeWidth = (s: DrawingStroke) => (s.tool === "highlighter" ? s.size * 3 : s.size);
export const strokeOpacity = (s: DrawingStroke) => (s.tool === "highlighter" ? 0.35 : 1);

const f = (n: number) => String(round(n));

/** SVG path of a stroke. */
export function strokePath(s: DrawingStroke): string {
  const p = s.points;
  const n = p.length / 2;
  const x = (i: number) => p[i * 2]!;
  const y = (i: number) => p[i * 2 + 1]!;
  const last = n - 1;
  switch (s.tool) {
    case "line":
      return `M${f(x(0))} ${f(y(0))}L${f(x(last))} ${f(y(last))}`;
    case "arrow": {
      const [x0, y0, x1, y1] = [x(0), y(0), x(last), y(last)];
      const angle = Math.atan2(y1 - y0, x1 - x0);
      const head = Math.min(Math.hypot(x1 - x0, y1 - y0) * 0.5, Math.max(12, s.size * 4));
      const a = (d: number) => `${f(x1 - head * Math.cos(angle + d))} ${f(y1 - head * Math.sin(angle + d))}`;
      return `M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}M${a(0.45)}L${f(x1)} ${f(y1)}L${a(-0.45)}`;
    }
    case "rect": {
      const [x0, y0, x1, y1] = [Math.min(x(0), x(last)), Math.min(y(0), y(last)), Math.max(x(0), x(last)), Math.max(y(0), y(last))];
      return `M${f(x0)} ${f(y0)}H${f(x1)}V${f(y1)}H${f(x0)}Z`;
    }
    case "ellipse": {
      const [cx, cy] = [(x(0) + x(last)) / 2, (y(0) + y(last)) / 2];
      const [rx, ry] = [Math.abs(x(last) - x(0)) / 2, Math.abs(y(last) - y(0)) / 2];
      if (!rx || !ry) return `M${f(x(0))} ${f(y(0))}L${f(x(last))} ${f(y(last))}`;
      return `M${f(cx - rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx + rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx - rx)} ${f(cy)}Z`;
    }
    default: {
      // Freehand: a smooth curve through the middles of the segments.
      if (n === 1) return `M${f(x(0))} ${f(y(0))}l0.01 0`;
      if (n === 2) return `M${f(x(0))} ${f(y(0))}L${f(x(1))} ${f(y(1))}`;
      let d = `M${f(x(0))} ${f(y(0))}`;
      for (let i = 1; i < last; i++) d += `Q${f(x(i))} ${f(y(i))} ${f((x(i) + x(i + 1)) / 2)} ${f((y(i) + y(i + 1)) / 2)}`;
      return `${d}L${f(x(last))} ${f(y(last))}`;
    }
  }
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Box around all strokes (with their thickness), or null when there are none. */
export function drawingBounds(strokes: DrawingStroke[]): Box | null {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const s of strokes) {
    const pad = strokeWidth(s) / 2 + (s.tool === "arrow" ? Math.max(12, s.size * 4) : 0);
    for (let i = 0; i < s.points.length; i += 2) {
      x0 = Math.min(x0, s.points[i]! - pad);
      x1 = Math.max(x1, s.points[i]! + pad);
      y0 = Math.min(y0, s.points[i + 1]! - pad);
      y1 = Math.max(y1, s.points[i + 1]! + pad);
    }
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** What the page shows: the frame, widened so that no stroke is cut. */
export function drawingViewBox(strokes: DrawingStroke[], height: number): Box {
  const b = drawingBounds(strokes);
  if (!b) return { x: 0, y: 0, w: DRAWING_WIDTH, h: height };
  const x = Math.min(0, b.x);
  const y = Math.min(0, b.y);
  return { x, y, w: Math.max(DRAWING_WIDTH, b.x + b.w) - x, h: Math.max(height, b.y + b.h) - y };
}

/** Distance from a point to a stroke's line, to find what the eraser or the selection touches. */
export function distanceToStroke(s: DrawingStroke, px: number, py: number): number {
  const p = s.points;
  const seg = (ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };
  const [x0, y0, x1, y1] = [p[0]!, p[1]!, p[p.length - 2]!, p[p.length - 1]!];
  if (s.tool === "rect") {
    const [l, t, r, b] = [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
    return Math.min(seg(l, t, r, t), seg(r, t, r, b), seg(r, b, l, b), seg(l, b, l, t));
  }
  if (s.tool === "ellipse") {
    const [cx, cy, rx, ry] = [(x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2];
    let best = Infinity;
    for (let i = 0; i < 48; i++) {
      const [a, b] = [(i / 48) * Math.PI * 2, ((i + 1) / 48) * Math.PI * 2];
      best = Math.min(best, seg(cx + rx * Math.cos(a), cy + ry * Math.sin(a), cx + rx * Math.cos(b), cy + ry * Math.sin(b)));
    }
    return best;
  }
  if (s.tool === "line" || s.tool === "arrow") return seg(x0, y0, x1, y1);
  if (p.length === 2) return Math.hypot(px - x0, py - y0);
  let best = Infinity;
  for (let i = 0; i + 3 < p.length; i += 2) best = Math.min(best, seg(p[i]!, p[i + 1]!, p[i + 2]!, p[i + 3]!));
  return best;
}

/** Fewer points for the same line (Ramer-Douglas-Peucker), so that drawings stay small. */
export function simplifyPoints(points: number[], tolerance = 0.6): number[] {
  const n = points.length / 2;
  if (n <= 2) return points;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay, bx, by] = [points[a * 2]!, points[a * 2 + 1]!, points[b * 2]!, points[b * 2 + 1]!];
    const len = Math.hypot(bx - ax, by - ay);
    let [far, index] = [0, -1];
    for (let i = a + 1; i < b; i++) {
      const [x, y] = [points[i * 2]!, points[i * 2 + 1]!];
      const d = len ? Math.abs((by - ay) * x - (bx - ax) * y + bx * ay - by * ax) / len : Math.hypot(x - ax, y - ay);
      if (d > far) [far, index] = [d, i];
    }
    if (far > tolerance && index > 0) {
      keep[index] = 1;
      stack.push([a, index], [index, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(round(points[i * 2]!), round(points[i * 2 + 1]!));
  return out;
}

/** A standalone SVG of the drawing (light colours, white background), for downloads and the Markdown export. */
export function drawingToSvg(rawStrokes: unknown, rawHeight: unknown): string {
  const strokes = drawingStrokes(rawStrokes);
  const box = drawingViewBox(strokes, drawingHeight(rawHeight));
  const paths = strokes
    .map(
      (s) =>
        `<path d="${strokePath(s)}" fill="none" stroke="${DRAWING_LIGHT_COLORS[s.color]}" stroke-width="${strokeWidth(s)}"` +
        ` stroke-linecap="round" stroke-linejoin="round"${strokeOpacity(s) < 1 ? ` stroke-opacity="${strokeOpacity(s)}"` : ""}/>`,
    )
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(box.x)} ${f(box.y)} ${f(box.w)} ${f(box.h)}" width="${Math.round(box.w)}" height="${Math.round(box.h)}">` +
    `<rect x="${f(box.x)}" y="${f(box.y)}" width="${f(box.w)}" height="${f(box.h)}" fill="#ffffff"/>${paths}</svg>`
  );
}
