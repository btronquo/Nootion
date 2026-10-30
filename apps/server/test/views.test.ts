import { describe, expect, it } from "vitest";
import { applyView, calendarDateProp, daysBetween, groupRows, initialValues, moveToGroup, rowDays, shiftDate, type DatabaseProperty, type DatabaseRow, type ViewContext } from "@nootion/shared";
import { setLocaleResolver } from "@nootion/shared";

// These tests check French messages and formats.
setLocaleResolver(() => "fr");

const prop = (id: string, type: DatabaseProperty["type"], config: DatabaseProperty["config"] = {}): DatabaseProperty => ({
  id,
  name: id,
  type,
  config,
  position: 0,
});
const title = prop("title", "title");
const amount = prop("amount", "currency");
const due = prop("due", "date");
const paid = prop("paid", "checkbox");
const status = prop("status", "select", {
  options: [
    { id: "s1", name: "À payer", color: "red" },
    { id: "s2", name: "Payée", color: "green" },
  ],
});
const owner = prop("owner", "person");
const total = prop("total", "formula", { expression: "" });

let n = 0;
const row = (t: string, values: DatabaseRow["values"]): DatabaseRow => ({
  id: `r${++n}`,
  title: t,
  icon: null,
  cover: null,
  coverPosition: 50,
  values,
  createdAt: "",
  updatedAt: "",
  createdBy: null,
});

const rows = [
  row("EDF", { amount: 120, due: { start: "2026-10-01" }, paid: true, status: "s2", owner: ["u1"], total: { kind: "number", value: 144 } }),
  row("Free", { amount: 29.99, due: { start: "2026-11-05" }, paid: false, status: "s1", owner: ["u2"], total: { kind: "number", value: 35.99 } }),
  row("Éco", { amount: null, due: null, paid: null, status: null, owner: [], total: null }),
  row("Assurance", {
    amount: 60,
    due: { start: "2026-10-30" },
    paid: false,
    status: "s1",
    owner: ["u1", "u2"],
    total: { kind: "number", value: 72 },
  }),
];
const ctx: ViewContext = {
  properties: [title, amount, due, paid, status, owner, total],
  rows,
  people: { u1: "Boris", u2: "Alice" },
  related: {},
  rollupTargets: {},
  me: "u1",
};
const titles = (r: DatabaseRow[]) => r.map((x) => x.title);
const now = new Date(2026, 9, 29, 12);

