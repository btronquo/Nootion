import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
  Circle,
  Download,
  Eraser,
  Hand,
  Highlighter,
  Maximize2,
  MousePointer2,
  MoveUpRight,
  Pen,
  Redo2,
  Scan,
  Slash,
  Square,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  DRAWING_COLORS,
  DRAWING_MAX_HEIGHT,
  DRAWING_MIN_HEIGHT,
  DRAWING_SIZES,
  distanceToStroke,
  drawingBounds,
  drawingHeight,
  drawingStrokes,
  drawingToSvg,
  drawingViewBox,
  simplifyPoints,
  strokeOpacity,
  strokePath,
  strokeWidth,
  t,
  type Box,
  type DrawingColor,
  type DrawingStroke,
  type DrawingTool,
} from "@nootion/shared";
import { randomId } from "../lib/browser";

type Tool = DrawingTool | "eraser" | "select" | "hand";
/** A change to the drawing: strokes taken out, strokes put in (a moved stroke is both, with the same id). */
interface Op {
  added: DrawingStroke[];
  removed: DrawingStroke[];
}

const SHAPES: DrawingTool[] = ["line", "arrow", "rect", "ellipse"];
const colorOf = (c: DrawingColor) => (c === "default" ? "currentColor" : `var(--nt-${c})`);

/** Applies a change to the current strokes. */
function applyOp(strokes: DrawingStroke[], op: Op): DrawingStroke[] {
  const added = new Map(op.added.map((s) => [s.id, s]));
  const removed = new Set(op.removed.map((s) => s.id));
  const out = strokes.filter((s) => added.has(s.id) || !removed.has(s.id)).map((s) => added.get(s.id) ?? s);
  const present = new Set(out.map((s) => s.id));
  return [...out, ...op.added.filter((s) => !present.has(s.id))];
}

