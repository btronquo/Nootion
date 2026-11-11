import { Extension, type Editor } from "@tiptap/core";
import { TaskItem } from "@tiptap/extension-list";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Mapping, ReplaceStep } from "@tiptap/pm/transform";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { dayString, intlLocale, nextTaskDay, parseTaskRepeat, reminderTime, t, type TaskRepeat } from "@nootion/shared";

/** A weekday's name, 0 = Sunday, in the interface language. */
export function weekdayName(day: number, width: "long" | "short" = "long") {
  // 2023-01-01 was a Sunday.
  return new Date(Date.UTC(2023, 0, 1 + day)).toLocaleDateString(intlLocale(), { weekday: width, timeZone: "UTC" });
}

/** "Every week", "Every 2 weeks on Monday and Thursday", "Every month on the 10th": how a to-do repeats, in words. */
export function taskRepeatLabel(repeat: TaskRepeat): string {
  const key = { d: "task.repeatDays", w: "task.repeatWeeks", m: "task.repeatMonths", y: "task.repeatYears" } as const;
  const every = t(key[repeat.unit], { count: repeat.every });
  if (repeat.unit === "w" && repeat.weekdays.length) {
    // Monday first.
    const days = [...repeat.weekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => weekdayName(d));
    return t("task.repeatOnDays", { every, days: new Intl.ListFormat(intlLocale(), { type: "conjunction" }).format(days) });
  }
  if (repeat.unit === "m" && repeat.monthDay) return t("task.repeatOnMonthDay", { every, day: repeat.monthDay });
  return every;
}

/**
 * To-dos, with how they repeat (`repeat`, see parseTaskRepeat) and, once checked, the day they uncheck (`repeatAt`).
 * A to-do made by Enter on a repeating one doesn't repeat.
 */
export const RepeatingTaskItem = TaskItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      repeat: {
        default: null,
        keepOnSplit: false,
        parseHTML: (el) => (parseTaskRepeat(el.getAttribute("data-repeat")) ? el.getAttribute("data-repeat") : null),
        renderHTML: (attrs) => {
          const repeat = parseTaskRepeat(attrs.repeat);
          return repeat ? { "data-repeat": attrs.repeat, title: taskRepeatLabel(repeat) } : {};
        },
      },
      repeatAt: { default: null, keepOnSplit: false, rendered: false, parseHTML: () => null },
    };
  },
});

/** The first date written in the to-do's own line (not in the to-dos nested under it), with its position. */
function firstDate(item: Node, itemPos: number): { node: Node; pos: number } | null {
  const line = item.firstChild;
  if (!line?.isTextblock) return null;
  let found: { node: Node; pos: number } | null = null;
  line.forEach((child, offset) => {
    if (!found && child.type.name === "dateMention" && child.attrs.date) found = { node: child, pos: itemPos + 2 + offset };
  });
  return found;
}

/** The day a to-do checked today unchecks: after today, or after its date when that is later (checked early). */
export function uncheckDay(item: Node, repeat: TaskRepeat, today: string): string {
  const date = firstDate(item, 0)?.node.attrs.date as string | undefined;
  const day = date?.slice(0, 10);
  return nextTaskDay(repeat, day && day > today ? day : today);
}

export function setTaskRepeat(editor: Editor, pos: number, repeat: string | null, now = new Date()) {
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      const node = tr.doc.nodeAt(pos);
      if (node?.type.name !== "taskItem") return false;
      const rule = repeat ? parseTaskRepeat(repeat) : null;
      // Already checked: it unchecks on the next day the new rule gives.
      tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        repeat: rule ? repeat : null,
        repeatAt: rule && node.attrs.checked ? uncheckDay(node, rule, dayString(now)) : null,
      });
      return true;
    })
    .run();
}

/**
 * Notes when a repeating to-do is checked here the day it will uncheck, and forgets it when it is unchecked by hand.
 * Changes from others come with theirs through Yjs.
 */
