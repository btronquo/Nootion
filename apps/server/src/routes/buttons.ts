import { randomBytes } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { runButtonInput, t } from "@nootion/shared";
import { HttpError, notFound, parseBody, requireUser } from "../http.js";
import { actingAs, findButtonBlock, requestRunner, resolveButton, runButton } from "../buttons.js";
import { publicForms, users } from "../db/schema.js";
import { getChain, isTrashed, requirePageRole } from "../permissions.js";
import { getPageMeta } from "../pages.js";

const blockInput = z.object({ pageId: z.string().min(1), blockId: z.string().min(1) });

/** Buttons in pages and databases: their steps run on the server, as the person clicking. */
export const buttonRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  app.post("/run", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    const user = requireUser(req);
    const input = parseBody(runButtonInput, req.body);
    return runButton(app, requestRunner(req), resolveButton(app, user, input.source), input);
  });

  const findLink = (pageId: string, blockId: string) =>
    db
      .select()
      .from(publicForms)
      .where(and(eq(publicForms.pageId, pageId), eq(publicForms.blockId, blockId)))
      .get();
  const linkInfo = (link: { token: string } | undefined) => ({ link: link ? { token: link.token, url: `${app.config.appUrl}/f/${link.token}` } : null });

  // The public link of a button's form: people without an account fill it in, and its steps run as the link's author.
  app.get<{ Querystring: { pageId?: string; blockId?: string } }>("/public-link", async (req) => {
    const user = requireUser(req);
    const { pageId, blockId } = parseBody(blockInput, req.query);
    requirePageRole(db, user.id, pageId, "editor");
    return linkInfo(findLink(pageId, blockId));
  });

  app.put("/public-link", async (req) => {
    const user = requireUser(req);
    const { pageId, blockId } = parseBody(blockInput, req.body);
    requirePageRole(db, user.id, pageId, "editor");
    const config = findButtonBlock(app.collab, db, pageId, blockId);
    if (!config) throw notFound();
    if (!config.form) throw new HttpError(400, "no_form", t("button.publicNeedsForm"));
    const existing = findLink(pageId, blockId);
    if (existing) return linkInfo(existing);
    const link = db
      .insert(publicForms)
      .values({ token: randomBytes(18).toString("base64url"), pageId, blockId, userId: user.id })
      .returning()
      .get();
    return linkInfo(link);
  });

  app.delete("/public-link", async (req) => {
    const user = requireUser(req);
    const { pageId, blockId } = parseBody(blockInput, req.body);
    requirePageRole(db, user.id, pageId, "editor");
    db.delete(publicForms)
      .where(and(eq(publicForms.pageId, pageId), eq(publicForms.blockId, blockId)))
      .run();
    return { ok: true };
  });
};

/** Public forms, reached by their link without an account. */
export const publicFormRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  const resolve = (token: string) => {
    const link = db.select().from(publicForms).where(eq(publicForms.token, token)).get();
    if (!link || isTrashed(getChain(db, link.pageId))) throw notFound();
    const config = findButtonBlock(app.collab, db, link.pageId, link.blockId);
    const author = db.select().from(users).where(eq(users.id, link.userId)).get();
    if (!config?.form || !author || author.disabled) throw notFound();
    return { link, config, form: config.form, author };
  };

  app.get<{ Params: { token: string } }>("/:token", async (req) => {
    const { link, config, form } = resolve(req.params.token);
    return {
      title: form.title || config.label || getPageMeta(db, link.pageId)?.title || "",
      submitLabel: config.label,
      color: config.color,
      fields: form.fields,
    };
  });

  app.post<{ Params: { token: string } }>("/:token", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const { link, config, author } = resolve(req.params.token);
    const input = parseBody(runButtonInput.omit({ source: true }), req.body);
    const ctx = { config, pageId: link.pageId, row: null };
    await runButton(app, actingAs(author, req.headers["accept-language"]), ctx, {
      ...input,
      source: { kind: "block", pageId: link.pageId, blockId: link.blockId },
    });
    return { ok: true };
  });
};
