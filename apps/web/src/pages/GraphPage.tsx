import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { customIconId, t, type PageGraph } from "@nootion/shared";
import { api } from "../lib/api";
import { pageTitle } from "../lib/tree";

interface Node extends SimulationNodeDatum {
  id: string;
  title: string;
  icon: string | null;
  kind: string;
  degree: number;
}
type Link = SimulationLinkDatum<Node> & { kind: "child" | "link" };

const radius = (n: Node) => 5 + Math.sqrt(n.degree) * 2.5;

/** Every page as a dot, and the links between them, as in Obsidian. A click opens the page. */
export function GraphPage() {
  const graph = useQuery({ queryKey: ["graph"], queryFn: () => api<PageGraph>("/pages/graph") });
  const [children, setChildren] = useState(true);
  const [orphans, setOrphans] = useState(true);
  const data = useMemo(() => {
    if (!graph.data) return null;
    const links = graph.data.links.filter((l) => children || l.kind === "link");
    const degree = new Map<string, number>();
    for (const l of links) for (const id of [l.source, l.target]) degree.set(id, (degree.get(id) ?? 0) + 1);
    const nodes: Node[] = graph.data.nodes.filter((n) => orphans || degree.has(n.id)).map((n) => ({ ...n, degree: degree.get(n.id) ?? 0 }));
    return { nodes, links: links.map((l) => ({ ...l })) as Link[] };
  }, [graph.data, children, orphans]);

  return (
    <div className="flex h-[calc(100dvh-3.25rem)] flex-col md:h-dvh">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 pt-6 pb-3 sm:px-8">
        <h1 className="mr-auto text-2xl font-bold">{t("graph.title")}</h1>
        <label className="flex items-center gap-1.5 text-sm text-neutral-600 dark:text-neutral-300">
          <input type="checkbox" className="h-4 w-4 accent-blue-600" checked={children} onChange={(e) => setChildren(e.target.checked)} />
          {t("graph.children")}
        </label>
        <label className="flex items-center gap-1.5 text-sm text-neutral-600 dark:text-neutral-300">
          <input type="checkbox" className="h-4 w-4 accent-blue-600" checked={orphans} onChange={(e) => setOrphans(e.target.checked)} />
          {t("graph.orphans")}
        </label>
      </div>
      <p className="px-5 pb-2 text-xs text-neutral-500 sm:px-8">{t("graph.help")}</p>
      <div className="relative min-h-0 flex-1">
        {data ? <GraphCanvas nodes={data.nodes} links={data.links} /> : <p className="px-8 text-sm text-neutral-500">{t("common.loading")}</p>}
      </div>
    </div>
  );
}

