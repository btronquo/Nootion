import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { columnShares, columnsTemplate } from "../src/editor/columnResize";

// Just enough of the editor's schema for a row of columns.
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    text: {},
    columns: { group: "block", content: "column+" },
    column: { content: "block+", attrs: { width: { default: null } } },
  },
});
const row = (...widths: (number | null)[]) =>
  schema.nodeFromJSON({ type: "columns", content: widths.map((width) => ({ type: "column", attrs: { width }, content: [{ type: "paragraph" }] })) });

describe("column widths", () => {
  it("leaves columns that keep no width to equal shares", () => {
    expect(columnsTemplate(row(null, null))).toBeNull();
  });

  it("lays out the kept shares", () => {
    expect(columnsTemplate(row(0.3, 0.7))).toBe("minmax(0, 0.6fr) minmax(0, 1.4fr)");
  });

  it("gives a column added since the others were resized an equal share", () => {
    expect(columnsTemplate(row(0.25, 0.75, null))).toBe("minmax(0, 0.5fr) minmax(0, 1.5fr) minmax(0, 1fr)");
    expect(columnsTemplate(row(0.2, 0.2, 0.2, null))).toBe("minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)");
  });

  it("ignores widths that make no sense", () => {
    expect(columnsTemplate(row(-1, 3))).toBeNull();
  });

  it("turns widths in pixels into shares adding up to 1", () => {
    expect(columnShares([100, 300])).toEqual([0.25, 0.75]);
    const shares = columnShares([100, 100, 100]);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(shares).toEqual([0.3333, 0.3333, 0.3334]);
  });
});
