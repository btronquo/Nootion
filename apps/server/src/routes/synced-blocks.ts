import type { FastifyPluginAsync } from "fastify";
import { createSyncedBlockInput, t } from "@nootion/shared";
import { HttpError, notFound, parseBody, requireUser } from "../http.js";
import { requirePageRole } from "../permissions.js";
import { assertUnlocked } from "../locks.js";
import { checkContent } from "../markdown-in.js";
import type { ProseMirrorNode } from "../collab.js";
import { createSyncedBlock, listSyncedBlocks, syncedBlockInfo } from "../synced-blocks.js";

/** Synced blocks (synced-blocks.ts): made from a page, then shown in others. */
export const syncedBlockRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  // A new synced block in a page, starting with the given blocks (those turned into it), or empty.
  app.post<{ Params: { pageId: string } }>("/pages/:pageId/synced-blocks", async (req) => {
    const user = requireUser(req);
    const { page } = requirePageRole(db, user.id, req.params.pageId, "editor");
    if (page.kind === "database") throw new HttpError(400, "not_a_page", t("error.notAPage"));
    assertUnlocked(page);
    const input = parseBody(createSyncedBlockInput, req.body ?? {});
    let content: ProseMirrorNode[] | undefined;
    if (input.content?.length) {
      try {
        content = checkContent({ type: "doc", content: input.content }, user.id).content;
      } catch (e) {
        throw new HttpError(400, "bad_content", t("error.badContent", { reason: (e as Error).message }));
      }
    }
    // Made inside a synced block: it belongs to the page that block lives in.
    const host = page.kind === "block" && page.parentId ? requirePageRole(db, user.id, page.parentId, "viewer").page : page;
    const id = await createSyncedBlock(app.collab, db, host, user.id, content);
    return { id };
  });

  // Synced blocks the user can read, to show one more time ("/synced").
  app.get<{ Querystring: { q?: string } }>("/synced-blocks", async (req) => {
    const user = requireUser(req);
    return { blocks: listSyncedBlocks(db, user.id, String(req.query.q ?? "").slice(0, 200)) };
  });

  // One synced block: its content, where it lives and the pages it is shown in. 404 when the user can't read it.
  app.get<{ Params: { id: string } }>("/synced-blocks/:id", async (req) => {
    const user = requireUser(req);
    const block = syncedBlockInfo(app.collab, db, user.id, req.params.id);
    if (!block) throw notFound();
    return { block };
  });
};
