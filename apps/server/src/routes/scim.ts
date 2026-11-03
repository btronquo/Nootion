import { randomBytes } from "node:crypto";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { and, count, eq, ne, sql } from "drizzle-orm";
import { deleteUserSessions } from "../auth/sessions.js";
import { users } from "../db/schema.js";
import { createUser, type UserRow } from "../users.js";

/**
 * SCIM 2.0 users, for the SSO provider to create, update and disable accounts
 * (Microsoft Entra ID "provisioning"). Accounts are never deleted this way, only disabled:
 * what people wrote stays.
 */
const USER = "urn:ietf:params:scim:schemas:core:2.0:User";
const LIST = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const ERROR = "urn:ietf:params:scim:api:messages:2.0:Error";
const PATCH = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

class ScimError extends Error {
  constructor(
    readonly status: number,
    detail: string,
    readonly scimType?: string,
  ) {
    super(detail);
  }
}

interface ScimUser {
  userName?: string;
  externalId?: string;
  active?: boolean | string;
  displayName?: string;
  name?: { formatted?: string; givenName?: string; familyName?: string };
  emails?: { value?: string; primary?: boolean; type?: string }[];
}

const bool = (v: unknown) =>
  typeof v === "string" ? v.toLowerCase() === "true" : !!v;
const email = (u: ScimUser) =>
  (
    u.emails?.find((e) => e.primary)?.value ??
    u.emails?.[0]?.value ??
    u.userName ??
    ""
  )
    .trim()
    .toLowerCase();
const nameOf = (u: ScimUser) =>
  u.displayName?.trim() ||
  u.name?.formatted?.trim() ||
  [u.name?.givenName, u.name?.familyName].filter(Boolean).join(" ").trim() ||
  undefined;

