import type { FastifyPluginAsync } from "fastify";
import { setupInput, t, type OnboardingState, type SetupStatus } from "@nootion/shared";
import { and, count, eq, gt, inArray, isNull, ne } from "drizzle-orm";
import { invitations, pages, users } from "../db/schema.js";
import { HttpError, parseBody, requireAdmin, requireUser } from "../http.js";
import { requestLocale } from "../i18n.js";
import { createUser, toPublicUser } from "../users.js";
import { startSession } from "./session-cookie.js";
import { passkeySite } from "./passkeys.js";
import { audit } from "../audit.js";
import { getInstanceSettings, saveInstanceSettings } from "../settings.js";
import { fileStore } from "../files.js";
import type { Db } from "../db/index.js";

/** Titles of the "Discover" page that demo.ts makes, in the languages it writes. */
const DEMO_TITLES = ["Découvrir Nootion", "Discover Nootion"];

/** The user's "Discover" page with examples, if it is still at the top of their tree and not in the trash. */
function demoPageOf(db: Db, userId: string): string | null {
  const row = db
    .select({ id: pages.id })
    .from(pages)
    .where(
      and(
        eq(pages.createdBy, userId),
        isNull(pages.parentId),
        isNull(pages.deletedAt),
        eq(pages.kind, "page"),
        eq(pages.icon, "✨"),
        inArray(pages.title, DEMO_TITLES),
      ),
    )
    .get();
  return row?.id ?? null;
}

export const setupRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;
  const hasUsers = () => (db.select({ n: count() }).from(users).get()?.n ?? 0) > 0;

  // Also tells the sign-in page whether "Forgot password" can send its e-mail, about SSO, and where passkeys work.
  app.get("/setup", async () => {
    const { available, origin } = passkeySite(app.config.appUrl);
    return { needsSetup: !hasUsers(), mail: app.mailer.enabled(), sso: app.sso.info(), passkeys: available ? origin : null };
  });

  // Creates the first administrator. Closed for good once any account exists.
  app.post("/setup", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const input = parseBody(setupInput, req.body);
    if (hasUsers()) throw new HttpError(409, "already_setup", t("error.alreadySetup"));
    const user = await createUser(db, { ...input, role: "admin", locale: input.locale ?? requestLocale(req) });
    // The setup assistant comes next; Administration offers to resume it until it is finished or skipped.
    saveInstanceSettings(db, { ...getInstanceSettings(db), setupPending: true });
    startSession(app, reply, user.id);
    audit(db, req, { action: "account.created", actor: user, details: { via: "setup", role: "admin" } });
    return { user: toPublicUser(user) };
  });

  // What to offer someone who signs in: the guided tour (a new account) and, to administrators, the setup assistant.
  app.get("/onboarding", async (req): Promise<OnboardingState> => {
    const user = requireUser(req);
    return {
      // Guests only see the pages shared with them: most of the tour isn't for them.
      tour: user.tourPending && user.role !== "guest",
      setup: user.role === "admin" && getInstanceSettings(db).setupPending,
      demoPageId: user.role === "guest" ? null : demoPageOf(db, user.id),
    };
  });

  // The tour was finished or skipped: not shown by itself again (it can still be started from My account or the palette).
  app.post("/onboarding/tour/done", async (req) => {
    const user = requireUser(req);
    db.update(users).set({ tourPending: false }).where(eq(users.id, user.id)).run();
    return { ok: true };
  });

  // The setup assistant: where each step stands.
  app.get("/admin/setup", async (req): Promise<SetupStatus> => {
    requireAdmin(req);
    const settings = getInstanceSettings(db);
    const files = fileStore(app.config.dataDir);
    const plugins = app.plugins.adminList();
    const assistant = plugins.find((p) => p.id === "assistant");
    const sso = app.sso.info();
    return {
      appUrl: app.config.appUrl,
      passkeys: passkeySite(app.config.appUrl).available,
      filesBucket: files.kind === "s3" ? files.describe() : null,
      mail: app.mailer.enabled(),
      sso: sso ? sso.label : null,
      backups: !!app.backups.get(),
      plugins: { enabled: plugins.filter((p) => p.enabled).length, total: plugins.length },
      assistant: { installed: !!assistant, enabled: !!assistant?.enabled },
      members: db.select({ n: count() }).from(users).where(and(ne(users.role, "guest"), eq(users.disabled, false))).get()?.n ?? 0,
      invitations:
        db
          .select({ n: count() })
          .from(invitations)
          .where(and(isNull(invitations.usedAt), gt(invitations.expiresAt, new Date()), ne(invitations.role, "guest")))
          .get()?.n ?? 0,
      allowGuests: settings.allowGuests,
    };
  });

  // Finished or skipped: Administration stops offering to resume it (it can still be opened from there).
  app.post("/admin/setup/done", async (req) => {
    requireAdmin(req);
    const settings = getInstanceSettings(db);
    if (settings.setupPending) saveInstanceSettings(db, { ...settings, setupPending: false });
    return { ok: true };
  });
};
