import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { distanceToStroke, drawingStrokes, drawingToSvg, drawingViewBox, simplifyPoints, strokePath, type DrawingStroke } from "@nootion/shared";
import { Client, makeApp, setupAdmin } from "./helpers.js";

const pen = (points: number[], extra: Partial<DrawingStroke> = {}): DrawingStroke => ({ id: "a", tool: "pen", color: "blue", size: 4, points, ...extra });

describe("drawing strokes", () => {
  it("keep only what parses, rounded", () => {
    const raw = [
      pen([0, 0, 10.123, 20.456]),
      { id: "b", tool: "laser", color: "red", size: 4, points: [0, 0] },
      { id: "c", tool: "rect", color: "<script>", size: 999, points: [0, 0, 5, 5] },
      { id: "d", tool: "pen", color: "red", size: 4, points: [0, "x"] },
      { id: "e", tool: "line", color: "red", size: 4, points: [1, 2, 3] },
      "nope",
    ];
    const strokes = drawingStrokes(raw);
    expect(strokes.map((s) => s.id)).toEqual(["a", "c"]);
    expect(strokes[0]!.points).toEqual([0, 0, 10.1, 20.5]);
    expect(strokes[1]).toMatchObject({ color: "default", size: 64 });
    expect(drawingStrokes("nope")).toEqual([]);
  });

  it("draw as SVG paths, and are found near their line", () => {
    expect(strokePath(pen([5, 5]))).toBe("M5 5l0.01 0");
    expect(strokePath(pen([0, 0, 10, 0, 20, 10]))).toBe("M0 0Q10 0 15 5L20 10");
    expect(strokePath(pen([0, 0, 10, 20], { tool: "rect" }))).toBe("M0 0H10V20H0Z");
    expect(strokePath(pen([0, 0, 10, 0], { tool: "arrow" }))).toMatch(/^M0 0L10 0M.+L10 0L.+$/);
    const rect = pen([0, 0, 100, 100], { tool: "rect" });
    expect(distanceToStroke(rect, 50, 2)).toBeCloseTo(2);
    expect(distanceToStroke(rect, 50, 50)).toBeCloseTo(50);
    const ellipse = pen([0, 0, 100, 100], { tool: "ellipse" });
    expect(distanceToStroke(ellipse, 100, 50)).toBeLessThan(1);
  });

  it("simplify straight lines to their ends", () => {
    expect(simplifyPoints([0, 0, 1, 0.1, 2, 0, 3, 0.05, 4, 0])).toEqual([0, 0, 4, 0]);
    expect(simplifyPoints([0, 0, 5, 5, 10, 0])).toEqual([0, 0, 5, 5, 10, 0]);
  });

  it("widen the page's frame so that nothing is cut", () => {
    expect(drawingViewBox([], 400)).toEqual({ x: 0, y: 0, w: 1000, h: 400 });
    const box = drawingViewBox([pen([-100, 10, 1200, 900], { size: 2 })], 400);
    expect(box).toEqual({ x: -101, y: 0, w: 1302, h: 901 });
  });

  it("export as a standalone SVG with light colours", () => {
    const svg = drawingToSvg([pen([10, 10, 20, 20]), { id: "x", tool: "pen", color: '"/><script>', size: 4, points: [50, 50] }], 300);
    expect(svg).toContain('viewBox="0 0 1000 300"');
    expect(svg).toContain('stroke="#337ea9"');
    expect(svg).not.toContain("<script>");
  });
});

describe("drawing block", () => {
  let app: FastifyInstance;
  let boris: Client;

  beforeEach(async () => {
    app = await makeApp();
    boris = await setupAdmin(app);
  });

  it("is accepted in page content and exported to Markdown as an image", async () => {
    const workspace = await boris.personalWorkspace();
    const id = await boris.createPage(workspace, "Croquis");
    const drawing = { type: "drawing", attrs: { strokes: [pen([0, 0, 50, 50])], height: 300 } };
    const res = await boris.put(`/api/pages/${id}/content`, { content: { type: "doc", content: [drawing, { type: "drawing", attrs: { strokes: [] } }] } });
    expect(res.statusCode, res.body).toBe(200);
    const content = (await boris.get(`/api/pages/${id}/content`)).json();
    expect(content.content.content[0]).toMatchObject(drawing);
    const md = content.markdown as string;
    const [, b64] = /^!\[(?:Drawing|Dessin)\]\(data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)\)$/.exec(md.trim()) ?? [];
    expect(b64).toBeTruthy();
    expect(Buffer.from(b64!, "base64").toString()).toContain("<path");
  });
});
