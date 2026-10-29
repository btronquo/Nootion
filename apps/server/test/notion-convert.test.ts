import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { setProsemirrorJSON, yDocToProsemirrorJSON, type ProseMirrorNode } from "../src/collab.js";

describe("ProseMirror JSON to Yjs", () => {
  it("round-trips nodes, attributes and marks", () => {
    const json: ProseMirrorNode = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Title" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hello " },
            { type: "text", text: "bold", marks: [{ type: "bold" }] },
            { type: "text", text: " and " },
            { type: "text", text: "link", marks: [{ type: "link", attrs: { href: "https://example.org" } }] },
            { type: "hardBreak" },
            { type: "pageLink", attrs: { pageId: "p1", title: "Other" } },
          ],
        },
        {
          type: "taskList",
          content: [{ type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "done" }] }] }],
        },
        { type: "paragraph" },
      ],
    };
    const doc = new Y.Doc();
    setProsemirrorJSON(doc, json);
    expect(yDocToProsemirrorJSON(doc)).toEqual(json);
    // Replacing keeps a single body.
    setProsemirrorJSON(doc, { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "New" }] }] });
    expect(yDocToProsemirrorJSON(doc).content).toHaveLength(1);
  });
});

describe("Notion dates", () => {
  it("become dates of the text", async () => {
    const { richText } = await import("../src/notion/blocks.js");
    const ann = { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" };
    const mention = (start: string, end: string | null = null) => ({ type: "mention" as const, plain_text: start, href: null, annotations: ann, mention: { type: "date", date: { start, end } } });
    const out = richText([mention("2026-11-15"), mention("2026-11-15T09:30:00.000+01:00"), mention("2026-11-15", "2026-11-17")], { pageFor: () => null, note: () => {} });
    expect(out.map((n) => n.attrs?.date ?? n.text)).toEqual(["2026-11-15", "2026-11-15T09:30", "2026-11-15"]);
    expect(out.map((n) => n.type)).toEqual(["dateMention", "dateMention", "text"]);
  });
});
