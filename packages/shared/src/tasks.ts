import { z } from "zod";
import { shiftDate } from "./views.js";

/**
 * "Tasks": every to-do (checkbox of the editor) of the pages a person can read, in one list. Database rows keep their
 * own filtered views; this is about the checkboxes written in pages.
 */
export interface TaskEntry {
  pageId: string;
  pageTitle: string;
  pageIcon: string | null;
  workspaceId: string;
  /** Finds the to-do in its page: "b:<blockId>" when it has a block id of its own, else "i:<n>", its rank in the page. */
  key: string;
  /** Its line, without its date. */
  text: string;
  checked: boolean;
  /** The first date written in its line ("2026-11-20" or "2026-11-20T09:00"), if any. */
  date: string | null;
  /** It mentions the person asking. */
  mentionsMe: boolean;
  /** How it repeats (see parseTaskRepeat), if it does. */
  repeat: string | null;
  /** When it was checked, for the ones checked lately. */
  checkedAt: string | null;
  /** The person can check it (they may edit the page). */
  canEdit: boolean;
}

export interface TasksResponse {
  /** To-dos still to do, page by page (the pages changed most recently first), in the order of each page. */
  tasks: TaskEntry[];
  /** To-dos checked in the last days, the most recent first. */
  done: TaskEntry[];
  /** There were more to-dos than listed. */
  truncated: boolean;
}

/** How many days "Done lately" goes back. */
export const TASKS_DONE_DAYS = 7;

export const checkTaskInput = z.object({
  pageId: z.string().min(1).max(100),
  key: z.string().min(1).max(200),
  /** The to-do's text as the list showed it: if the page changed meanwhile, nothing is checked. */
  text: z.string().max(2000),
  checked: z.boolean(),
  /** The day it is for the person ("YYYY-MM-DD"), for a repeating to-do's next day. */
  today: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type CheckTaskInput = z.infer<typeof checkTaskInput>;

export const TASK_DATE_GROUPS = ["overdue", "today", "week", "later", "none"] as const;
export type TaskDateGroup = (typeof TASK_DATE_GROUPS)[number];

/** Where a to-do goes when the list is grouped by date: overdue, today, the next 7 days, later, or no date. */
export function taskDateGroup(date: string | null, today: string): TaskDateGroup {
  if (!date) return "none";
  const day = date.slice(0, 10);
  if (day < today) return "overdue";
  if (day === today) return "today";
  if (day <= shiftDate(today, 7)) return "week";
  return "later";
}
