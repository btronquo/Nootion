import { describe, expect, it } from "vitest";
import { Node as TiptapNode, getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskList } from "@tiptap/extension-list";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import type { Node } from "@tiptap/pm/model";
import { nextTaskDate, parseTaskRepeat, reminderTime } from "@nootion/shared";
import { RepeatingTaskItem, advanceRepeatingTasks } from "../src/editor/taskRepeat";

const at = (s: string) => new Date(s);

describe("the next date of a repeating to-do", () => {
  const every = (s: string) => parseTaskRepeat(s)!;

  it("reads the rules it knows", () => {
    expect(parseTaskRepeat("1d")).toEqual({ every: 1, unit: "d" });
    expect(parseTaskRepeat("12m")).toEqual({ every: 12, unit: "m" });
    expect(parseTaskRepeat("0d")).toBeNull();
    expect(parseTaskRepeat("1h")).toBeNull();
    expect(parseTaskRepeat(null)).toBeNull();
  });

  it("moves on by one repeat when checked on time or early", () => {
    expect(nextTaskDate("2026-11-11", every("1d"), at("2026-11-11T10:00"))).toBe("2026-11-12");
    expect(nextTaskDate("2026-11-11", every("1w"), at("2026-11-11T10:00"))).toBe("2026-11-18");
    expect(nextTaskDate("2026-11-20", every("1w"), at("2026-11-11T10:00"))).toBe("2026-11-27");
    expect(nextTaskDate("2026-11-11", every("1y"), at("2026-11-11T10:00"))).toBe("2027-11-11");
  });

  it("skips the repeats missed, keeping its rhythm", () => {
    // Every two weeks from a Monday: the next Monday of the rhythm after today.
    expect(nextTaskDate("2026-10-05", every("2w"), at("2026-11-11T10:00"))).toBe("2026-11-16");
    expect(nextTaskDate("2020-01-01", every("1d"), at("2026-11-11T10:00"))).toBe("2026-11-12");
    expect(nextTaskDate("2016-01-15", every("1m"), at("2026-11-11T10:00"))).toBe("2026-11-15");
    expect(nextTaskDate("2016-01-15", every("1m"), at("2026-11-16T10:00"))).toBe("2026-12-15");
  });

  it("keeps the day of the month when it can", () => {
    expect(nextTaskDate("2027-01-31", every("1m"), at("2027-01-31T10:00"))).toBe("2027-02-28");
    expect(nextTaskDate("2027-01-31", every("1m"), at("2027-03-01T10:00"))).toBe("2027-03-31");
    expect(nextTaskDate("2028-02-29", every("1y"), at("2028-02-29T10:00"))).toBe("2029-02-28");
    expect(nextTaskDate("2026-11-30", every("3m"), at("2026-11-30T10:00"))).toBe("2027-02-28");
  });

  it("keeps the time, and counts a time later today as still to come", () => {
    expect(nextTaskDate("2026-11-11T09:00", every("1d"), at("2026-11-11T10:00"))).toBe("2026-11-12T09:00");
    expect(nextTaskDate("2026-11-09T18:00", every("1d"), at("2026-11-11T10:00"))).toBe("2026-11-11T18:00");
  });
});

// The date in the text, as in the editor (without its view).
const DateMention = TiptapNode.create({
  name: "dateMention",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes: () => ({
    id: { default: null },
    date: { default: null },
    reminder: { default: null },
    remindAt: { default: null },
    remindUser: { default: null },
  }),
});
const schema = getSchema([StarterKit, TaskList, RepeatingTaskItem.configure({ nested: true }), DateMention]);

const date = (d: string, reminder: number | null = null) => ({
  type: "dateMention",
  attrs: {
    id: "d",
    date: d,
    reminder,
    remindUser: reminder === null ? null : "u1",
    remindAt: reminder === null ? null : reminderTime(d, reminder).toISOString(),
  },
});
const task = (attrs: { checked?: boolean; repeat?: string | null }, content: object[], nested: object[] = []) => ({
  type: "taskItem",
  attrs: { checked: false, repeat: null, ...attrs },
  content: [{ type: "paragraph", content }, ...(nested.length ? [{ type: "taskList", content: nested }] : [])],
});
const docOf = (...items: object[]) => schema.nodeFromJSON({ type: "doc", content: [{ type: "taskList", content: items }] });

/** Applies the change, then what the extension adds to it. */
function run(doc: Node, change: (tr: Transaction) => void, now = at("2026-11-11T10:00")) {
  const state = EditorState.create({ schema, doc });
  const tr = state.tr;
  change(tr);
  const next = state.apply(tr);
  const extra = next.tr;
  const changed = advanceRepeatingTasks([tr], state.doc, next.doc, extra, now);
  return { changed, doc: changed ? next.apply(extra).doc : next.doc };
}
/** Checks the first to-do (the box's own change: its attributes). */
const check = (tr: Transaction) => tr.setNodeMarkup(1, undefined, { ...tr.doc.nodeAt(1)!.attrs, checked: true });
const firstTask = (doc: Node) => doc.firstChild!.firstChild!;
const firstDate = (doc: Node) => firstTask(doc).firstChild!.child(1).attrs;

describe("checking a repeating to-do", () => {
  it("unchecks it and moves its date and reminder on", () => {
    const { changed, doc } = run(docOf(task({ repeat: "1w" }, [{ type: "text", text: "Bins " }, date("2026-11-11", 0)])), check);
    expect(changed).toBe(true);
    expect(firstTask(doc).attrs.checked).toBe(false);
    expect(firstDate(doc)).toMatchObject({ date: "2026-11-18", reminder: 0, remindUser: "u1", remindAt: reminderTime("2026-11-18", 0).toISOString() });
  });

  it("only unchecks one without a date", () => {
    const { changed, doc } = run(docOf(task({ repeat: "1d" }, [{ type: "text", text: "Stretch" }])), check);
    expect(changed).toBe(true);
    expect(firstTask(doc).attrs.checked).toBe(false);
  });

  it("leaves the dates of the to-dos nested under it alone", () => {
    const nested = task({}, [{ type: "text", text: "Sub " }, date("2026-11-11")]);
    const { doc } = run(docOf(task({ repeat: "1d" }, [{ type: "text", text: "Main" }], [nested])), check);
    expect(firstTask(doc).child(1).firstChild!.firstChild!.child(1).attrs.date).toBe("2026-11-11");
  });

  it("leaves other to-dos checked", () => {
    const { changed, doc } = run(docOf(task({}, [{ type: "text", text: "Once " }, date("2026-11-11")])), check);
    expect(changed).toBe(false);
    expect(firstTask(doc).attrs.checked).toBe(true);
  });

  it("does nothing for typing in a checked repeating to-do", () => {
    const { changed } = run(docOf(task({ repeat: "1d", checked: true }, [{ type: "text", text: "Done" }])), (tr) => tr.insertText("!", 3));
    expect(changed).toBe(false);
  });

  it("doesn't take a pasted checked one for one just checked", () => {
    const doc = docOf(task({ repeat: "1d" }, [{ type: "text", text: "A" }]));
    const pasted = schema.nodeFromJSON(task({ repeat: "1d", checked: true }, [{ type: "text", text: "B" }]));
    const { changed } = run(doc, (tr) => tr.insert(1, pasted));
    expect(changed).toBe(false);
  });
});
