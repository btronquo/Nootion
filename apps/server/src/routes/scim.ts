import { randomBytes } from "node:crypto";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { and, count, eq, ne, sql } from "drizzle-orm";
import { deleteUserSessions } from "../auth/sessions.js";
import { groupMembers, groups, users } from "../db/schema.js";
import { addGroupMembers, assertNameFree, createGroup, findGroup, removeGroupMembers, setGroupMembers, type GroupRow } from "../groups.js";
import { createUser, type UserRow } from "../users.js";

/**
 * SCIM 2.0 users and groups, for the SSO provider to create, update and disable accounts and keep the company's
 * groups (Microsoft Entra ID "provisioning"). Accounts are never deleted this way, only disabled: what people wrote
 * stays. Groups are Nootion's groups: shared with spaces and pages like people.
 */
const USER = "urn:ietf:params:scim:schemas:core:2.0:User";
const GROUP = "urn:ietf:params:scim:schemas:core:2.0:Group";
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

  // --- Groups: the company's groups, shared with spaces and pages like people. ---

  const toScimGroup = (g: GroupRow, withMembers = true) => {
    const members = withMembers
      ? db
          .select({ id: users.id, name: users.name })
          .from(groupMembers)
          .innerJoin(users, eq(users.id, groupMembers.userId))
          .where(eq(groupMembers.groupId, g.id))
          .all()
          .map((m) => ({ value: m.id, display: m.name, $ref: `${base()}/Users/${m.id}` }))
      : undefined;
    return {
      schemas: [GROUP],
      id: g.id,
      ...(g.scimExternalId ? { externalId: g.scimExternalId } : {}),
      displayName: g.name,
      ...(members ? { members } : {}),
      meta: { resourceType: "Group", created: g.createdAt.toISOString(), location: `${base()}/Groups/${g.id}` },
    };
  };
  const findGroupOr404 = (id: string) => {
    const g = findGroup(db, id);
    if (!g) throw new ScimError(404, "Group not found.");
    return g;
  };
  const withoutMembers = (q: { excludedAttributes?: string; attributes?: string }) =>
    /(^|,)\s*members\s*(,|$)/i.test(q.excludedAttributes ?? "") || (!!q.attributes && !/(^|,)\s*members\s*(,|$)/i.test(q.attributes));
  const memberIds = (value: unknown): string[] =>
    (Array.isArray(value) ? value : value ? [value] : [])
      .map((m) => (typeof m === "string" ? m : String((m as { value?: unknown })?.value ?? "")))
      .filter(Boolean);
  const groupName = (value: unknown) => {
    const name = typeof value === "string" ? value.trim().slice(0, 100) : "";
    if (!name) throw new ScimError(400, "displayName is required.", "invalidValue");
    return name;
  };
  const rename = (g: GroupRow, name: string) => {
    if (name === g.name) return;
    try {
      assertNameFree(db, name, g.id);
    } catch {
      throw new ScimError(409, "Another group has this name.", "uniqueness");
    }
    db.update(groups).set({ name }).where(eq(groups.id, g.id)).run();
  };

  app.get<{ Querystring: { filter?: string; startIndex?: string; count?: string; excludedAttributes?: string; attributes?: string } }>(
    "/Groups",
    async (req, reply) => {
      const start = Math.max(1, Number(req.query.startIndex) || 1);
      const size = Math.min(200, Math.max(0, Number(req.query.count ?? 100) || 0));
      let rows: GroupRow[];
      if (req.query.filter) {
        const m = /^\s*(displayName|externalId|id)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i.exec(req.query.filter);
        if (!m) throw new ScimError(400, "Unsupported filter.", "invalidFilter");
        const value = m[2]!.replace(/\\(.)/g, "$1");
        const attr = m[1]!.toLowerCase();
        const where =
          attr === "externalid" ? eq(groups.scimExternalId, value) : attr === "id" ? eq(groups.id, value) : sql`lower(${groups.name}) = ${value.toLowerCase()}`;
        rows = db.select().from(groups).where(where).all();
      } else {
        rows = db.select().from(groups).orderBy(groups.createdAt).all();
      }
      const page = rows.slice(start - 1, start - 1 + size);
      const full = !withoutMembers(req.query);
      return send(reply, {
        schemas: [LIST],
        totalResults: rows.length,
        startIndex: start,
        itemsPerPage: page.length,
        Resources: page.map((g) => toScimGroup(g, full)),
      });
    },
  );

  app.get<{ Params: { id: string }; Querystring: { excludedAttributes?: string; attributes?: string } }>("/Groups/:id", async (req, reply) =>
    send(reply, toScimGroup(findGroupOr404(req.params.id), !withoutMembers(req.query))),
  );

  app.post<{ Body: { displayName?: unknown; externalId?: unknown; members?: unknown } }>("/Groups", async (req, reply) => {
    const body = req.body ?? {};
    const name = groupName(body.displayName);
    let g: GroupRow;
    try {
      g = createGroup(db, { name, scim: true, scimExternalId: typeof body.externalId === "string" ? body.externalId : null });
    } catch {
      throw new ScimError(409, "A group with this name already exists.", "uniqueness");
    }
    addGroupMembers(db, g.id, memberIds(body.members));
    return send(reply.status(201), toScimGroup(g));
  });

  app.put<{ Params: { id: string }; Body: { displayName?: unknown; externalId?: unknown; members?: unknown } }>("/Groups/:id", async (req, reply) => {
    const body = req.body ?? {};
    const g = findGroupOr404(req.params.id);
    rename(g, groupName(body.displayName ?? g.name));
    if (body.externalId !== undefined) db.update(groups).set({ scimExternalId: typeof body.externalId === "string" && body.externalId ? body.externalId : null }).where(eq(groups.id, g.id)).run();
    db.update(groups).set({ scim: true }).where(eq(groups.id, g.id)).run();
    setGroupMembers(db, g.id, memberIds(body.members));
    return send(reply, toScimGroup(findGroupOr404(g.id)));
  });

  app.patch<{ Params: { id: string }; Body: { schemas?: string[]; Operations?: { op?: string; path?: string; value?: unknown }[] } }>(
    "/Groups/:id",
    async (req, reply) => {
      const ops = req.body?.Operations;
      if (!Array.isArray(ops) || (req.body.schemas && !req.body.schemas.includes(PATCH))) throw new ScimError(400, "Expected a PatchOp.", "invalidSyntax");
      const g = findGroupOr404(req.params.id);
      for (const op of ops) {
        const kind = (op.op ?? "").toLowerCase();
        const path = (op.path ?? "").trim();
        // members[value eq "id"]: one member.
        const one = /^members\[\s*value\s+eq\s+"([^"]+)"\s*\]$/i.exec(path)?.[1];
        if (kind === "remove") {
          if (one) removeGroupMembers(db, g.id, [one]);
          else if (path.toLowerCase() === "members") {
            const ids = memberIds(op.value);
            if (ids.length) removeGroupMembers(db, g.id, ids);
            else setGroupMembers(db, g.id, []);
          } else if (path.toLowerCase() === "externalid") db.update(groups).set({ scimExternalId: null }).where(eq(groups.id, g.id)).run();
          continue;
        }
        if (kind !== "add" && kind !== "replace") throw new ScimError(400, `Unsupported operation "${op.op}".`, "invalidSyntax");
        const apply = (attr: string, value: unknown) => {
          const a = attr.toLowerCase();
          if (a === "members") {
            if (kind === "add") addGroupMembers(db, g.id, memberIds(value));
            else setGroupMembers(db, g.id, memberIds(value));
          } else if (a === "displayname") rename(findGroupOr404(g.id), groupName(value));
          else if (a === "externalid") db.update(groups).set({ scimExternalId: typeof value === "string" && value ? value : null }).where(eq(groups.id, g.id)).run();
          // Other attributes aren't kept.
        };
        if (path) apply(path, op.value);
        else if (op.value && typeof op.value === "object") for (const [k, v] of Object.entries(op.value as Record<string, unknown>)) apply(k, v);
      }
      db.update(groups).set({ scim: true }).where(eq(groups.id, g.id)).run();
      return send(reply, toScimGroup(findGroupOr404(g.id)));
    },
  );

  // Removed at the provider: the group goes, and what it opened with it. Its members' accounts stay.
  app.delete<{ Params: { id: string } }>("/Groups/:id", async (req, reply) => {
    const g = findGroupOr404(req.params.id);
    db.delete(groups).where(eq(groups.id, g.id)).run();
    return reply.status(204).send();
  });
};
