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
