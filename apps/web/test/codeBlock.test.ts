import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { languageLabel, loadLanguage, resolveLanguage, DETECTED } from "../src/editor/codeLanguages";
import { highlightBlock } from "../src/editor/codeBlock";

// Just enough of the editor's schema for a code block.
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: {},
    codeBlock: { group: "block", content: "text*", code: true, attrs: { language: { default: null }, wrap: { default: false } } },
  },
});
const block = (text: string, language: string | null) => schema.node("codeBlock", { language }, text ? [schema.text(text)] : []);
const coloured = (text: string, language: string | null) => highlightBlock(block(text, language)).spans.map((s) => [text.slice(s.from, s.to), s.className]);

describe("code block languages", () => {
  it("understands the names other tools and Markdown give", () => {
    expect(resolveLanguage("JS")).toBe("javascript");
    expect(resolveLanguage("c++")).toBe("cpp");
    expect(resolveLanguage("C#")).toBe("csharp");
    expect(resolveLanguage("shell")).toBe("bash");
    expect(resolveLanguage("html")).toBe("xml");
    expect(resolveLanguage("plain text")).toBe("plaintext");
    expect(resolveLanguage("text")).toBe("plaintext");
    expect(resolveLanguage("python")).toBe("python");
  });

  it("keeps a language it doesn't colour as it is", () => {
    expect(resolveLanguage("mermaid")).toBeNull();
    expect(languageLabel("mermaid")).toBe("mermaid");
    expect(languageLabel("ts")).toBe("TypeScript");
  });
});

describe("code colouring", () => {
  it("colours once the language's grammar is loaded", async () => {
    await loadLanguage("javascript");
    const spans = coloured('const a = "b"; // c', "js");
    expect(spans).toContainEqual(["const", "hljs-keyword"]);
    expect(spans).toContainEqual(['"b"', "hljs-string"]);
    expect(spans).toContainEqual(["// c", "hljs-comment"]);
  });

  it("leaves plain text, unknown languages and empty blocks alone", () => {
    expect(coloured("const a = 1;", "plaintext")).toEqual([]);
    expect(coloured("graph TD; A-->B", "mermaid")).toEqual([]);
    expect(coloured("", "javascript")).toEqual([]);
  });

  it("guesses the language of a block that has none, when it is sure enough", async () => {
    await Promise.all(DETECTED.map(loadLanguage));
    const python = block('def greet(name):\n    print(f"Hello {name}")\n\nclass Person:\n    pass\n', null);
    expect(highlightBlock(python).detected).toBe("python");
    expect(highlightBlock(python).spans.length).toBeGreaterThan(0);
    // A few words are no language: no colours rather than wrong ones.
    expect(highlightBlock(block("hello world", null)).detected).toBeNull();
  });

  it("keeps the colours of a block that didn't change", async () => {
    await loadLanguage("css");
    const node = block("a { color: red; }", "css");
    expect(highlightBlock(node)).toBe(highlightBlock(node));
  });
});
