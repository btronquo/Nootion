import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Highlight, TextColor } from "../src/editor/textColors";

const schema = getSchema([StarterKit, TextColor, Highlight]);
const toDOM = (name: string, attrs: Record<string, unknown>) => schema.marks[name]!.spec.toDOM!(schema.marks[name]!.create(attrs), true);

describe("text colors", () => {
  it("are shown with the blocks' colors", () => {
    expect(toDOM("textColor", { color: "red" })).toEqual(["span", { "data-color": "red", class: "nt-text-color" }, 0]);
    expect(toDOM("highlight", { color: "blue" })).toEqual(["mark", { "data-color": "blue-bg", class: "nt-highlight" }, 0]);
  });

  it("never carry a free CSS value", () => {
    expect(toDOM("textColor", { color: "#f00" })).toEqual(["span", { class: "nt-text-color" }, 0]);
    expect(toDOM("highlight", { color: "url(x)" })).toEqual(["mark", { "data-color": "yellow-bg", class: "nt-highlight" }, 0]);
  });

  it("replace each other: a piece of text has one color and one highlight", () => {
    const red = schema.marks.textColor!.create({ color: "red" });
    const blue = schema.marks.textColor!.create({ color: "blue" });
    const yellow = schema.marks.highlight!.create({ color: "yellow" });
    expect(
      blue
        .addToSet(yellow.addToSet(red.addToSet([])))
        .map((m) => `${m.type.name}:${m.attrs.color}`)
        .sort(),
    ).toEqual(["highlight:yellow", "textColor:blue"]);
  });

  it("are not carried on when typing after the colored text", () => {
    expect(schema.marks.textColor!.spec.inclusive).toBe(false);
    expect(schema.marks.highlight!.spec.inclusive).toBe(false);
  });
});
