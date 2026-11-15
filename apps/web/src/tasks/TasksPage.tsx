import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AtSign, CalendarDays, ChevronRight, FileText, Repeat } from "lucide-react";
import { dayString, parseTaskRepeat, t, taskDateGroup, TASK_DATE_GROUPS, type TaskEntry, type TaskDateGroup } from "@nootion/shared";
import { formatMentionDate } from "../lib/reminders";
import { pageIcon } from "../lib/icons";
import { pageTitle } from "../lib/tree";
import { useWorkspaces } from "../lib/queries";
import { Select } from "../components/ui";
import { taskRepeatLabel } from "../editor/taskRepeat";
import { taskHref, useCheckTask, useTasks } from "./queries";

type GroupBy = "page" | "date";
const GROUP_KEY = "nootion.tasks.groupBy";

function savedGroupBy(): GroupBy {
  try {
    return localStorage.getItem(GROUP_KEY) === "date" ? "date" : "page";
  } catch {
    return "page";
  }
}

/** Soonest first, to-dos without a date last; same day: the order of their pages. */
export function byDate(a: TaskEntry, b: TaskEntry): number {
  if (!a.date || !b.date) return a.date ? -1 : b.date ? 1 : 0;
  return a.date.localeCompare(b.date);
}

/** One to-do: its box, its text (a link to it in its page), its date, whether it repeats or mentions the reader. */
export function TaskLine({ task, showPage, today }: { task: TaskEntry; showPage?: boolean; today: string }) {
  const check = useCheckTask();
  const overdue = !task.checked && !!task.date && task.date.slice(0, 10) < today;
  const repeat = parseTaskRepeat(task.repeat);
  return (
    <li className="group flex items-start gap-2.5 px-3 py-1.5 text-sm" data-task={`${task.pageId}/${task.key}`} data-checked={task.checked || undefined}>
      <input
        type="checkbox"
        className="mt-[1px]"
        checked={task.checked}
        disabled={!task.canEdit}
        title={task.canEdit ? undefined : t("tasks.readOnly")}
        aria-label={task.text || t("common.untitled")}
        onChange={(e) => void check(task, e.target.checked)}
      />
      <span className="min-w-0 flex-1">
        <Link
          to={taskHref(task)}
          title={t("tasks.open")}
          className={`break-words hover:underline ${task.checked ? "text-neutral-400 line-through dark:text-neutral-500" : ""}`}
        >
          {task.text || <span className="text-neutral-400">{t("common.untitled")}</span>}
        </Link>
        {(task.date || repeat || task.mentionsMe || showPage) && (
          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-neutral-500">
            {task.date && (
              <span className={`flex items-center gap-1 ${overdue ? "font-medium text-red-600 dark:text-red-400" : ""}`} data-task-date>
                <CalendarDays size={12} /> {formatMentionDate(task.date)}
              </span>
            )}
            {repeat && (
              <span className="flex items-center gap-1" title={taskRepeatLabel(repeat)}>
                <Repeat size={12} /> <span className="hidden sm:inline">{taskRepeatLabel(repeat)}</span>
              </span>
            )}
            {task.mentionsMe && (
              <span className="flex items-center text-blue-600 dark:text-blue-400" title={t("tasks.mine")}>
                <AtSign size={12} />
              </span>
            )}
            {showPage && (
              <Link to={`/page/${task.pageId}`} className="flex min-w-0 items-center gap-1 hover:text-neutral-800 dark:hover:text-neutral-200">
                <span className="shrink-0">{pageIcon(task.pageIcon) ?? <FileText size={12} />}</span>
                <span className="truncate">{pageTitle(task.pageTitle)}</span>
              </Link>
            )}
          </span>
        )}
      </span>
    </li>
  );
}

const box = "nt-tasks divide-y divide-neutral-100 rounded-lg border border-neutral-200 dark:divide-neutral-800/70 dark:border-neutral-800";