export function noteCheckedTasks(trs: readonly Transaction[], oldDoc: Node, newDoc: Node, tr: Transaction, now = new Date()): boolean {
  const local = trs.filter((t) => t.docChanged && !t.getMeta(ySyncPluginKey)?.isChangeOrigin && !t.getMeta(resetKey));
  // Checking a box changes a node's attributes; typing only replaces text, which can't check anything.
  if (!local.length || local.every((t) => t.steps.every((s) => s instanceof ReplaceStep))) return false;
  const mapping = new Mapping();
  for (const t of trs) mapping.appendMapping(t.mapping);
  const back = mapping.invert();
  const today = dayString(now);
  let changed = false;
  newDoc.descendants((node, pos) => {
    if (node.type.name !== "taskItem") return;
    const repeat = parseTaskRepeat(node.attrs.repeat);
    if (!repeat) return;
    // The same to-do, before: a pasted or moved one isn't "just checked".
    const before = oldDoc.nodeAt(back.map(pos));
    if (before?.type.name !== "taskItem" || before.attrs.checked === node.attrs.checked || before.textContent !== node.textContent) return;
    tr.setNodeAttribute(pos, "repeatAt", node.attrs.checked ? uncheckDay(node, repeat, today) : null);
    changed = true;
  });
  return changed;
}

/**
 * Unchecks the repeating to-dos whose day came, and moves their date (and its reminder) to that day. Run where the
 * page is open and editable: everyone who has it open does the same, and Yjs merges it.
 */
export function resetDueTasks(state: EditorState, now = new Date()): Transaction | null {
  const today = dayString(now);
  const tr = state.tr;
  state.doc.descendants((node, pos) => {
    if (node.type.name !== "taskItem" || !node.attrs.checked || !node.attrs.repeatAt || node.attrs.repeatAt > today) return;
    const day = node.attrs.repeatAt as string;
    const date = parseTaskRepeat(node.attrs.repeat) ? firstDate(node, pos) : null;
    if (date) {
      const old = date.node.attrs.date as string;
      const next = old.includes("T") ? `${day}${old.slice(10)}` : day;
      const { reminder, remindUser } = date.node.attrs as { reminder: number | null; remindUser: string | null };
      tr.setNodeMarkup(date.pos, undefined, {
        ...date.node.attrs,
        date: next,
        remindAt: reminder !== null && remindUser ? reminderTime(next, reminder).toISOString() : null,
      });
    }
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: false, repeatAt: null });
  });
  return tr.docChanged ? tr.setMeta(resetKey, true).setMeta("addToHistory", false) : null;
}

const resetKey = new PluginKey("taskRepeatReset");

export const TaskRepeatExtension = Extension.create({
  name: "taskRepeat",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("taskRepeat"),
        appendTransaction: (trs, oldState, newState) => {
          const tr = newState.tr;
          return noteCheckedTasks(trs, oldState.doc, newState.doc, tr) ? tr : null;
        },
      }),
      new Plugin({
        key: resetKey,
        view: (view) => {
          // On opening (and when the page arrives from the server), then every minute: days change while it is open.
          let pending = 0;
          let last = 0;
          const check = () => {
            pending = 0;
            last = Date.now();
            if (view.isDestroyed || !editor.isEditable) return;
            const tr = resetDueTasks(view.state);
            if (tr) view.dispatch(tr);
          };
          const soon = () => {
            if (!pending) pending = window.setTimeout(check, 500);
          };
          const timer = window.setInterval(check, 60_000);
          soon();
          return {
            update: (_view, prev) => {
              // Not on every key typed: the page arriving is what matters.
              if (prev.doc !== view.state.doc && Date.now() - last > 5000) soon();
            },
            destroy: () => {
              window.clearInterval(timer);
              window.clearTimeout(pending);
            },
          };
        },
      }),
    ];
  },
});
