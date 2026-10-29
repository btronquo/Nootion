import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { createInvitationInput, updateUserInput, type InvitationInfo } from "@nootion/shared";
import { and, count, desc, eq, isNull, ne } from "drizzle-orm";
import { deleteUserSessions } from "../auth/sessions.js";
import { hashToken, newToken } from "../auth/tokens.js";
import { invitations, users } from "../db/schema.js";
import { HttpError, notFound, parseBody, requireAdmin } from "../http.js";
import { toPublicUser } from "../users.js";
import { t } from "@nootion/shared";

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function toInvitationInfo(i: typeof invitations.$inferSelect): InvitationInfo {
  return {
    id: i.id,
    email: i.email,
    role: i.role,
    expiresAt: i.expiresAt.toISOString(),
    usedAt: i.usedAt?.toISOString() ?? null,
    createdAt: i.createdAt.toISOString(),
  };
}

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (req) => {
    requireAdmin(req);
  });

  app.get("/users", async () => ({
    users: app.db.select().from(users).orderBy(users.createdAt).all().map(toPublicUser),
  }));

  app.patch<{ Params: { id: string } }>("/users/:id", async (req) => {
    const admin = requireAdmin(req);
    const input = parseBody(updateUserInput, req.body);
    const target = app.db.select().from(users).where(eq(users.id, req.params.id)).get();
    if (!target) throw notFound();

    const losesAdmin = target.role === "admin" && (input.role === "member" || input.disabled === true);
    if (losesAdmin) {
      const otherAdmins =
        app.db
          .select({ n: count() })
          .from(users)
          .where(and(eq(users.role, "admin"), eq(users.disabled, false), ne(users.id, target.id)))
          .get()?.n ?? 0;
      if (otherAdmins === 0) throw new HttpError(409, "last_admin", t("error.lastAdmin"));
    }
    if (target.id === admin.id && input.disabled) {
      throw new HttpError(409, "self_disable", t("error.selfDisable"));
    }

    const updated = app.db.update(users).set(input).where(eq(users.id, target.id)).returning().get();
    if (input.disabled) deleteUserSessions(app.db, target.id);
    return { user: toPublicUser(updated) };
  });

  app.get("/invitations", async () => ({
    invitations: app.db
      .select()
      .from(invitations)
      .where(isNull(invitations.usedAt))
      .orderBy(desc(invitations.createdAt))
      .all()
      .map(toInvitationInfo),
  }));

  app.post("/invitations", async (req) => {
    const admin = requireAdmin(req);
    const input = parseBody(createInvitationInput, req.body);
    const token = newToken();
    const invitation = app.db
      .insert(invitations)
      .values({
        id: randomUUID(),
        tokenHash: hashToken(token),
        email: input.email ?? null,
        role: input.role,
        createdBy: admin.id,
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      })
      .returning()
      .get();
    // The token is only shown once: only its hash is stored.
    return { invitation: toInvitationInfo(invitation), url: `${app.config.appUrl}/invite/${token}` };
  });

  app.delete<{ Params: { id: string } }>("/invitations/:id", async (req) => {
    app.db.delete(invitations).where(eq(invitations.id, req.params.id)).run();
    return { ok: true };
  });
};