function Toggle({ on, onChange, children }: { on: boolean; onChange: (on: boolean) => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors ${
        on
          ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-300"
          : "border-neutral-300 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      }`}
    >
      {children}
    </button>
  );
}

/** "Tasks": every to-do still to do in the pages one can read, by page or by date, with those checked lately. */
export function TasksPage() {
  const [groupBy, setGroupBy] = useState<GroupBy>(savedGroupBy);
  const [workspaceId, setWorkspaceId] = useState("");
  const [mine, setMine] = useState(false);
  const [dated, setDated] = useState(false);
  const workspaces = useWorkspaces();
  const query = useTasks({ workspaceId: workspaceId || undefined, mine, dated });
  const today = dayString(new Date());
  const tasks = useMemo(() => query.data?.tasks ?? [], [query.data]);
  const done = query.data?.done ?? [];
  const filtered = !!workspaceId || mine || dated;

  const changeGroupBy = (g: GroupBy) => {
    setGroupBy(g);
    try {
      localStorage.setItem(GROUP_KEY, g);
    } catch {
      // Private browsing: only for now.
    }
  };

  const groups = useMemo(() => {
    if (groupBy === "page") {
      const byPage = new Map<string, TaskEntry[]>();
      for (const task of tasks) byPage.set(task.pageId, [...(byPage.get(task.pageId) ?? []), task]);
      return [...byPage.values()].map((list) => ({ id: list[0]!.pageId, page: list[0]!, list }));
    }
    const byGroup = new Map<TaskDateGroup, TaskEntry[]>();
    for (const task of [...tasks].sort(byDate)) {
      const g = taskDateGroup(task.date, today);
      byGroup.set(g, [...(byGroup.get(g) ?? []), task]);
    }
    return TASK_DATE_GROUPS.filter((g) => byGroup.has(g)).map((g) => ({ id: g, group: g, list: byGroup.get(g)! }));
  }, [tasks, groupBy, today]);

  return (
    <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8 sm:py-12" data-tasks-page>
      <h1 className="mb-1 text-2xl font-bold">{t("tasks.title")}</h1>
      <p className="mb-5 text-sm text-neutral-500">{query.data ? t("tasks.count", { count: tasks.length }) : t("common.loading")}</p>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-neutral-300 p-0.5 text-sm dark:border-neutral-700" role="group">
          {(["page", "date"] as const).map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={groupBy === g}
              onClick={() => changeGroupBy(g)}
              className={`rounded px-2.5 py-1 ${groupBy === g ? "bg-neutral-200 font-medium dark:bg-neutral-700" : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"}`}
            >
              {g === "page" ? t("tasks.byPage") : t("tasks.byDate")}
            </button>
          ))}
        </div>
        {(workspaces.data?.length ?? 0) > 1 && (
          <Select value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} aria-label={t("library.space")}>
            <option value="">{t("tasks.allSpaces")}</option>
            {workspaces.data!.map((w) => (
              <option key={w.id} value={w.id}>
                {w.kind === "personal" ? t("workspace.personal") : w.name}
              </option>
            ))}
          </Select>
        )}
        <Toggle on={mine} onChange={setMine}>
          <AtSign size={14} /> {t("tasks.mine")}
        </Toggle>
        <Toggle on={dated} onChange={setDated}>
          <CalendarDays size={14} /> {t("tasks.dated")}
        </Toggle>
      </div>

      {query.data?.truncated && <p className="mb-4 text-sm text-amber-700 dark:text-amber-400">{t("tasks.truncated", { count: tasks.length })}</p>}
      {query.isSuccess && tasks.length === 0 && (
        <p
          className="mb-8 rounded-lg border border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-500 dark:border-neutral-700"
          data-tasks-empty
        >
          {filtered ? t("tasks.emptyFiltered") : t("tasks.empty")}
        </p>
      )}

      {groups.map((g) => (
        <section key={g.id} className="mb-6" data-task-group={g.id}>
          {"page" in g && g.page ? (
            <h2 className="mb-1.5 flex items-center gap-2 text-sm font-medium">
              <Link to={`/page/${g.page.pageId}`} className="flex min-w-0 items-center gap-2 hover:underline">
                <span className="w-5 shrink-0 text-center">{pageIcon(g.page.pageIcon) ?? <FileText size={15} className="inline text-neutral-400" />}</span>
                <span className="truncate">{pageTitle(g.page.pageTitle)}</span>
              </Link>
              <span className="text-xs font-normal text-neutral-400">{g.list.length}</span>
            </h2>
          ) : (
            <h2
              className={`mb-1.5 text-sm font-medium uppercase tracking-wide ${"group" in g && g.group === "overdue" ? "text-red-600 dark:text-red-400" : "text-neutral-500"}`}
            >
              {t(`tasks.group.${"group" in g ? g.group! : "none"}`)}{" "}
              <span className="ml-1 text-xs font-normal normal-case text-neutral-400">{g.list.length}</span>
            </h2>
          )}
          <ul className={box}>
            {g.list.map((task) => (
              <TaskLine key={`${task.pageId}/${task.key}`} task={task} today={today} showPage={groupBy === "date"} />
            ))}
          </ul>
        </section>
      ))}

      {done.length > 0 && (
        <details className="group/done mt-10" data-tasks-done>
          <summary className="mb-1.5 flex cursor-pointer list-none items-center gap-1 text-sm font-medium uppercase tracking-wide text-neutral-500">
            <ChevronRight size={14} className="transition-transform group-open/done:rotate-90" />
            {t("tasks.done")} <span className="ml-1 text-xs font-normal normal-case text-neutral-400">{done.length}</span>
          </summary>
          <p className="mb-2 text-xs text-neutral-500">{t("tasks.doneHelp")}</p>
          <ul className={box}>
            {done.map((task) => (
              <TaskLine key={`${task.pageId}/${task.key}`} task={task} today={today} showPage />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
