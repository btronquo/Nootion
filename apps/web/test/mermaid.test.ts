import { beforeEach, describe, expect, it, vi } from "vitest";

const render = vi.fn();
const initialize = vi.fn();
vi.mock("mermaid", () => ({ default: { render, initialize } }));
const removed: string[] = [];
vi.stubGlobal("document", { getElementById: (id: string) => ({ remove: () => removed.push(id) }) });

const { drawMermaid, errorMessage } = await import("../src/editor/mermaid");

beforeEach(() => {
  render.mockReset();
  initialize.mockReset();
  removed.length = 0;
});

describe("Mermaid diagrams", () => {
  it("draws in strict mode, with the theme of the page", async () => {
    render.mockResolvedValue({ svg: "<svg>light</svg>" });
    expect(await drawMermaid("flowchart LR\n A --> B", false)).toEqual({ svg: "<svg>light</svg>" });
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: "strict", theme: "default", startOnLoad: false }));
    render.mockResolvedValue({ svg: "<svg>dark</svg>" });
    expect(await drawMermaid("flowchart LR\n A --> B", true)).toEqual({ svg: "<svg>dark</svg>" });
    expect(initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "dark" }));
  });

  it("draws the same source only once", async () => {
    render.mockResolvedValue({ svg: "<svg/>" });
    await drawMermaid('pie\n "a": 1', false);
    await drawMermaid('pie\n "a": 1', false);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("turns a mistake into a short message, and cleans up after Mermaid", async () => {
    render.mockRejectedValue(new Error("Parse error on line 2:\n...A --\n-----^\nExpecting 'SEMI', 'NEWLINE', got 'EOF'"));
    const drawn = await drawMermaid("flowchart LR\n A --", false);
    expect(drawn).toEqual({ error: "Parse error on line 2", line: 2 });
    expect(removed.some((id) => id.startsWith("dmermaid-"))).toBe(true);
  });

  it("draws one diagram at a time", async () => {
    let running = 0;
    let most = 0;
    render.mockImplementation(async (id: string) => {
      most = Math.max(most, ++running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return { svg: `<svg id="${id}"/>` };
    });
    await Promise.all(["graph TD\n a", "graph TD\n b", "graph TD\n c"].map((s) => drawMermaid(s, false)));
    expect(most).toBe(1);
  });

  it("reads messages of any shape", () => {
    expect(errorMessage("Lexical error")).toBe("Lexical error");
    expect(errorMessage(42)).toBe("");
    expect(errorMessage(new Error("Parse error on line 3:\n...\nExpecting 'A', 'B', got 'NODE_STRING'"))).toBe("Parse error on line 3 ('NODE_STRING')");
  });
});
