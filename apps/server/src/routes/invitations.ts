import type { FastifyPluginAsync } from "fastify";
import { acceptInvitationInput, t } from "@nootion/shared";
import { and, eq, gt, isNull } from "drizzle-orm";
import { hashToken } from "../auth/tokens.js";
import { invitations, users } from "../db/schema.js";
import { HttpError, parseBody } from "../http.js";
import { requestLocale } from "../i18n.js";
import { createUser, toPublicUser } from "../users.js";
import { startSession } from "./session-cookie.js";

export const invitationRoutes: FastifyPluginAsync = async (app) => {
  const findValid = (token: string) =>
    app.db
      .select()
      .from(invitations)
      .where(and(eq(invitations.tokenHash, hashToken(token)), isNull(invitations.usedAt), gt(invitations.expiresAt, new Date())))
      .get();

  const invalid = () => new HttpError(404, "invalid_invitation", t("error.invalidInvitation"));

  app.get<{ Params: { token: string } }>("/:token", async (req) => {
    const inv = findValid(req.params.token);
    if (!inv) throw invalid();
    return { email: inv.email };
  });

  app.post<{ Params: { token: string } }>(
    "/:token/accept",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const input = parseBody(acceptInvitationInput, req.body);
      const inv = findValid(req.params.token);
      if (!inv) throw invalid();
      if (inv.email && inv.email !== input.email) {
        throw new HttpError(400, "email_mismatch", t("error.invitationEmail"));
      }
      if (app.db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).get()) {
        throw new HttpError(409, "email_taken", t("error.accountExists"));
      }
      // Mark the invitation used first, conditionally, so two concurrent accepts cannot both succeed.
      const claimed = app.db
        .update(invitations)
        .set({ usedAt: new Date() })
        .where(and(eq(invitations.id, inv.id), isNull(invitations.usedAt)))
        .run();
      if (claimed.changes === 0) throw invalid();
      const user = await createUser(app.db, { ...input, role: inv.role, locale: input.locale ?? requestLocale(req) });
      app.db.update(invitations).set({ usedBy: user.id }).where(eq(invitations.id, inv.id)).run();
      startSession(app, reply, user.id);
      return { user: toPublicUser(user) };
    },
  );
};
