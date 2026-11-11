import { describe, expect, it } from "vitest";
import { Node as TiptapNode, getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskList } from "@tiptap/extension-list";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import type { Node } from "@tiptap/pm/model";
import { nextTaskDay, parseTaskRepeat, reminderTime, taskRepeatString } from "@nootion/shared";
import { RepeatingTaskItem, noteCheckedTasks, resetDueTasks } from "../src/editor/taskRepeat";

const at = (s: string) => new Date(s);
const every = (s: string) => parseTaskRepeat(s)!;

describe("repeating to-do rules", () => {
  it("reads and writes the rules it knows", () => {
    expect(parseTaskRepeat("2d")).toEqual({ every: 2, unit: "d", weekdays: [], monthDay: null });
    expect(parseTaskRepeat("1w:4,1")).toEqual({ every: 1, unit: "w", weekdays: [1, 4], monthDay: null });
    expect(parseTaskRepeat("1m:10")).toEqual({ every: 1, unit: "m", weekdays: [], monthDay: 10 });
    for (const bad of ["0d", "1h", "1d:3", "1w:7", "1m:32", "1m:1,2", null]) expect(parseTaskRepeat(bad)).toBeNull();
    expect(taskRepeatString({ every: 2, unit: "w", weekdays: [4, 1], monthDay: 3 })).toBe("2w:1,4");
    expect(taskRepeatString({ every: 1, unit: "m", weekdays: [1], monthDay: null })).toBe("1m");
  });

  it("gives the next day it is due, after the day it was checked", () => {
    expect(nextTaskDay(every("1d"), "2026-11-11")).toBe("2026-11-12");
    expect(nextTaskDay(every("2d"), "2026-11-30")).toBe("2026-12-02");
    expect(nextTaskDay(every("1w"), "2026-11-11")).toBe("2026-11-18");
    expect(nextTaskDay(every("1y"), "2028-02-29")).toBe("2029-02-28");
    expect(nextTaskDay(every("1m"), "2027-01-31")).toBe("2027-02-28");
  });

  it("on some days of the week", () => {
    // 2026-11-11 is a Wednesday.
    expect(nextTaskDay(every("1w:1,4"), "2026-11-11")).toBe("2026-11-12");
    expect(nextTaskDay(every("1w:1,4"), "2026-11-12")).toBe("2026-11-16");
    expect(nextTaskDay(every("1w:3"), "2026-11-11")).toBe("2026-11-18");
    // Every two weeks: the rest of this week, then two weeks on.
    expect(nextTaskDay(every("2w:1"), "2026-11-11")).toBe("2026-11-23");
    expect(nextTaskDay(every("2w:5"), "2026-11-11")).toBe("2026-11-13");
  });

  it("on a day of the month", () => {
    expect(nextTaskDay(every("1m:10"), "2026-11-09")).toBe("2026-11-10");
    expect(nextTaskDay(every("1m:10"), "2026-11-10")).toBe("2026-12-10");
    expect(nextTaskDay(every("1m:31"), "2027-01-31")).toBe("2027-02-28");
    expect(nextTaskDay(every("3m:10"), "2026-11-12")).toBe("2027-02-10");
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
const task = (attrs: { checked?: boolean; repeat?: string | null; repeatAt?: string | null }, content: object[], nested: object[] = []) => ({
  type: "taskItem",
  attrs: { checked: false, repeat: null, repeatAt: null, ...attrs },
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
  const changed = noteCheckedTasks([tr], state.doc, next.doc, extra, now);
  return { changed, doc: changed ? next.apply(extra).doc : next.doc };
}
/** Checks (or unchecks) the first to-do: the box's own change, its attributes. */
const check = (checked: boolean) => (tr: Transaction) => tr.setNodeMarkup(1, undefined, { ...tr.doc.nodeAt(1)!.attrs, checked });
const firstTask = (doc: Node) => doc.firstChild!.firstChild!;
const firstDate = (doc: Node) => firstTask(doc).firstChild!.child(1).attrs;

describe("checking a repeating to-do", () => {
  it("stays checked, and notes the day it unchecks", () => {
    const { changed, doc } = run(docOf(task({ repeat: "1m:10" }, [{ type: "text", text: "Send money " }])), check(true));
    expect(changed).toBe(true);
    expect(firstTask(doc).attrs).toMatchObject({ checked: true, repeatAt: "2026-12-10" });
  });

  it("checked before its date, waits for the time after it", () => {
    const { doc } = run(docOf(task({ repeat: "1w" }, [{ type: "text", text: "Bins " }, date("2026-11-13")])), check(true));
    expect(firstTask(doc).attrs.repeatAt).toBe("2026-11-20");
  });

  it("unchecked by hand, forgets the day", () => {
    const { doc } = run(docOf(task({ repeat: "1d", checked: true, repeatAt: "2026-11-12" }, [{ type: "text", text: "Stretch" }])), check(false));
    expect(firstTask(doc).attrs).toMatchObject({ checked: false, repeatAt: null });
  });

  it("leaves other to-dos, typing and pasting alone", () => {
    expect(run(docOf(task({}, [{ type: "text", text: "Once" }])), check(true)).changed).toBe(false);
    expect(run(docOf(task({ repeat: "1d", checked: true }, [{ type: "text", text: "Done" }])), (tr) => tr.insertText("!", 3)).changed).toBe(false);
    const pasted = schema.nodeFromJSON(task({ repeat: "1d", checked: true }, [{ type: "text", text: "B" }]));
    expect(run(docOf(task({ repeat: "1d" }, [{ type: "text", text: "A" }])), (tr) => tr.insert(1, pasted)).changed).toBe(false);
  });
});

describe("when the day comes", () => {
  const reset = (doc: Node, now: string) => {
    const state = EditorState.create({ schema, doc });
    const tr = resetDueTasks(state, at(now));
    return tr ? state.apply(tr).doc : null;
  };

  it("unchecks the to-do and moves its date and reminder to that day", () => {
    const doc = docOf(
      task(
        { repeat: "1m:10", checked: true, repeatAt: "2026-12-10" },
        [{ type: "text", text: "Send money " }, date("2026-11-10T09:30", 0)],
        [task({}, [{ type: "text", text: "Sub " }, date("2026-11-10")])],
      ),
    );
    expect(reset(doc, "2026-12-09T23:59")).toBeNull();
    const after = reset(doc, "2026-12-10T00:01")!;
    expect(firstTask(after).attrs).toMatchObject({ checked: false, repeatAt: null });
    expect(firstDate(after)).toMatchObject({ date: "2026-12-10T09:30", remindAt: reminderTime("2026-12-10T09:30", 0).toISOString() });
    // The nested to-do's date stays.
    expect(firstTask(after).child(1).firstChild!.firstChild!.child(1).attrs.date).toBe("2026-11-10");
    // A day missed (the page wasn't open) is caught up later.
    expect(firstTask(reset(doc, "2027-01-05T08:00")!).attrs.checked).toBe(false);
  });

  it("leaves unchecked to-dos and those without a day alone", () => {
    expect(reset(docOf(task({ repeat: "1d", repeatAt: "2026-11-01" }, [{ type: "text", text: "A" }])), "2026-11-11T10:00")).toBeNull();
    expect(reset(docOf(task({ repeat: "1d", checked: true }, [{ type: "text", text: "B" }])), "2026-11-11T10:00")).toBeNull();
  });
});
