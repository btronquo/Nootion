import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import * as Y from "yjs";
import { checkContent, parseInline, parseMarkdown } from "../src/markdown-in.js";
import { toMarkdown } from "../src/markdown.js";
import { parseHtml } from "../src/html-in.js";
import { prosemirrorToText, setProsemirrorJSON, yDocToProsemirrorJSON, type ProseMirrorNode } from "../src/collab.js";
import { Client, makeApp, setupAdmin } from "./helpers.js";

const links = { file: () => null, page: () => null };
const inline = (latex: string) => ({ type: "mathInline", attrs: { latex } });
const block = (latex: string) => ({ type: "mathBlock", attrs: { latex } });
const page = (content: unknown[]) => ({ type: "doc", content }) as ProseMirrorNode;

describe("equations in Markdown", () => {
  it("$…$ in a line is an equation, prices are not", () => {
    expect(parseInline("Area: $\\pi r^2$, done")).toEqual([{ type: "text", text: "Area: " }, inline("\\pi r^2"), { type: "text", text: ", done" }]);
    expect(parseInline("$x$")).toEqual([inline("x")]);
    // Pandoc's rule: no space just inside the dollars, no digit just after the closing one.
    expect(parseInline("it costs $5 and $10")).toEqual([{ type: "text", text: "it costs $5 and $10" }]);
    expect(parseInline("from $ 5 to 6 $")).toEqual([{ type: "text", text: "from $ 5 to 6 $" }]);
    expect(parseInline("between $5$10")).toEqual([{ type: "text", text: "between $5$10" }]);
    // An escaped dollar stays a dollar; a dollar escaped inside LaTeX is LaTeX's.
    expect(parseInline("\\$x\\$")).toEqual([{ type: "text", text: "$x$" }]);
    expect(parseInline("$a \\$ b$")).toEqual([inline("a \\$ b")]);
    // In code, it stays code.
    expect(parseInline("`$x$`")).toEqual([{ type: "text", text: "$x$", marks: [{ type: "code" }] }]);
  });

  it("$$ … $$ and ```math are equation blocks", () => {
    const doc = parseMarkdown("Before\n\n$$\n\\int_0^1 x^2\\,dx\n= \\frac{1}{3}\n$$\n\n$$E = mc^2$$\n\n```math\na^2+b^2=c^2\n```\n\nAfter");
    expect(doc.content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "Before" }] },
      block("\\int_0^1 x^2\\,dx\n= \\frac{1}{3}"),
      block("E = mc^2"),
      block("a^2+b^2=c^2"),
      { type: "paragraph", content: [{ type: "text", text: "After" }] },
    ]);
    // "$$" never closed stays text.
    expect(parseMarkdown("$$ not closed\n\nnext").content![0]).toEqual({ type: "paragraph", content: [{ type: "text", text: "$$ not closed" }] });
    // A paragraph stops at an equation block.
    expect(parseMarkdown("line\n$$x$$").content!.map((n) => n.type)).toEqual(["paragraph", "mathBlock"]);
  });

  it("export as $…$ and $$…$$, and read back the same", () => {
    const doc = page([
      { type: "paragraph", content: [{ type: "text", text: "Euler: " }, inline("e^{i\\pi} + 1 = 0"), { type: "text", text: " costs $5 or $6" }] },
      block("\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}"),
    ]);
    const md = toMarkdown(doc, links);
    expect(md).toBe("Euler: $e^{i\\pi} + 1 = 0$ costs \\$5 or \\$6\n\n$$\n\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}\n$$");
    expect(parseMarkdown(md, {})).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Euler: " }, inline("e^{i\\pi} + 1 = 0"), { type: "text", text: " costs $5 or $6" }] },
        block("\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}"),
      ],
    });
    // One dollar alone needs no escape; an empty equation exports nothing.
    expect(toMarkdown(page([{ type: "paragraph", content: [{ type: "text", text: "5 $" }] }, block("")]), links)).toBe("5 $");
  });
});

describe("equations in content", () => {
  it("are kept through the API with their LaTeX only, and go through the collaborative document", () => {
    const json = checkContent(
      page([
        { type: "paragraph", content: [{ type: "mathInline", attrs: { latex: "x^2", onclick: "alert(1)" } }] },
        { type: "mathBlock", attrs: { latex: 42 } },
        { type: "mathBlock", attrs: { latex: "y".repeat(20_000) } },
      ]),
      "u1",
    );
    expect(json.content![0]!.content![0]).toEqual(inline("x^2"));
    expect(json.content![1]).toEqual(block(""));
    expect(String(json.content![2]!.attrs!.latex).length).toBe(10_000);
    const y = new Y.Doc();
    setProsemirrorJSON(y, json);
    expect(yDocToProsemirrorJSON(y).content![0]).toEqual(json.content![0]);
  });

  it("are searched by their LaTeX", () => {
    expect(prosemirrorToText(page([{ type: "paragraph", content: [{ type: "text", text: "Area " }, inline("\\pi r^2")] }, block("E=mc^2")]))).toBe(
      "Area \\pi r^2\nE=mc^2",
    );
  });
});

describe("equations in HTML", () => {
  it("drawn by KaTeX keep their LaTeX, in a line or as a block", () => {
    const katex = (latex: string) =>
      `<span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">${latex}</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span class="mord">x</span></span></span>`;
    const { doc } = parseHtml(
      `<p>Area <span class="notion-text-equation-token">${katex("\\pi r^2")}</span>.</p>` +
        `<figure class="equation"><style>.katex{}</style><div class="equation-container"><span class="katex-display">${katex("E=mc^2")}</span></div></figure>` +
        `<table><tr><td><span class="katex-display">${katex("a+b")}</span></td></tr></table>`,
    );
    expect(doc.content![0]).toEqual({ type: "paragraph", content: [{ type: "text", text: "Area " }, inline("\\pi r^2"), { type: "text", text: "." }] });
    expect(doc.content![1]).toEqual(block("E=mc^2"));
    expect(doc.content![2]!.content![0]!.content![0]!.content).toEqual([{ type: "paragraph", content: [inline("a+b")] }]);
  });
});

describe("equations in a page", () => {
  let app: FastifyInstance;
  let boris: Client;
  beforeEach(async () => {
    app = await makeApp();
    boris = await setupAdmin(app);
  });
  afterEach(async () => {
    await app.close();
  });

  it("are saved, read back and exported", async () => {
    const workspaceId = await boris.personalWorkspace();
    const id = (await boris.post("/api/pages", { workspaceId, title: "Maths" })).json().page.id;
    const content = page([{ type: "paragraph", content: [{ type: "text", text: "Soit " }, inline("x \\in \\mathbb{R}")] }, block("\\frac{a}{b}")]);
    const res = await boris.put(`/api/pages/${id}/content`, { content });
    expect(res.statusCode, res.body).toBe(200);
    expect((await boris.get(`/api/pages/${id}/content`)).json().content).toEqual(content);
  });
});
