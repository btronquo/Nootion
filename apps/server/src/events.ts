import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { ServerResponse } from "node:http";
import type { Db } from "./db/index.js";
import { requireUser } from "./http.js";

/**
 * What the open tabs are told, so that they refetch it:
 * - "pages": the page tree of a space changed (a page added, renamed, moved, trashed…);
 * - "access": the spaces or the pages shared with you changed.
 * Only the fact that something changed is sent, never what: the tab asks for it with its usual access checks.
 */
export type LiveEvent = { type: "pages"; workspaceId: string } | { type: "access" };

/**
 * Tells the people concerned when the page tree changes. The changes are caught by triggers of the database itself,
 * so every way of changing pages (the interface, the API, agents, buttons, automations, imports) is covered.
 */
export function createLiveEvents(db: Db) {
  const sqlite = db.$client;
  const clients = new Map<string, Set<ServerResponse>>();
  const changedSpaces = new Set<string>();
  const changedUsers = new Set<string>();
  const renamedSpaces = new Set<string>();
  let timer: NodeJS.Timeout | null = null;

  const flush = () => {
    timer = null;
    const spaces = [...changedSpaces];
    const renamed = [...renamedSpaces];
    changedSpaces.clear();
    renamedSpaces.clear();
    if (!clients.size) return changedUsers.clear();
    const audience = sqlite.prepare(
      `SELECT user_id AS userId FROM workspace_members WHERE workspace_id = ?
       UNION SELECT pp.user_id FROM page_permissions pp JOIN pages p ON p.id = pp.page_id WHERE p.workspace_id = ?`,
    );
    const members = sqlite.prepare("SELECT user_id AS userId FROM workspace_members WHERE workspace_id = ?");
    for (const id of renamed) for (const { userId } of members.all(id) as { userId: string }[]) changedUsers.add(userId);
    const users = [...changedUsers];
    changedUsers.clear();
    for (const workspaceId of spaces) {
      for (const { userId } of audience.all(workspaceId, workspaceId) as { userId: string }[]) send(userId, { type: "pages", workspaceId });
    }
    for (const userId of users) send(userId, { type: "access" });
  };

  const changed = (kind: string, id: string | null) => {
    if (!id) return null;
    (kind === "space" ? changedSpaces : kind === "renamed" ? renamedSpaces : changedUsers).add(id);
    // A burst of changes (an import, a copied template) makes one message.
    timer ??= setTimeout(flush, 150);
    return null;
  };
  sqlite.function("nootion_changed", { deterministic: false, varargs: false }, changed);

  // Temporary triggers: they live with this connection, and need no migration.
  const tree = "title, icon, parent_id, position, deleted_at, workspace_id, kind";
  sqlite.exec(`
    CREATE TEMP TRIGGER IF NOT EXISTS live_page_insert AFTER INSERT ON main.pages WHEN NEW.kind <> 'row'
      BEGIN SELECT nootion_changed('space', NEW.workspace_id); END;
    CREATE TEMP TRIGGER IF NOT EXISTS live_page_update AFTER UPDATE OF ${tree} ON main.pages
      WHEN NEW.kind <> 'row' OR OLD.kind <> 'row'
      BEGIN SELECT nootion_changed('space', OLD.workspace_id), nootion_changed('space', NEW.workspace_id); END;
    CREATE TEMP TRIGGER IF NOT EXISTS live_page_delete AFTER DELETE ON main.pages WHEN OLD.kind <> 'row'
      BEGIN SELECT nootion_changed('space', OLD.workspace_id); END;
    CREATE TEMP TRIGGER IF NOT EXISTS live_space_rename AFTER UPDATE OF name ON main.workspaces
      BEGIN SELECT nootion_changed('renamed', NEW.id); END;
    CREATE TEMP TRIGGER IF NOT EXISTS live_member_insert AFTER INSERT ON main.workspace_members
      BEGIN SELECT nootion_changed('user', NEW.user_id); END;
    CREATE TEMP TRIGGER IF NOT EXISTS live_member_update AFTER UPDATE ON main.workspace_members
      BEGIN SELECT nootion_changed('user', NEW.user_id); END;
    CREATE TEMP TRIGGER IF NOT EXISTS live_member_delete AFTER DELETE ON main.workspace_members
      BEGIN SELECT nootion_changed('user', OLD.user_id); END;
    CREATE TEMP TRIGGER IF NOT EXISTS live_share_insert AFTER INSERT ON main.page_permissions
      BEGIN SELECT nootion_changed('user', NEW.user_id); END;
    CREATE TEMP TRIGGER IF NOT EXISTS live_share_update AFTER UPDATE ON main.page_permissions
      BEGIN SELECT nootion_changed('user', NEW.user_id); END;
    CREATE TEMP TRIGGER IF NOT EXISTS live_share_delete AFTER DELETE ON main.page_permissions
      BEGIN SELECT nootion_changed('user', OLD.user_id); END;
  `);

  function send(userId: string, event: LiveEvent) {
    for (const res of clients.get(userId) ?? []) res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  function connect(userId: string, res: ServerResponse) {
    const set = clients.get(userId) ?? new Set();
    set.add(res);
    clients.set(userId, set);
    return () => {
      set.delete(res);
      if (!set.size) clients.delete(userId);
    };
  }

  function stop() {
    if (timer) clearTimeout(timer);
    for (const set of clients.values()) for (const res of set) res.end();
    clients.clear();
  }

  return { connect, stop, flush };
}

export type LiveEvents = ReturnType<typeof createLiveEvents>;

/** GET /api/events: a stream of server-sent events for the signed-in person. */
export const liveEventRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get("/events", (req, reply) => {
    const user = requireUser(req);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Tells nginx not to hold the stream back.
      "x-accel-buffering": "no",
    });
    res.write("retry: 5000\n\n");
    const disconnect = app.liveEvents.connect(user.id, res);
    // Keeps proxies from closing a quiet connection.
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.raw.on("close", () => {
      clearInterval(ping);
      disconnect();
    });
  });
};
