import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { checkContent } from "../src/markdown-in.js";
import { toMarkdown } from "../src/markdown.js";
import { setProsemirrorJSON, yDocToProsemirrorJSON } from "../src/collab.js";

const links = { file: () => null, page: () => null };
const image = (attrs: Record<string, unknown>) => ({
  type: "doc",
  content: [{ type: "image", attrs: { src: "/api/attachments/x.png", alt: "Photo", ...attrs } }],
});

describe("image blocks", () => {
  it("keep their width, alignment, caption and crop through the API and the collaborative document", () => {
    const attrs = { width: 320, align: "center", caption: "Le port au matin", crop: { x: 0.1, y: 0, w: 0.5, h: 0.75, r: 1.5 } };
    const json = checkContent(image(attrs), "u1");
    expect(json.content![0]!.attrs).toMatchObject(attrs);
    const y = new Y.Doc();
    setProsemirrorJSON(y, json);
    expect(yDocToProsemirrorJSON(y)).toEqual(json);
  });

  it("drop layout values the editor can't draw", () => {
    const json = checkContent(image({ width: "100%; position: fixed", align: "justify", caption: 12, crop: { x: 2, y: 0, w: 1, h: 1, r: 1 } }), "u1");
    expect(json.content![0]!.attrs).toMatchObject({ width: null, align: null, caption: null, crop: null });
    // Images that never had them stay as they were.
    expect(checkContent(image({}), "u1").content![0]!.attrs).toEqual({ src: "/api/attachments/x.png", alt: "Photo" });
  });

  it("export their caption to Markdown, in italics under the image", () => {
    expect(toMarkdown(image({ caption: "Le *port*" }) as never, links)).toContain("![Photo](/api/attachments/x.png)\n*Le \\*port\\**");
    expect(toMarkdown(image({}) as never, links).trim()).toBe("![Photo](/api/attachments/x.png)");
  });
});