/** The strokes, drawn once: only the stroke being drawn changes while the pointer moves. */
const Strokes = memo(function Strokes({ strokes, hidden }: { strokes: DrawingStroke[]; hidden?: Set<string> }) {
  return (
    <>
      {strokes.map((s) =>
        hidden?.has(s.id) ? null : (
          <path
            key={s.id}
            d={strokePath(s)}
            fill="none"
            stroke={colorOf(s.color)}
            strokeWidth={strokeWidth(s)}
            strokeOpacity={strokeOpacity(s)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ),
      )}
    </>
  );
});

interface Board {
  strokes: DrawingStroke[];
  height: number;
  editable: boolean;
  tool: Tool;
  setTool: (t: Tool) => void;
  color: DrawingColor;
  setColor: (c: DrawingColor) => void;
  size: number;
  setSize: (n: number) => void;
  selected: string | null;
  setSelected: (id: string | null) => void;
  apply: (op: Op) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

/** A drawing in a page: freehand strokes and shapes, with a full-screen whiteboard. */
export function DrawingBlockView({ node, updateAttributes, editor }: NodeViewProps) {
  const strokes = useMemo(() => drawingStrokes(node.attrs.strokes), [node.attrs.strokes]);
  const height = drawingHeight(node.attrs.height);
  const editable = editor.isEditable;
  const [full, setFull] = useState(false);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState<DrawingColor>("default");
  const [size, setSize] = useState<number>(4);
  const [selected, setSelected] = useState<string | null>(null);
  // Undo and redo only take back this person's own changes, even when someone else draws at the same time.
  const [history, setHistory] = useState<{ done: Op[]; undone: Op[] }>({ done: [], undone: [] });
  const latest = useRef(strokes);
  latest.current = strokes;

  const write = useCallback((op: Op) => updateAttributes({ strokes: applyOp(latest.current, op) }), [updateAttributes]);
  const apply = useCallback(
    (op: Op) => {
      if (!op.added.length && !op.removed.length) return;
      write(op);
      setHistory((h) => ({ done: [...h.done.slice(-99), op], undone: [] }));
    },
    [write],
  );
  // Changes are written outside of state updates: writing to the document re-renders the editor.
  const historyRef = useRef(history);
  historyRef.current = history;
  const undo = useCallback(() => {
    const h = historyRef.current;
    const op = h.done.at(-1);
    if (!op) return;
    write({ added: op.removed, removed: op.added });
    setHistory({ done: h.done.slice(0, -1), undone: [...h.undone, op] });
    setSelected(null);
  }, [write]);
  const redo = useCallback(() => {
    const h = historyRef.current;
    const op = h.undone.at(-1);
    if (!op) return;
    write(op);
    setHistory({ done: [...h.done, op], undone: h.undone.slice(0, -1) });
  }, [write]);

  useEffect(() => {
    if (selected && !strokes.some((s) => s.id === selected)) setSelected(null);
  }, [strokes, selected]);

  const board: Board = {
    strokes,
    height,
    editable,
    tool,
    setTool: (next) => {
      setTool(next);
      if (next !== "select") setSelected(null);
    },
    color,
    setColor: (c) => {
      setColor(c);
      const s = strokes.find((x) => x.id === selected);
      if (s) apply({ added: [{ ...s, color: c }], removed: [s] });
    },
    size,
    setSize: (n) => {
      setSize(n);
      const s = strokes.find((x) => x.id === selected);
      if (s) apply({ added: [{ ...s, size: n }], removed: [s] });
    },
    selected,
    setSelected,
    apply,
    undo,
    redo,
    canUndo: history.done.length > 0,
    canRedo: history.undone.length > 0,
  };

  const download = () => {
    const blob = new Blob([drawingToSvg(strokes, height)], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${t("drawing.title")}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <NodeViewWrapper className="drawing-block group/drawing my-2" contentEditable={false} data-drawing="">
      <div className="overflow-hidden rounded-lg border border-neutral-200 text-neutral-800 dark:border-neutral-800 dark:text-neutral-100">
        <Toolbar board={board} onDownload={download} onFull={() => setFull(true)} />
        <Canvas board={board} mode="inline" onHeight={(h) => updateAttributes({ height: h })} onOpenFull={() => setFull(true)} />
      </div>
      {full &&
        createPortal(
          <div className="fixed inset-0 z-50 flex flex-col bg-white text-neutral-800 dark:bg-neutral-950 dark:text-neutral-100" role="dialog" aria-label={t("drawing.title")}>
            <Toolbar board={board} full onDownload={download} onClose={() => setFull(false)} />
            <Canvas board={board} mode="full" onClose={() => setFull(false)} />
          </div>,
          document.body,
        )}
    </NodeViewWrapper>
  );
}

const btn =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-30 disabled:hover:bg-transparent dark:hover:bg-neutral-800 dark:hover:text-neutral-200";
const active = "bg-blue-50 !text-blue-600 dark:bg-blue-950 dark:!text-blue-400";

function ToolButton({ label, on, onClick, children, disabled }: { label: string; on?: boolean; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" className={`${btn} ${on ? active : ""}`} title={label} aria-label={label} aria-pressed={on} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

const Sep = () => <span className="mx-0.5 h-5 w-px shrink-0 bg-neutral-200 dark:bg-neutral-800" />;

function Toolbar({
  board: b,
  full,
  onDownload,
  onFull,
  onClose,
}: {
  board: Board;
  full?: boolean;
  onDownload: () => void;
  onFull?: () => void;
  onClose?: () => void;
}) {
  const [panel, setPanel] = useState(false);
  const tools: [Tool, string, ReactNode][] = [
    ["pen", t("drawing.pen"), <Pen size={16} />],
    ["highlighter", t("drawing.highlighter"), <Highlighter size={16} />],
    ["line", t("drawing.line"), <Slash size={16} />],
    ["arrow", t("drawing.arrow"), <MoveUpRight size={16} />],
    ["rect", t("drawing.rect"), <Square size={16} />],
    ["ellipse", t("drawing.ellipse"), <Circle size={16} />],
    ["eraser", t("drawing.eraser"), <Eraser size={16} />],
    ["select", t("drawing.select"), <MousePointer2 size={16} />],
  ];
  if (full) tools.push(["hand", t("drawing.hand"), <Hand size={16} />]);
  const showStyle = b.editable && (b.tool === "pen" || b.tool === "highlighter" || SHAPES.includes(b.tool as DrawingTool) || !!b.selected);

  return (
    <div
      className={`relative flex items-center gap-0.5 border-b border-neutral-200 px-1 py-1 dark:border-neutral-800 ${full ? "pt-[max(0.25rem,env(safe-area-inset-top))]" : ""}`}
      onKeyDown={(e) => e.key === "Escape" && panel && (e.stopPropagation(), setPanel(false))}
    >
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
        {b.editable && (
          <>
            {tools.map(([id, label, icon]) => (
              <ToolButton key={id} label={label} on={b.tool === id} onClick={() => b.setTool(id)}>
                {icon}
              </ToolButton>
            ))}
            {showStyle && (
              <button
                type="button"
                className={`${btn} ${panel ? active : ""}`}
                title={`${t("block.color")} · ${t("drawing.size")}`}
                aria-label={`${t("block.color")} · ${t("drawing.size")}`}
                aria-expanded={panel}
                onClick={() => setPanel((p) => !p)}
              >
                <span className="h-4 w-4 rounded-full border border-neutral-300 dark:border-neutral-600" style={{ background: colorOf(b.color) }} />
              </button>
            )}
            <Sep />
            <ToolButton label={t("drawing.undo")} onClick={b.undo} disabled={!b.canUndo}>
              <Undo2 size={16} />
            </ToolButton>
            <ToolButton label={t("drawing.redo")} onClick={b.redo} disabled={!b.canRedo}>
              <Redo2 size={16} />
            </ToolButton>
            {b.selected ? (
              <ToolButton
                label={t("drawing.deleteSelection")}
                onClick={() => {
                  const s = b.strokes.find((x) => x.id === b.selected);
                  if (s) b.apply({ added: [], removed: [s] });
                  b.setSelected(null);
                }}
              >
                <Trash2 size={16} />
              </ToolButton>
            ) : (
              <ToolButton
                label={t("drawing.clear")}
                disabled={!b.strokes.length}
                onClick={() => window.confirm(t("drawing.clearConfirm")) && b.apply({ added: [], removed: b.strokes })}
              >
                <Trash2 size={16} />
              </ToolButton>
            )}
          </>
        )}
        {!b.editable && full && <span className="px-2 text-sm font-medium text-neutral-500">{t("drawing.title")}</span>}
      </div>
      <ToolButton label={t("drawing.download")} onClick={onDownload} disabled={!b.strokes.length}>
        <Download size={16} />
      </ToolButton>
      {full ? (
        <ToolButton label={t("drawing.exitFullscreen")} onClick={() => onClose?.()}>
          <X size={18} />
        </ToolButton>
      ) : (
        <ToolButton label={t("drawing.fullscreen")} onClick={() => onFull?.()}>
          <Maximize2 size={16} />
        </ToolButton>
      )}
      {panel && showStyle && (
        <div className="absolute top-full left-1 z-10 mt-1 w-56 rounded-lg border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          <div className="grid grid-cols-5 gap-1">
            {DRAWING_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                title={c === "default" ? t("block.defaultColor") : t(`color.${c}`)}
                aria-label={c === "default" ? t("block.defaultColor") : t(`color.${c}`)}
                aria-pressed={b.color === c}
                onClick={() => b.setColor(c)}
                className={`flex h-8 items-center justify-center rounded ${b.color === c ? "ring-2 ring-blue-500" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
              >
                <span className="h-5 w-5 rounded-full" style={{ background: colorOf(c) }} />
              </button>
            ))}
          </div>
          <div className="mt-2 mb-1 text-xs text-neutral-500">{t("drawing.size")}</div>
          <div className="flex gap-1">
            {DRAWING_SIZES.map((n) => (
              <button
                key={n}
                type="button"
                title={`${t("drawing.size")} ${n}`}
                aria-label={`${t("drawing.size")} ${n}`}
                aria-pressed={b.size === n}
                onClick={() => b.setSize(n)}
                className={`flex h-8 flex-1 items-center justify-center rounded ${b.size === n ? "ring-2 ring-blue-500" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
              >
                <span className="rounded-full bg-current" style={{ width: Math.min(18, n + 2), height: Math.min(18, n + 2) }} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Where the full-screen view looks: top-left corner and zoom, in drawing units. */
interface View {
  x: number;
  y: number;
  zoom: number;
}

type Gesture =
  | { kind: "draw"; stroke: DrawingStroke }
  | { kind: "erase"; ids: Set<string> }
  | { kind: "move"; stroke: DrawingStroke; from: [number, number]; dx: number; dy: number }
  | { kind: "pan"; from: [number, number]; view: View }
  | { kind: "pinch"; start: { dist: number; mid: [number, number]; view: View } }
  | { kind: "resize"; fromY: number; height: number; scale: number };

function fitView(box: Box, w: number, h: number): View {
  const pad = 40;
  const zoom = Math.min(4, Math.max(0.05, Math.min((w - pad * 2) / box.w, (h - pad * 2) / box.h)));
  return { zoom, x: box.x + box.w / 2 - w / zoom / 2, y: box.y + box.h / 2 - h / zoom / 2 };
}

function Canvas({
  board: b,
  mode,
  onHeight,
  onOpenFull,
  onClose,
}: {
  board: Board;
  mode: "inline" | "full";
  onHeight?: (h: number) => void;
  onOpenFull?: () => void;
  onClose?: () => void;
}) {
  const full = mode === "full";
  const svg = useRef<SVGSVGElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, [number, number]>());
  const [space, setSpace] = useState(false);
  const [screen, setScreen] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);
  const [resizing, setResizing] = useState<number | null>(null);
  const coarse = useMemo(() => window.matchMedia?.("(pointer: coarse)").matches ?? false, []);

  const set = (g: Gesture | null) => {
    gestureRef.current = g;
    setGesture(g);
  };

  const height = resizing ?? b.height;
  const inlineBox = useMemo(() => drawingViewBox(b.strokes, height), [b.strokes, height]);

  // Full screen: the canvas fills the window; it opens showing the whole drawing.
  useLayoutEffect(() => {
    if (!full || !wrap.current) return;
    const el = wrap.current;
    const measure = () => setScreen({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [full]);
  useEffect(() => {
    if (full && screen.w && !view) setView(fitView(drawingViewBox(b.strokes, b.height), screen.w, screen.h));
  }, [full, screen, view, b.strokes, b.height]);

  const zoomAt = useCallback(
    (factor: number, cx: number, cy: number) =>
      setView((v) => {
        if (!v) return v;
        const zoom = Math.min(8, Math.max(0.05, v.zoom * factor));
        // The point under (cx, cy) on screen stays there.
        return { zoom, x: v.x + cx / v.zoom - cx / zoom, y: v.y + cy / v.zoom - cy / zoom };
      }),
    [],
  );

  // Wheel: scrolls the canvas, or zooms with Ctrl (and with a trackpad pinch, which browsers send as Ctrl + wheel).
  useEffect(() => {
    const el = svg.current;
    if (!full || !el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-Math.max(-25, Math.min(25, e.deltaY)) * 0.01), e.clientX - r.left, e.clientY - r.top);
      else setView((v) => v && { ...v, x: v.x + e.deltaX / v.zoom, y: v.y + e.deltaY / v.zoom });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [full, zoomAt, view === null]);

  const deleteSelected = useCallback(() => {
    const s = b.strokes.find((x) => x.id === b.selected);
    if (s) b.apply({ added: [], removed: [s] });
    b.setSelected(null);
  }, [b]);

  // Keyboard: in full screen it applies everywhere; in the page, once the drawing has been clicked.
  const onKey = useCallback(
    (e: KeyboardEvent | React.KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) b.redo();
        else b.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        b.redo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && b.selected) {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === "Escape") {
        if (b.selected) b.setSelected(null);
        else onClose?.();
      } else return false;
      e.stopPropagation();
      return true;
    },
    [b, deleteSelected, onClose],
  );
  useEffect(() => {
    if (!full) return;
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea")) return;
      if (e.key === " ") {
        e.preventDefault();
        setSpace(true);
        return;
      }
      if (b.editable) onKey(e);
      else if (e.key === "Escape") onClose?.();
    };
    const up = (e: KeyboardEvent) => e.key === " " && setSpace(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [full, onKey, onClose, b.editable]);

  /** Pointer position in drawing units. */
  const toWorld = (e: { clientX: number; clientY: number }): [number, number] => {
    const m = svg.current?.getScreenCTM();
    if (!m) return [0, 0];
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    if (full) return [p.x, p.y];
    // In the page, strokes stay inside what is shown: drawing past it would rescale everything.
    return [Math.min(inlineBox.x + inlineBox.w, Math.max(inlineBox.x, p.x)), Math.min(inlineBox.y + inlineBox.h, Math.max(inlineBox.y, p.y))];
  };
  /** Size of a screen pixel in drawing units. */
  const unit = () => {
    const m = svg.current?.getScreenCTM();
    return m ? 1 / m.a : 1;
  };

  const hit = (x: number, y: number, radius: number) => {
    for (let i = b.strokes.length - 1; i >= 0; i--) {
      const s = b.strokes[i]!;
      if (distanceToStroke(s, x, y) <= radius + strokeWidth(s) / 2) return s;
    }
    return null;
  };

  const startPinch = () => {
    const [p1, p2] = [...pointers.current.values()];
    if (!p1 || !p2 || !view) return;
    const r = svg.current!.getBoundingClientRect();
    set({ kind: "pinch", start: { dist: Math.hypot(p1[0] - p2[0], p1[1] - p2[1]), mid: [(p1[0] + p2[0]) / 2 - r.left, (p1[1] + p2[1]) / 2 - r.top], view } });
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    // In the page, a finger scrolls it (drawing with a finger happens on the whiteboard).
    if (!full && e.pointerType === "touch") return;
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    wrap.current?.focus({ preventScroll: true });
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (full && pointers.current.size === 2 && e.pointerType === "touch") return startPinch();
    if (pointers.current.size > 1) return;
    const [x, y] = toWorld(e);
    if (full && view && (e.button === 1 || space || b.tool === "hand" || !b.editable)) return set({ kind: "pan", from: [e.clientX, e.clientY], view });
    if (!b.editable) return;
    if (b.tool === "eraser") {
      const s = hit(x, y, 6 * unit());
      return set({ kind: "erase", ids: new Set(s ? [s.id] : []) });
    }
    if (b.tool === "select") {
      const s = hit(x, y, 8 * unit());
      b.setSelected(s?.id ?? null);
      return set(s ? { kind: "move", stroke: s, from: [x, y], dx: 0, dy: 0 } : null);
    }
    const tool = b.tool as DrawingTool;
    const freehand = tool === "pen" || tool === "highlighter";
    set({ kind: "draw", stroke: { id: randomId(), tool, color: b.color, size: b.size, points: freehand ? [x, y] : [x, y, x, y] } });
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    const g = gestureRef.current;
    if (!g) return;
    if (g.kind === "pinch") {
      const [p1, p2] = [...pointers.current.values()];
      if (!p1 || !p2) return;
      const r = svg.current!.getBoundingClientRect();
      const mid: [number, number] = [(p1[0] + p2[0]) / 2 - r.left, (p1[1] + p2[1]) / 2 - r.top];
      const { dist, mid: m0, view: v0 } = g.start;
      const zoom = Math.min(8, Math.max(0.05, v0.zoom * (Math.hypot(p1[0] - p2[0], p1[1] - p2[1]) / dist)));
      // The drawing point that was under the fingers' middle stays under it.
      setView({ zoom, x: v0.x + m0[0] / v0.zoom - mid[0] / zoom, y: v0.y + m0[1] / v0.zoom - mid[1] / zoom });
      return;
    }
    if (g.kind === "pan") {
      setView({ ...g.view, x: g.view.x - (e.clientX - g.from[0]) / g.view.zoom, y: g.view.y - (e.clientY - g.from[1]) / g.view.zoom });
      return;
    }
    const [x, y] = toWorld(e);
    if (g.kind === "erase") {
      const s = hit(x, y, 6 * unit());
      if (s && !g.ids.has(s.id)) set({ kind: "erase", ids: new Set([...g.ids, s.id]) });
    } else if (g.kind === "move") {
      set({ ...g, dx: x - g.from[0], dy: y - g.from[1] });
    } else if (g.kind === "draw") {
      const p = g.stroke.points;
      if (g.stroke.tool === "pen" || g.stroke.tool === "highlighter") {
        // Points closer than a pixel add nothing.
        const events = "getCoalescedEvents" in e.nativeEvent ? e.nativeEvent.getCoalescedEvents() : [];
        const next = [...p];
        for (const ev of events.length ? events : [e]) {
          const [cx, cy] = toWorld(ev);
          if (Math.hypot(cx - next[next.length - 2]!, cy - next[next.length - 1]!) >= unit()) next.push(cx, cy);
        }
        if (next.length !== p.length) set({ kind: "draw", stroke: { ...g.stroke, points: next } });
      } else {
        let [ex, ey] = [x, y];
        // Shift keeps lines straight (every 45°) and shapes square or round.
        if (e.shiftKey) {
          const [dx, dy] = [x - p[0]!, y - p[1]!];
          if (g.stroke.tool === "rect" || g.stroke.tool === "ellipse") {
            const d = Math.max(Math.abs(dx), Math.abs(dy));
            [ex, ey] = [p[0]! + Math.sign(dx || 1) * d, p[1]! + Math.sign(dy || 1) * d];
          } else {
            const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
            const len = Math.hypot(dx, dy);
            [ex, ey] = [p[0]! + Math.cos(a) * len, p[1]! + Math.sin(a) * len];
          }
        }
        set({ kind: "draw", stroke: { ...g.stroke, points: [p[0]!, p[1]!, ex, ey] } });
      }
    }
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    const g = gestureRef.current;
    if (g?.kind === "pinch") {
      // One finger left: back to moving around with it, nothing is drawn.
      const rest = [...pointers.current.values()][0];
      set(rest && view ? { kind: "pan", from: rest, view } : null);
      return;
    }
    if (pointers.current.size) return;
    set(null);
    if (!g || e.type === "pointercancel") return;
    if (g.kind === "erase") {
      b.apply({ added: [], removed: b.strokes.filter((s) => g.ids.has(s.id)) });
    } else if (g.kind === "move") {
      if (g.dx || g.dy) b.apply({ added: [{ ...g.stroke, points: g.stroke.points.map((n, i) => n + (i % 2 ? g.dy : g.dx)) }], removed: [g.stroke] });
    } else if (g.kind === "draw") {
      const s = g.stroke;
      if (s.tool === "pen" || s.tool === "highlighter") {
        // A click (a single point) makes a dot.
        b.apply({ added: [{ ...s, points: simplifyPoints(s.points, unit() * 0.5) }], removed: [] });
      } else {
        const [x0, y0, x1, y1] = s.points as [number, number, number, number];
        if (Math.hypot(x1 - x0, y1 - y0) >= 3 * unit()) b.apply({ added: [{ ...s, points: s.points.map((n) => Math.round(n * 10) / 10) }], removed: [] });
      }
    }
  };

  // The bottom edge of the drawing changes its height in the page.
  const onResizeDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const scale = inlineBox.w / (svg.current?.clientWidth || 1);
    set({ kind: "resize", fromY: e.clientY, height: b.height, scale });
    setResizing(b.height);
  };
  const onResizeMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (g?.kind !== "resize") return;
    setResizing(Math.round(Math.min(DRAWING_MAX_HEIGHT, Math.max(DRAWING_MIN_HEIGHT, g.height + (e.clientY - g.fromY) * g.scale))));
  };
  const onResizeUp = () => {
    if (gestureRef.current?.kind === "resize" && resizing !== null && resizing !== b.height) onHeight?.(resizing);
    set(null);
    setResizing(null);
  };

  const box: Box = full ? (view && screen.w ? { x: view.x, y: view.y, w: screen.w / view.zoom, h: screen.h / view.zoom } : { x: 0, y: 0, w: 1000, h: 600 }) : inlineBox;
  const hidden = useMemo(() => {
    if (gesture?.kind === "erase") return gesture.ids;
    if (gesture?.kind === "move") return new Set([gesture.stroke.id]);
    return undefined;
  }, [gesture]);
  const draft = gesture?.kind === "draw" ? gesture.stroke : gesture?.kind === "move" ? { ...gesture.stroke, points: gesture.stroke.points.map((n, i) => n + (i % 2 ? gesture.dy : gesture.dx)) } : null;
  const selectedStroke = b.selected ? (draft?.id === b.selected ? draft : b.strokes.find((s) => s.id === b.selected)) : null;
  const selBox = selectedStroke ? drawingBounds([selectedStroke]) : null;
  const panning = gesture?.kind === "pan" || gesture?.kind === "pinch";
  const cursor = !b.editable || b.tool === "hand" || space ? (panning ? "grabbing" : full ? "grab" : "default") : b.tool === "select" ? "default" : b.tool === "eraser" ? "cell" : "crosshair";
  const empty = !b.strokes.length && !draft;

  return (
    <div
      ref={wrap}
      tabIndex={-1}
      className={`relative outline-none ${full ? "min-h-0 flex-1 overflow-hidden" : ""}`}
      onKeyDown={(e) => !full && b.editable && onKey(e)}
    >
      <svg
        ref={svg}
        viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
        className={`drawing-canvas block w-full select-none ${full ? "h-full" : ""}`}
        style={{
          aspectRatio: full ? undefined : `${box.w} / ${box.h}`,
          touchAction: full ? "none" : coarse ? "pan-y" : "none",
          cursor,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => !full && coarse && onOpenFull?.()}
      >
        {full && (
          // The part of the whiteboard that the page shows.
          <rect
            x={inlineBox.x}
            y={inlineBox.y}
            width={inlineBox.w}
            height={inlineBox.h}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.15}
            strokeDasharray={`${8 / (view?.zoom ?? 1)} ${6 / (view?.zoom ?? 1)}`}
            strokeWidth={1 / (view?.zoom ?? 1)}
          />
        )}
        <Strokes strokes={b.strokes} hidden={hidden} />
        {draft && (
          <path
            d={strokePath(draft)}
            fill="none"
            stroke={colorOf(draft.color)}
            strokeWidth={strokeWidth(draft)}
            strokeOpacity={strokeOpacity(draft)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {selBox && (
          <rect
            x={selBox.x - 4}
            y={selBox.y - 4}
            width={selBox.w + 8}
            height={selBox.h + 8}
            fill="none"
            stroke="#3b82f6"
            strokeWidth={1.5}
            strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {empty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-neutral-400">
          {b.editable ? t("drawing.empty") : t("drawing.emptyReadOnly")}
        </div>
      )}
      {full && (
        <div className="absolute right-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] flex items-center gap-0.5 rounded-lg border border-neutral-200 bg-white/90 p-0.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/90">
          <ToolButton label={t("drawing.zoomOut")} onClick={() => zoomAt(1 / 1.25, screen.w / 2, screen.h / 2)}>
            <ZoomOut size={16} />
          </ToolButton>
          <span className="w-12 text-center text-xs text-neutral-500 tabular-nums">{Math.round((view?.zoom ?? 1) * 100)} %</span>
          <ToolButton label={t("drawing.zoomIn")} onClick={() => zoomAt(1.25, screen.w / 2, screen.h / 2)}>
            <ZoomIn size={16} />
          </ToolButton>
          <ToolButton label={t("drawing.fit")} onClick={() => setView(fitView(drawingViewBox(b.strokes, b.height), screen.w, screen.h))}>
            <Scan size={16} />
          </ToolButton>
        </div>
      )}
      {full && (
        <div className="pointer-events-none absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-3 hidden max-w-md text-xs text-neutral-400 md:block">{t("drawing.hint")}</div>
      )}
      {!full && b.editable && (
        <div
          role="separator"
          aria-orientation="horizontal"
          title={t("drawing.resize")}
          aria-label={t("drawing.resize")}
          className="absolute inset-x-0 bottom-0 flex h-3 cursor-ns-resize touch-none items-end justify-center opacity-0 transition-opacity group-hover/drawing:opacity-100"
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onPointerCancel={onResizeUp}
        >
          <span className="mb-1 h-1 w-10 rounded-full bg-neutral-300 dark:bg-neutral-600" />
        </div>
      )}
    </div>
  );
}
