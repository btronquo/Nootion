import { describe, expect, it } from "vitest";
import katex from "katex";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { MAX_LATEX, errorMessage, renderWith } from "../src/editor/math";
import { INLINE_MATH_INPUT, MathBlock, MathInline } from "../src/editor/mathNodes";

describe("equations drawn by KaTeX", () => {
  it("in a line or as a block", () => {
    const line = renderWith(katex, "\\frac{a}{b}", false);
    expect("html" in line && line.html).toContain('class="katex"');
    expect("html" in line && line.html).not.toContain("katex-display");
    const block = renderWith(katex, "\\sum_{n=1}^{\\infty} n", true);
    expect("html" in block && block.html).toContain("katex-display");
  });

  it("say what is wrong, without the library's prefix", () => {
    const wrong = renderWith(katex, "\\frac{a", false);
    expect(wrong).toEqual({ error: expect.not.stringContaining("KaTeX parse error") });
    expect(errorMessage(new Error("KaTeX parse error: Expected '}'"))).toBe("Expected '}'");
    expect(renderWith(katex, "x".repeat(MAX_LATEX + 1), false)).toEqual({ error: "too long" });
  });

  it("never make links nor carry HTML", () => {
    for (const latex of ["\\href{javascript:alert(1)}{x}", "\\url{https://example.com}", "\\htmlClass{x}{y}", "\\includegraphics{a.png}"]) {
      const out = renderWith(katex, latex, false);
      // The LaTeX itself is kept, as text, in the MathML annotation.
      const html = ("html" in out ? out.html : "").replace(/<annotation[^>]*>[^<]*<\/annotation>/g, "");
      expect(html).not.toMatch(/<a |<img |javascript:|class="x"/);
    }
  });
});

describe("typing an equation in a line", () => {
  const typed = (s: string) => INLINE_MATH_INPUT.exec(s)?.[2] ?? null;
  it("turns $…$ into an equation when the closing $ is typed", () => {
    expect(typed("Area: $\\pi r^2$")).toBe("\\pi r^2");
    expect(typed("$x$")).toBe("x");
    expect(typed("($a+b$")).toBe("a+b");
  });
  it("leaves prices, spaces and escaped dollars alone", () => {
    expect(typed("it costs $5 and $")).toBeNull();
    expect(typed("$ x$")).toBeNull();
    expect(typed("US$5 or $")).toBeNull();
    expect(typed("\\$x$")).toBeNull();
    expect(typed("$$")).toBeNull();
    expect(typed("$$x$")).toBeNull();
  });
});

describe("equation nodes", () => {
  const schema = getSchema([StarterKit, MathInline, MathBlock]);
  it("keep their LaTeX in the HTML, to copy and paste them", () => {
    const n = schema.nodes.mathInline!.create({ latex: "x^2" });
    expect(schema.nodes.mathInline!.spec.toDOM!(n)).toEqual(["span", { "data-latex": "x^2", "data-math-inline": "", class: "math-inline" }, "$x^2$"]);
    const b = schema.nodes.mathBlock!.create({ latex: "y" });
    expect(schema.nodes.mathBlock!.spec.toDOM!(b)).toEqual(["div", { "data-latex": "y", "data-math-block": "", class: "math-block" }, "$$y$$"]);
  });
  it("are an inline atom and a block atom", () => {
    expect(schema.nodes.mathInline!.isInline && schema.nodes.mathInline!.isAtom).toBe(true);
    expect(schema.nodes.mathBlock!.isBlock && schema.nodes.mathBlock!.isAtom).toBe(true);
  });
});
