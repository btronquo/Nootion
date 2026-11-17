import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { checkContent } from "../src/markdown-in.js";
import { toMarkdown } from "../src/markdown.js";
import { setProsemirrorJSON, yDocToProsemirrorJSON, type ProseMirrorNode } from "../src/collab.js";
import * as Y from "yjs";
import { Client, makeApp, setupAdmin } from "./helpers.js";

const doc = (marks: unknown[]) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "rouge", marks }] }] });
const marksOf = (json: ProseMirrorNode) => json.content![0]!.content![0]!.marks;

describe("text colors and highlights", () => {
  it("are kept in content sent through the API, with a color name only", () => {
    const ok = checkContent(
      doc([
        { type: "textColor", attrs: { color: "red" } },
        { type: "highlight", attrs: { color: "yellow", style: "x" } },
      ]),
      "u1",
    );
    expect(marksOf(ok)).toEqual([
      { type: "textColor", attrs: { color: "red" } },
      { type: "highlight", attrs: { color: "yellow" } },
    ]);
    // A free CSS value, or no color at all, is dropped: the text stays.
    const bad = checkContent(doc([{ type: "textColor", attrs: { color: "#f00; background: url(x)" } }, { type: "highlight" }]), "u1");
    expect(marksOf(bad)).toBeUndefined();
    expect(bad.content![0]!.content![0]!.text).toBe("rouge");
  });

  it("go through the collaborative document unchanged", () => {
    const json = checkContent(doc([{ type: "bold" }, { type: "textColor", attrs: { color: "blue" } }, { type: "highlight", attrs: { color: "pink" } }]), "u1");
    const y = new Y.Doc();
    setProsemirrorJSON(y, json);
    expect(yDocToProsemirrorJSON(y)).toEqual(json);
  });

  it("export to Markdown as plain text, highlights between ==", () => {
    const json = checkContent(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "rouge", marks: [{ type: "textColor", attrs: { color: "red" } }] },
              { type: "text", text: " et " },
              { type: "text", text: "surligné", marks: [{ type: "highlight", attrs: { color: "green" } }] },
            ],
          },
        ],
      },
      "u1",
    );
    expect(toMarkdown(json, { file: () => null, page: () => null })).toContain("rouge et ==surligné==");
  });
});

describe("Notion text colors", () => {
  it("become text colors and highlights", async () => {
    const { richText } = await import("../src/notion/blocks.js");
    const item = (text: string, color: string) => ({
      type: "text" as const,
      plain_text: text,
      href: null,
      text: { content: text, link: null },
      annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color },
    });
    const out = richText([item("a", "red"), item("b", "yellow_background"), item("c", "default"), item("d", "teal")], { pageFor: () => null, note: () => {} });
    expect(out.map((n) => n.marks)).toEqual([
      [{ type: "textColor", attrs: { color: "red" } }],
      [{ type: "highlight", attrs: { color: "yellow" } }],
      undefined,
      undefined,
    ]);
  });
});

describe("colored text in a page", () => {
  let app: FastifyInstance;
  let boris: Client;
  beforeEach(async () => {
    app = await makeApp();
    boris = await setupAdmin(app);
  });
  afterEach(async () => {
    await app.close();
  });

  it("is saved and read back", async () => {
    const workspaceId = await boris.personalWorkspace();
    const id = (await boris.post("/api/pages", { workspaceId, title: "Couleurs" })).json().page.id;
    const content = doc([
      { type: "textColor", attrs: { color: "purple" } },
      { type: "highlight", attrs: { color: "blue" } },
    ]);
    const res = await boris.put(`/api/pages/${id}/content`, { content });
    expect(res.statusCode, res.body).toBe(200);
    const saved = (await boris.get(`/api/pages/${id}/content`)).json().content;
    expect(marksOf(saved)).toEqual(content.content[0]!.content[0]!.marks);
  });
});
