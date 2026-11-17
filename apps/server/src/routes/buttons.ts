import { randomBytes } from "node:crypto";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { publicLinkProtectionInput, publicLinkUnlockInput, runButtonInput, t } from "@nootion/shared";
import { HttpError, notFound, parseBody, requireUser } from "../http.js";
import { actingAs, findButtonBlock, requestRunner, resolveButton, runButton } from "../buttons.js";
import { publicForms, users } from "../db/schema.js";
import { getChain, isTrashed, requirePageRole } from "../permissions.js";
import { getPageMeta } from "../pages.js";
import { audit } from "../audit.js";
import { verifyPassword } from "../auth/password.js";
import { isExpired, protectionInfo, protectionUpdate, requireOpen, setUnlockCookie, tooManyAttempts, unlockLimiter } from "../public-access.js";

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
  const linkInfo = (link: typeof publicForms.$inferSelect | undefined) => ({
    link: link ? { token: link.token, url: `${app.config.appUrl}/f/${link.token}`, ...protectionInfo(link) } : null,
  });

  // The public link of a button's form: people without an account fill it in, and its steps run as the link's author.
  app.get<{ Querystring: { pageId?: string; blockId?: string } }>("/public-link", async (req) => {
    const user = requireUser(req);
    const { pageId, blockId } = parseBody(blockInput, req.query);
    requirePageRole(db, user.id, pageId, "editor");
    return linkInfo(findLink(pageId, blockId));
  });

  // Makes the link, or changes its password and end date (fields left out keep their value).
  app.put("/public-link", async (req) => {
    const user = requireUser(req);
    const { pageId, blockId, ...input } = parseBody(blockInput.extend(publicLinkProtectionInput.shape), req.body);
    const { page } = requirePageRole(db, user.id, pageId, "editor");
    const config = findButtonBlock(app.collab, db, pageId, blockId);
    if (!config) throw notFound();
    if (!config.form) throw new HttpError(400, "no_form", t("button.publicNeedsForm"));
    const protection = await protectionUpdate(input);
    const existing = findLink(pageId, blockId);
    const target = { type: "form" as const, id: pageId, label: page.title };
    const facts = (l: typeof publicForms.$inferSelect) => ({ blockId, password: !!l.passwordHash, expiresAt: l.expiresAt?.toISOString() ?? null });
    if (existing) {
      if (!Object.keys(protection).length) return linkInfo(existing);
      const changed = db.update(publicForms).set(protection).where(eq(publicForms.token, existing.token)).returning().get();
      audit(db, req, { action: "form.public_link_changed", target, details: facts(changed) });
      return linkInfo(changed);
    }
    const link = db
      .insert(publicForms)
      .values({ token: randomBytes(18).toString("base64url"), pageId, blockId, userId: user.id, ...protection })
      .returning()
      .get();
    audit(db, req, { action: "form.public_link_created", target, details: facts(link) });
    return linkInfo(link);
  });

  app.delete("/public-link", async (req) => {
    const user = requireUser(req);
    const { pageId, blockId } = parseBody(blockInput, req.body);
    const { page } = requirePageRole(db, user.id, pageId, "editor");
    const removed = db
      .delete(publicForms)
      .where(and(eq(publicForms.pageId, pageId), eq(publicForms.blockId, blockId)))
      .run().changes;
    if (removed) audit(db, req, { action: "form.public_link_removed", target: { type: "form", id: pageId, label: page.title }, details: { blockId } });
    return { ok: true };
  });
};

/** Public forms, reached by their link without an account. */
export const publicFormRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  const find = (token: string) => {
    const link = db.select().from(publicForms).where(eq(publicForms.token, token)).get();
    if (!link || isTrashed(getChain(db, link.pageId))) throw notFound();
    return link;
  };

  const attempts = unlockLimiter();

  // The visitor types the form's password; the right one is remembered by a cookie for this form only.
  app.post<{ Params: { token: string } }>("/:token/unlock", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const link = find(req.params.token);
    const { password } = parseBody(publicLinkUnlockInput, req.body);
    if (isExpired(link)) return requireOpen(app, req, reply, "form", link);
    if (!link.passwordHash) return { ok: true };
    if (!attempts(link.token)) throw tooManyAttempts();
    if (!(await verifyPassword(link.passwordHash, password))) throw new HttpError(403, "bad_password", t("public.badPassword"));
    setUnlockCookie(app, reply, "form", link);
    return { ok: true };
  });

  const resolve = (req: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply) => {
    const link = find(req.params.token);
    requireOpen(app, req, reply, "form", link);
    const config = findButtonBlock(app.collab, db, link.pageId, link.blockId);
    const author = db.select().from(users).where(eq(users.id, link.userId)).get();
    if (!config?.form || !author || author.disabled) throw notFound();
    return { link, config, form: config.form, author };
  };

  app.get<{ Params: { token: string } }>("/:token", async (req, reply) => {
    const { link, config, form } = resolve(req, reply);
    return {
      title: form.title || config.label || getPageMeta(db, link.pageId)?.title || "",
      submitLabel: config.label,
      color: config.color,
      fields: form.fields,
    };
  });

  app.post<{ Params: { token: string } }>("/:token", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { link, config, author } = resolve(req, reply);
    const input = parseBody(runButtonInput.omit({ source: true }), req.body);
    const ctx = { config, pageId: link.pageId, row: null };
    await runButton(app, actingAs(author, req.headers["accept-language"]), ctx, {
      ...input,
      source: { kind: "block", pageId: link.pageId, blockId: link.blockId },
    });
    return { ok: true };
  });
};