describe("filters, sorts and groups", () => {
  it("filters by text, number, date, checkbox, select, person and formula", () => {
    expect(titles(applyView(ctx, { filters: [{ propertyId: "title", operator: "contains", value: "eco" }] }))).toEqual(["Éco"]);
    expect(titles(applyView(ctx, { filters: [{ propertyId: "amount", operator: "gt", value: 50 }] }))).toEqual(["EDF", "Assurance"]);
    expect(titles(applyView(ctx, { filters: [{ propertyId: "amount", operator: "is_empty" }] }))).toEqual(["Éco"]);
    expect(titles(applyView(ctx, { filters: [{ propertyId: "due", operator: "within", value: "next_week" }] }, now))).toEqual(["Free", "Assurance"]);
    expect(titles(applyView(ctx, { filters: [{ propertyId: "due", operator: "before", value: "today" }] }, now))).toEqual(["EDF"]);
    expect(titles(applyView(ctx, { filters: [{ propertyId: "paid", operator: "unchecked" }] }))).toEqual(["Free", "Éco", "Assurance"]);
    expect(titles(applyView(ctx, { filters: [{ propertyId: "status", operator: "is", value: "s1" }] }))).toEqual(["Free", "Assurance"]);
    expect(titles(applyView(ctx, { filters: [{ propertyId: "owner", operator: "contains", value: "me" }] }))).toEqual(["EDF", "Assurance"]);
    expect(titles(applyView(ctx, { filters: [{ propertyId: "total", operator: "gte", value: 72 }] }))).toEqual(["EDF", "Assurance"]);
  });

  it("combines filters with and / or, and ignores incomplete filters", () => {
    const filters = [
      { propertyId: "status", operator: "is" as const, value: "s1" },
      { propertyId: "amount", operator: "lt" as const, value: 50 },
    ];
    expect(titles(applyView(ctx, { filters }))).toEqual(["Free"]);
    expect(titles(applyView(ctx, { filters, filterMode: "or" }))).toEqual(["Free", "Assurance"]);
    expect(applyView(ctx, { filters: [{ propertyId: "title", operator: "contains", value: "" }] })).toHaveLength(4);
    expect(applyView(ctx, { filters: [{ propertyId: "gone", operator: "is_empty" }] })).toHaveLength(4);
    // An operator that doesn't fit the column (after a type change) is ignored.
    expect(applyView(ctx, { filters: [{ propertyId: "paid", operator: "gt", value: 1 }] })).toHaveLength(4);
  });

  it("sorts on several columns, empty values last", () => {
    expect(titles(applyView(ctx, { sorts: [{ propertyId: "amount", direction: "desc" }] }))).toEqual(["EDF", "Assurance", "Free", "Éco"]);
    expect(titles(applyView(ctx, { sorts: [{ propertyId: "title", direction: "asc" }] }))).toEqual(["Assurance", "Éco", "EDF", "Free"]);
    // Select options sort in their own order.
    expect(
      titles(
        applyView(ctx, {
          sorts: [
            { propertyId: "status", direction: "asc" },
            { propertyId: "amount", direction: "asc" },
          ],
        }),
      ),
    ).toEqual(["Free", "Assurance", "EDF", "Éco"]);
  });

  it("groups and moves between groups", () => {
    const g = groupRows(status, rows, ctx);
    expect(g.map((x) => [x.label, titles(x.rows)])).toEqual([
      ["À payer", ["Free", "Assurance"]],
      ["Payée", ["EDF"]],
      ["Sans status", ["Éco"]],
    ]);
    const byOwner = groupRows(owner, rows, ctx);
    expect(byOwner.map((x) => [x.label, x.rows.length])).toEqual([
      ["Alice", 2],
      ["Boris", 2],
      ["Sans owner", 1],
    ]);
    expect(groupRows(due, rows, ctx).map((x) => x.label)).toEqual(["octobre 2026", "novembre 2026", "Sans due"]);
    expect(moveToGroup(status, "s1", "s1", "s2")).toBe("s2");
    expect(moveToGroup(owner, ["u1", "u2"], "u1", "")).toEqual(["u2"]);
    expect(moveToGroup(paid, false, "false", "true")).toBe(true);
  });

  it("prefills a new row from the filters and the group", () => {
    const config = {
      filters: [
        { propertyId: "owner", operator: "contains" as const, value: "me" },
        { propertyId: "paid", operator: "unchecked" as const },
      ],
    };
    expect(initialValues(ctx, config, { prop: status, key: "s1" })).toEqual({ owner: ["u1"], paid: false, status: "s1" });
  });
});

describe("calendar", () => {
  it("places rows on their date column, over every day of a range", () => {
    const created = prop("created", "created_time");
    expect(calendarDateProp([title, created, due], null)?.id).toBe("due");
    expect(calendarDateProp([title, created, due], "created")?.id).toBe("created");
    expect(calendarDateProp([title, amount], null)).toBeUndefined();

    expect(rowDays(due, row("A", { due: { start: "2026-10-30" } }))).toEqual(["2026-10-30"]);
    expect(rowDays(due, row("B", { due: { start: "2026-10-30T09:00", end: "2026-11-02" } }))).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(rowDays(due, row("C", { due: null }))).toEqual([]);
  });

  it("moves dates by days, keeping the time", () => {
    expect(shiftDate("2026-10-30", 3)).toBe("2026-11-02");
    expect(shiftDate("2026-03-28T09:30", 2)).toBe("2026-03-30T09:30");
    expect(daysBetween("2026-10-30", "2026-11-02")).toBe(3);
    expect(daysBetween("2026-03-30", "2026-03-28")).toBe(-2);
  });
});