export const scimRoutes: FastifyPluginAsync = async (app) => {
  const { db, sso } = app;
  // Providers send "application/scim+json".
  app.addContentTypeParser(
    "application/scim+json",
    { parseAs: "string" },
    (_req, body, done) => {
      try {
        done(null, body ? JSON.parse(body as string) : {});
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  app.addHook("onRequest", async (req) => {
    const token = /^Bearer\s+(\S+)$/i.exec(
      req.headers.authorization ?? "",
    )?.[1];
    if (!token || !sso.scimTokenValid(token))
      throw new ScimError(401, "Invalid or missing token.");
  });

  app.setErrorHandler((err, req, reply) => {
    const status =
      err instanceof ScimError
        ? err.status
        : ((err as { statusCode?: number }).statusCode ?? 500);
    if (status >= 500) req.log.error(err);
    return send(reply.status(status), {
      schemas: [ERROR],
      status: String(status),
      ...(err instanceof ScimError && err.scimType
        ? { scimType: err.scimType }
        : {}),
      detail: status >= 500 ? "Internal error." : (err as Error).message,
    });
  });

  const send = (reply: FastifyReply, body: unknown) =>
    reply.type("application/scim+json").send(body);
  const base = () => `${app.config.appUrl}/api/scim/v2`;
  const toScim = (u: UserRow) => ({
    schemas: [USER],
    id: u.id,
    ...(u.scimExternalId ? { externalId: u.scimExternalId } : {}),
    userName: u.email,
    displayName: u.name,
    name: { formatted: u.name },
    emails: [{ value: u.email, type: "work", primary: true }],
    active: !u.disabled,
    meta: {
      resourceType: "User",
      created: u.createdAt.toISOString(),
      location: `${base()}/Users/${u.id}`,
    },
  });
  const find = (id: string) => {
    const u = db.select().from(users).where(eq(users.id, id)).get();
    if (!u) throw new ScimError(404, "User not found.");
    return u;
  };

  /** Applies a change, refusing what would lock everyone out or take someone else's address. */
  function update(
    u: UserRow,
    change: {
      email?: string;
      name?: string;
      externalId?: string;
      active?: boolean;
    },
  ): UserRow {
    const set: Partial<typeof users.$inferInsert> = {};
    if (change.name) set.name = change.name.slice(0, 100);
    if (change.externalId !== undefined)
      set.scimExternalId = change.externalId || null;
    if (change.email && change.email !== u.email.toLowerCase()) {
      if (
        db
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              sql`lower(${users.email}) = ${change.email}`,
              ne(users.id, u.id),
            ),
          )
          .get()
      ) {
        throw new ScimError(
          409,
          "Another account has this address.",
          "uniqueness",
        );
      }
      set.email = change.email;
    }
    if (change.active !== undefined && change.active === u.disabled) {
      if (!change.active && u.role === "admin") {
        const others =
          db
            .select({ n: count() })
            .from(users)
            .where(
              and(
                eq(users.role, "admin"),
                eq(users.disabled, false),
                ne(users.id, u.id),
              ),
            )
            .get()?.n ?? 0;
        if (others === 0)
          throw new ScimError(
            400,
            "This is the last administrator; it can't be disabled.",
            "mutability",
          );
      }
      set.disabled = !change.active;
    }
    if (!Object.keys(set).length) return u;
    const updated = db
      .update(users)
      .set(set)
      .where(eq(users.id, u.id))
      .returning()
      .get();
    if (set.disabled) {
      deleteUserSessions(db, u.id);
      app.collab.revalidateAll();
    }
    return updated;
  }

  app.get("/ServiceProviderConfig", async (_req, reply) =>
    send(reply, {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 200 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: "oauthbearertoken",
          name: "OAuth Bearer Token",
          description: "The token made in Nootion's administration.",
        },
      ],
    }),
  );

  app.get<{
    Querystring: { filter?: string; startIndex?: string; count?: string };
  }>("/Users", async (req, reply) => {
    const start = Math.max(1, Number(req.query.startIndex) || 1);
    const size = Math.min(
      200,
      Math.max(0, Number(req.query.count ?? 100) || 0),
    );
    let rows: UserRow[];
    if (req.query.filter) {
      // Providers only ask "attribute eq value", to find an account before creating it.
      const m =
        /^\s*(userName|externalId|id|emails(?:\.value)?)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i.exec(
          req.query.filter,
        );
      if (!m) throw new ScimError(400, "Unsupported filter.", "invalidFilter");
      const value = m[2]!.replace(/\\(.)/g, "$1");
      const attr = m[1]!.toLowerCase();
      const where =
        attr === "externalid"
          ? eq(users.scimExternalId, value)
          : attr === "id"
            ? eq(users.id, value)
            : sql`lower(${users.email}) = ${value.toLowerCase()}`;
      rows = db.select().from(users).where(where).all();
    } else {
      rows = db.select().from(users).orderBy(users.createdAt).all();
    }
    const page = rows.slice(start - 1, start - 1 + size);
    return send(reply, {
      schemas: [LIST],
      totalResults: rows.length,
      startIndex: start,
      itemsPerPage: page.length,
      Resources: page.map(toScim),
    });
  });

  app.get<{ Params: { id: string } }>("/Users/:id", async (req, reply) =>
    send(reply, toScim(find(req.params.id))),
  );

  app.post("/Users", async (req: FastifyRequest<{ Body: ScimUser }>, reply) => {
    const body = req.body ?? {};
    const address = email(body);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address))
      throw new ScimError(
        400,
        "userName or emails must hold an e-mail address.",
        "invalidValue",
      );
    if (
      db
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.email}) = ${address}`)
        .get()
    ) {
      throw new ScimError(
        409,
        "An account with this address already exists.",
        "uniqueness",
      );
    }
    // No password anyone knows: the account signs in through SSO.
    let u = await createUser(db, {
      name: (nameOf(body) ?? address.split("@")[0]!).slice(0, 100),
      email: address,
      password: randomBytes(32).toString("hex"),
      role: "member",
      locale: "en",
    });
    u = update(u, {
      externalId: body.externalId,
      active: body.active === undefined ? true : bool(body.active),
    });
    return send(reply.status(201), toScim(u));
  });

  app.put<{ Params: { id: string }; Body: ScimUser }>(
    "/Users/:id",
    async (req, reply) => {
      const body = req.body ?? {};
      const u = update(find(req.params.id), {
        email: email(body) || undefined,
        name: nameOf(body),
        externalId: body.externalId,
        active: body.active === undefined ? undefined : bool(body.active),
      });
      return send(reply, toScim(u));
    },
  );

  app.patch<{
    Params: { id: string };
    Body: {
      schemas?: string[];
      Operations?: { op?: string; path?: string; value?: unknown }[];
    };
  }>("/Users/:id", async (req, reply) => {
    const ops = req.body?.Operations;
    if (
      !Array.isArray(ops) ||
      (req.body.schemas && !req.body.schemas.includes(PATCH))
    )
      throw new ScimError(400, "Expected a PatchOp.", "invalidSyntax");
    const change: {
      email?: string;
      name?: string;
      externalId?: string;
      active?: boolean;
    } = {};
    const given: { givenName?: string; familyName?: string } = {};
    const apply = (path: string, value: unknown) => {
      const p = path.toLowerCase();
      const s =
        typeof value === "string"
          ? value.trim()
          : Array.isArray(value)
            ? String((value[0] as { value?: unknown })?.value ?? "")
            : "";
      if (p === "active") change.active = bool(value);
      else if (p === "username" || p.startsWith("emails"))
        change.email = s.toLowerCase() || undefined;
      else if (p === "displayname" || p === "name.formatted")
        change.name = s || undefined;
      else if (p === "name.givenname") given.givenName = s;
      else if (p === "name.familyname") given.familyName = s;
      else if (p === "externalid") change.externalId = s;
      // Other attributes (title, phone…) aren't kept.
    };
    for (const op of ops) {
      const kind = (op.op ?? "").toLowerCase();
      if (kind === "remove") {
        if (op.path?.toLowerCase() === "externalid") change.externalId = "";
        continue;
      }
      if (kind !== "replace" && kind !== "add")
        throw new ScimError(
          400,
          `Unsupported operation "${op.op}".`,
          "invalidSyntax",
        );
      if (op.path) apply(op.path, op.value);
      else if (op.value && typeof op.value === "object") {
        for (const [k, v] of Object.entries(
          op.value as Record<string, unknown>,
        )) {
          if (k === "name" && v && typeof v === "object")
            for (const [nk, nv] of Object.entries(v)) apply(`name.${nk}`, nv);
          else apply(k, v);
        }
      }
    }
    if (!change.name && (given.givenName || given.familyName))
      change.name =
        [given.givenName, given.familyName].filter(Boolean).join(" ") ||
        undefined;
    return send(reply, toScim(update(find(req.params.id), change)));
  });

  // Removed at the provider: disabled here, not deleted.
  app.delete<{ Params: { id: string } }>("/Users/:id", async (req, reply) => {
    update(find(req.params.id), { active: false });
    return reply.status(204).send();
  });

  // Groups aren't used: Nootion has its own spaces and roles.
  app.get("/Groups", async (_req, reply) =>
    send(reply, {
      schemas: [LIST],
      totalResults: 0,
      startIndex: 1,
      itemsPerPage: 0,
      Resources: [],
    }),
  );
};
