import type { FastifyPluginAsync } from "fastify";
import { checkTaskInput, t } from "@nootion/shared";
import { HttpError, parseBody, requireUser } from "../http.js";
import { requirePageRole } from "../permissions.js";
import { editContent, readContent } from "../collab.js";
import { assertUnlocked } from "../locks.js";
import { findTaskByKey, findTasks, listTasks, noteTaskChecked, setTaskChecked } from "../tasks.js";

/** "Tasks": the to-dos of every page one can read, checked from the list. */
export const taskRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  app.get("/tasks", async (req) => {
    const user = requireUser(req);
    const q = req.query as Record<string, string | undefined>;
    return listTasks(db, user.id, {
      workspaceId: q.workspaceId || undefined,
      mine: q.mine === "1" || q.mine === "true",
      dated: q.dated === "1" || q.dated === "true",
    });
  });

  /** Checks or unchecks a to-do in its page, as if done there: people with the page open see it at once. */
  app.post("/tasks/check", async (req) => {
    const user = requireUser(req);
    const input = parseBody(checkTaskInput, req.body);
    const { page } = requirePageRole(db, user.id, input.pageId, "editor");
    assertUnlocked(page);
    const task = findTaskByKey(findTasks(readContent(app.collab, db, input.pageId)), input.key);
    // The page changed since the list was shown: nothing is checked by mistake.
    if (!task || task.text !== input.text) throw new HttpError(409, "task_changed", t("tasks.changed"));
    let ok = true;
    await editContent(app.collab, db, input.pageId, (doc) => {
      ok = setTaskChecked(doc, task, input.checked, input.today);
    });
    if (!ok) throw new HttpError(409, "task_changed", t("tasks.changed"));
    noteTaskChecked(db, input.pageId, task.position, input.checked);
    return { ok: true };
  });
};
