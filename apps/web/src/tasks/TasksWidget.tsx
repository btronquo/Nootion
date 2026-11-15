import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ListChecks } from "lucide-react";
import { dayString, t } from "@nootion/shared";
import { empty, isPublic, tool, Widget } from "../editor/HomeWidgets";
import { byDate, TaskLine } from "./TasksPage";
import { useTasks } from "./queries";

/** The first to-dos still to do, from every page: the dated ones first, soonest first. */
export function TasksListView({ node, extension }: NodeViewProps) {
  const hidden = isPublic(extension);
  const query = useTasks({}, { enabled: !hidden });
  const limit = Number(node.attrs.limit) || 5;
  const today = dayString(new Date());
  const sorted = useMemo(() => [...(query.data?.tasks ?? [])].sort(byDate), [query.data]);
  if (hidden) return <NodeViewWrapper />;
  const more = sorted.length - limit;
  return (
    <Widget
      name="tasks"
      icon={<ListChecks size={14} />}
      title={t("tasks.title")}
      tools={
        <Link to="/tasks" className={tool}>
          {t("tasks.seeAll")}
        </Link>
      }
    >
      {query.data && !sorted.length && <p className={empty}>{t("widget.tasksEmpty")}</p>}
      {sorted.length > 0 && (
        <ul className="nt-tasks -mx-3 list-none! pl-0!" data-tasks-widget>
          {sorted.slice(0, limit).map((task) => (
            <TaskLine key={`${task.pageId}/${task.key}`} task={task} today={today} showPage />
          ))}
        </ul>
      )}
      {more > 0 && (
        <Link to="/tasks" className="mt-1 inline-block text-xs text-neutral-500 hover:underline">
          {t("tasks.more", { count: more })}
        </Link>
      )}
    </Widget>
  );
}