function GraphCanvas({ nodes, links }: { nodes: Node[]; links: Link[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext("2d")!;
    const view = { x: 0, y: 0, k: 1 };
    let width = 0;
    let height = 0;
    let hover: Node | null = null;
    let dragging: Node | null = null;
    let panning: { x: number; y: number } | null = null;
    let moved = false;
    // Until the reader moves or zooms, the view keeps the whole graph in sight.
    let touched = false;
    function fit() {
      if (!nodes.length || !width) return;
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const n of nodes) [x0, y0, x1, y1] = [Math.min(x0, n.x!), Math.min(y0, n.y!), Math.max(x1, n.x!), Math.max(y1, n.y!)];
      const k = Math.min(2.2, Math.max(0.2, Math.min((width - 120) / (x1 - x0 || 1), (height - 80) / (y1 - y0 || 1))));
      view.k = k;
      view.x = (-(x0 + x1) / 2) * k;
      view.y = (-(y0 + y1) / 2) * k;
    }
    const neighbours = new Map<string, Set<string>>();
    for (const l of links) {
      const s = l.source as string;
      const d = l.target as string;
      if (!neighbours.has(s)) neighbours.set(s, new Set());
      if (!neighbours.has(d)) neighbours.set(d, new Set());
      neighbours.get(s)!.add(d);
      neighbours.get(d)!.add(s);
    }
    // Uploaded icons are drawn as images once loaded.
    const images = new Map<string, HTMLImageElement>();
    for (const n of nodes) {
      const id = customIconId(n.icon);
      if (id && !images.has(n.id)) {
        const img = new Image();
        img.src = `/api/icons/${id}/image`;
        img.onload = () => draw();
        images.set(n.id, img);
      }
    }

    const sim = forceSimulation<Node>(nodes)
      .force(
        "link",
        forceLink<Node, Link>(links)
          .id((n) => n.id)
          .distance((l) => (l.kind === "child" ? 40 : 70))
          .strength(0.4),
      )
      .force("charge", forceManyBody().strength(-120))
      .force("center", forceCenter(0, 0))
      .force("x", forceX(0).strength(0.04))
      .force("y", forceY(0).strength(0.04))
      .force(
        "collide",
        forceCollide<Node>().radius((n) => radius(n) + 2),
      )
      .on("tick", () => {
        if (!touched && sim.alpha() < 0.3) fit();
        draw();
      });

    const dark = () => document.documentElement.classList.contains("dark");
    // Hovering fades the highlight in and out rather than switching it at once.
    const fade = new Map<object, { a: number; h: number; la: number }>();
    const state = (key: object, a: number, la = 0) => {
      let st = fade.get(key);
      if (!st) fade.set(key, (st = { a, h: 0, la }));
      return st;
    };
    let last = performance.now();
    let frame = 0;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    function draw() {
      const now = performance.now();
      // At most one frame's worth: the first frame after a pause starts the fade, not ends it.
      const step = reduced ? 1 : 1 - Math.exp(-Math.min(now - last, 34) / 120);
      last = now;
      let settled = true;
      const ease = (from: number, to: number) => {
        const next = from + (to - from) * step;
        if (Math.abs(to - next) > 0.005) {
          settled = false;
          return next;
        }
        return to;
      };

      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.translate(width / 2 + view.x, height / 2 + view.y);
      ctx.scale(view.k, view.k);
      const d = dark();
      const near = hover ? neighbours.get(hover.id) : null;
      const lit = (n: Node) => !hover || n === hover || !!near?.has(n.id);
      const DIM = 0.3;

      for (const l of links) {
        const s = l.source as Node;
        const e = l.target as Node;
        const on = !!hover && (s === hover || e === hover);
        const st = state(l, 1);
        st.a = ease(st.a, hover && !on ? DIM : 1);
        st.h = ease(st.h, on ? 1 : 0);
        ctx.lineWidth = (1 + 0.6 * st.h) / Math.sqrt(view.k);
        if (l.kind === "child") ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(s.x!, s.y!);
        ctx.lineTo(e.x!, e.y!);
        ctx.globalAlpha = st.a * (1 - st.h);
        ctx.strokeStyle = d ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.2)";
        ctx.stroke();
        if (st.h > 0) {
          ctx.globalAlpha = st.h;
          ctx.strokeStyle = "#2383e2";
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
      for (const n of nodes) {
        const r = radius(n);
        const st = state(n, 1);
        st.a = ease(st.a, lit(n) ? 1 : DIM);
        st.h = ease(st.h, n === hover ? 1 : 0);
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, r, 0, Math.PI * 2);
        ctx.globalAlpha = st.a;
        ctx.fillStyle = n.kind === "database" ? (d ? "#7aa7d9" : "#5b8fc7") : d ? "#a3a3a3" : "#8a8a8a";
        ctx.fill();
        if (st.h > 0) {
          ctx.globalAlpha = st.a * st.h;
          ctx.fillStyle = "#2383e2";
          ctx.fill();
        }
        const img = images.get(n.id);
        if (img?.complete && img.naturalWidth) {
          ctx.globalAlpha = st.a;
          ctx.drawImage(img, n.x! - r, n.y! - r, r * 2, r * 2);
        }
      }
      // Titles: of the big dots, of all in a small graph or once zoomed in, and of the hovered page's neighbours.
      ctx.font = `${12 / view.k}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (const n of nodes) {
        const usual = nodes.length <= 80 || view.k > 1.4 || n.degree >= 6;
        const st = state(n, 1);
        st.la = ease(st.la, hover ? (lit(n) ? 1 : usual ? DIM : 0) : usual ? 1 : 0);
        if (st.la <= 0.01) continue;
        ctx.globalAlpha = st.la;
        ctx.fillStyle = d ? "#e5e5e5" : "#262626";
        const emoji = n.icon && !customIconId(n.icon) ? `${n.icon} ` : "";
        ctx.fillText(emoji + pageTitle(n.title), n.x!, n.y! + radius(n) + 3 / view.k);
      }
      ctx.globalAlpha = 1;
      if (!settled && !frame) frame = requestAnimationFrame(() => ((frame = 0), draw()));
    }

    function resize() {
      const rect = el.parentElement!.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = window.devicePixelRatio || 1;
      el.width = width * dpr;
      el.height = height * dpr;
      el.style.width = `${width}px`;
      el.style.height = `${height}px`;
      draw();
    }
    const observer = new ResizeObserver(resize);
    observer.observe(el.parentElement!);
    resize();

    const toWorld = (e: { clientX: number; clientY: number }) => {
      const rect = el.getBoundingClientRect();
      return { x: (e.clientX - rect.left - width / 2 - view.x) / view.k, y: (e.clientY - rect.top - height / 2 - view.y) / view.k };
    };
    const nodeAt = (e: { clientX: number; clientY: number }) => {
      const p = toWorld(e);
      let best: Node | null = null;
      for (const n of nodes) {
        const r = radius(n) + 3 / view.k;
        if ((n.x! - p.x) ** 2 + (n.y! - p.y) ** 2 <= r * r) best = n;
      }
      return best;
    };

    const onDown = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      moved = false;
      const n = nodeAt(e);
      if (n) {
        dragging = n;
        n.fx = n.x;
        n.fy = n.y;
        sim.alphaTarget(0.3).restart();
      } else panning = { x: e.clientX - view.x, y: e.clientY - view.y };
      touched = true;
    };
    const onMove = (e: PointerEvent) => {
      if (dragging) {
        moved = true;
        const p = toWorld(e);
        dragging.fx = p.x;
        dragging.fy = p.y;
      } else if (panning) {
        moved = true;
        view.x = e.clientX - panning.x;
        view.y = e.clientY - panning.y;
        draw();
      } else {
        const n = nodeAt(e);
        if (n !== hover) {
          hover = n;
          el.style.cursor = n ? "pointer" : "grab";
          draw();
        }
      }
    };
    const onUp = () => {
      if (dragging) {
        if (!moved) navigate(`/page/${dragging.id}`);
        dragging.fx = null;
        dragging.fy = null;
        sim.alphaTarget(0);
      }
      dragging = null;
      panning = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      touched = true;
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left - width / 2;
      const my = e.clientY - rect.top - height / 2;
      const k = Math.min(4, Math.max(0.2, view.k * Math.exp(-e.deltaY * 0.0015)));
      // Zooms around the mouse.
      view.x = mx - ((mx - view.x) * k) / view.k;
      view.y = my - ((my - view.y) * k) / view.k;
      view.k = k;
      draw();
    };
    const onLeave = () => {
      if (hover && !dragging) {
        hover = null;
        draw();
      }
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      cancelAnimationFrame(frame);
      sim.stop();
      observer.disconnect();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("wheel", onWheel);
    };
  }, [nodes, links, navigate]);

  return <canvas ref={canvas} className="absolute inset-0 cursor-grab touch-none" data-graph aria-label={t("graph.title")} />;
}
