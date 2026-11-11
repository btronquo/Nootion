import { Extension, type Editor } from "@tiptap/core";
import { TaskItem } from "@tiptap/extension-list";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Mapping, ReplaceStep } from "@tiptap/pm/transform";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { nextTaskDate, parseTaskRepeat, reminderTime, t, type TaskRepeat } from "@nootion/shared";

/** "Every week", "Every 2 months": how a to-do repeats, in words. */
export function taskRepeatLabel(repeat: TaskRepeat): string {
  const key = { d: "task.repeatDays", w: "task.repeatWeeks", m: "task.repeatMonths", y: "task.repeatYears" } as const;
  return t(key[repeat.unit], { count: repeat.every });
}

/** To-dos, with how they repeat ("1w"…, see parseTaskRepeat). A to-do made by Enter on a repeating one doesn't repeat. */
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
          return repeat ? { "data-repeat": attrs.repeat, "data-repeat-label": taskRepeatLabel(repeat) } : {};
        },
      },
    };
  },
});

export function setTaskRepeat(editor: Editor, pos: number, repeat: string | null) {
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      const node = tr.doc.nodeAt(pos);
      if (node?.type.name !== "taskItem") return false;
      tr.setNodeAttribute(pos, "repeat", repeat && parseTaskRepeat(repeat) ? repeat : null);
      return true;
    })
    .run();
}

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

/**
 * Moves a repeating to-do on when it is checked: it unchecks and its date goes to the next time it is due, its reminder
 * with it. Done on this side only, for the changes made here: the others get the result through Yjs.
 */
export function advanceRepeatingTasks(trs: readonly Transaction[], oldDoc: Node, newDoc: Node, tr: Transaction, now = new Date()): boolean {
  const local = trs.filter((t) => t.docChanged && !t.getMeta(ySyncPluginKey)?.isChangeOrigin);
  // Checking a box changes a node's attributes; typing only replaces text, which can't check anything.
  if (!local.length || local.every((t) => t.steps.every((s) => s instanceof ReplaceStep))) return false;
  const mapping = new Mapping();
  for (const t of trs) mapping.appendMapping(t.mapping);
  const back = mapping.invert();
  let changed = false;
  newDoc.descendants((node, pos) => {
    if (node.type.name !== "taskItem" || !node.attrs.checked) return;
    const repeat = parseTaskRepeat(node.attrs.repeat);
    if (!repeat) return;
    // The same to-do, unchecked before: a pasted or moved checked one isn't "just checked".
    const before = oldDoc.nodeAt(back.map(pos));
    if (before?.type.name !== "taskItem" || before.attrs.checked || before.attrs.repeat !== node.attrs.repeat || before.textContent !== node.textContent)
      return;
    const date = firstDate(node, pos);
    if (date) {
      const next = nextTaskDate(date.node.attrs.date as string, repeat, now);
      const { reminder, remindUser } = date.node.attrs as { reminder: number | null; remindUser: string | null };
      tr.setNodeMarkup(date.pos, undefined, {
        ...date.node.attrs,
        date: next,
        remindAt: reminder !== null && remindUser ? reminderTime(next, reminder).toISOString() : null,
      });
    }
    tr.setNodeAttribute(pos, "checked", false);
    changed = true;
  });
  return changed;
}

export const TaskRepeatExtension = Extension.create({
  name: "taskRepeat",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("taskRepeat"),
        appendTransaction: (trs, oldState, newState) => {
          const tr = newState.tr;
          return advanceRepeatingTasks(trs, oldState.doc, newState.doc, tr) ? tr : null;
        },
      }),
    ];
  },
});
