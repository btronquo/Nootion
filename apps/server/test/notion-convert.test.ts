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

describe("Notion blocks imported differently", () => {
  it("are noted with their block and what they are", async () => {
    const { blocksToDoc } = await import("../src/notion/blocks.js");
    const notes: [string, unknown][] = [];
    const block = (id: string, type: string, data: Record<string, unknown>) => ({ object: "block", id, type, has_children: false, [type]: data }) as never;
    await blocksToDoc(
      [
        block("b1", "ai_block", {}),
        block("b2", "image", { type: "file", file: { url: "https://files.example/abc/photo%201.png?X-Amz=1" }, caption: [] }),
        block("b3", "equation", { expression: "e=mc^2" }),
      ],
      { pageFor: () => null, saveFile: async () => null, note: (what, detail) => notes.push([what, detail]) },
    );
    expect(notes).toEqual([
      ["unsupported", { blockId: "b1", info: "ai_block" }],
      ["fileMissing", { blockId: "b2", info: "photo 1.png" }],
      ["equation", { blockId: "b3", info: "e=mc^2" }],
    ]);
  });
});

describe("Notion videos", () => {
  it("become video blocks: links of video sites and video files", async () => {
    const { blocksToDoc } = await import("../src/notion/blocks.js");
    const block = (id: string, type: string, data: Record<string, unknown>) => ({ object: "block", id, type, has_children: false, [type]: data }) as never;
    const doc = await blocksToDoc(
      [
        block("v1", "video", { type: "external", external: { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }, caption: [] }),
        block("v2", "video", { type: "file", file: { url: "https://files.example/abc/clip.mp4?X-Amz=1" }, caption: [] }),
        block("v3", "video", { type: "external", external: { url: "https://example.org/page" }, caption: [] }),
      ],
      {
        pageFor: () => null,
        saveFile: async (_url, name) => ({ url: "/api/attachments/6f1c1f5e-1d2b-4c3a-9e8f-0123456789ab", name, size: 10, mimeType: "video/mp4" }),
        note: () => {},
      },
    );
    expect(doc.content?.slice(0, 2)).toEqual([
      { type: "video", attrs: { src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } },
      { type: "video", attrs: { src: "/api/attachments/6f1c1f5e-1d2b-4c3a-9e8f-0123456789ab" } },
    ]);
    expect(doc.content?.[2]?.type).toBe("paragraph");
  });
});
