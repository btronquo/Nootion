import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  createDatabaseInput,
  createPropertyInput,
  rowInput,
  updatePropertyInput,
  updateViewInput,
  createViewInput,
  STRUCTURAL_TYPES,
  renameFormulaReference,
  atLeast,
  type CellValue,
  type DatabaseProperty,
  type DatabaseSummary,
  type PropertyConfig,
  type PropertyType,
} from "@nootion/shared";
import { and, eq, inArray, isNull, max } from "drizzle-orm";
import { databaseProperties, databaseViews, pages } from "../db/schema.js";
import { HttpError, notFound, parseBody, requireUser } from "../http.js";
import { CAN_CREATE_ROOT_PAGES, getPageRole, requirePageRole, requireWorkspaceRole } from "../permissions.js";
import { nextPosition } from "../pages.js";
import {
  collectPeople,
  convertColumn,
  createDatabase,
  defaultConfig,
  checkFormula,
  enrichRows,
  listProperties,
  listRowPages,
  loadDatabase,
  syncTwin,
  toRow,
  validateValues,
  type CanRead,
  canReadAs,
} from "../databases.js";
import type { PageRole } from "@nootion/shared";
import type { Db } from "../db/index.js";
import { databaseCsv, databaseJson, safeName } from "../export.js";
import { IMPORT_MAX_ROWS, parseCsv, planImport } from "../import.js";
import { t } from "@nootion/shared";

/** Content-Disposition header of a download, with a non-ASCII-safe file name. */
export function attachmentHeader(filename: string) {
  return `attachment; filename="${filename.replace(/[^\x20-\x7e]|"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function requireDatabase(db: Db, userId: string, id: string, min: PageRole) {
  const access = requirePageRole(db, userId, id, min);
  if (access.page.kind !== "database") throw notFound();
  return access;
}

function requireRow(db: Db, userId: string, databaseId: string, rowId: string, min: PageRole) {
  const access = requirePageRole(db, userId, rowId, min);
  if (access.page.kind !== "row" || access.page.parentId !== databaseId) throw notFound();
  return access;
}


/** Checks the settings of a rollup against the columns of its database. */
function checkRollupConfig(db: Db, properties: DatabaseProperty[], config: PropertyConfig) {
  if (!config.relationPropertyId) return;
  const relation = properties.find((p) => p.id === config.relationPropertyId);
  if (relation?.type !== "relation") throw new HttpError(400, "bad_rollup", t("error.rollupRelation"));
  if (config.targetPropertyId) {
    const target = listProperties(db, relation.config.databaseId!).find((p) => p.id === config.targetPropertyId);
    if (!target || target.type === "rollup" || target.type === "relation") {
      throw new HttpError(400, "bad_rollup", t("error.rollupProperty"));
    }
  }
}

export const databaseRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  /** Relation cells being written need access to the related database (edit access when it is two-way). */
  const checkRelationAccess = (userId: string, properties: DatabaseProperty[], values: Record<string, unknown>) => {
    for (const p of properties) {
      if (p.type !== "relation" || !(p.id in values) || !p.config.databaseId) continue;
      requireDatabase(db, userId, p.config.databaseId, p.config.twinPropertyId ? "editor" : "viewer");
    }
  };

  /** A row as the client shows it, with the relation titles it references. */
  const rowResponse = (userId: string, databaseId: string, rowId: string) => {
    const properties = listProperties(db, databaseId);
    const row = toRow(listRowPages(db, databaseId).find((r) => r.id === rowId)!, properties);
    const { related } = enrichRows(db, properties, [row], canReadAs(db, userId));
    return { row, related };
  };

  // Databases the user can link to from a relation.
  app.get("/", async (req) => {
    const user = requireUser(req);
    const canRead = canReadAs(db, user.id);
    const list: DatabaseSummary[] = db
      .select({
        id: pages.id,
        title: pages.title,
        icon: pages.icon,
        workspaceId: pages.workspaceId,
      })
      .from(pages)
      .where(and(eq(pages.kind, "database"), isNull(pages.deletedAt)))
      .all()
      .filter((d) => canRead(d.id));
    return { databases: list };
  });

  app.post("/", async (req) => {
    const user = requireUser(req);
    const input = parseBody(createDatabaseInput, req.body);
    if (input.parentId) {
      const { page: parent } = requirePageRole(db, user.id, input.parentId, "editor");
      if (parent.workspaceId !== input.workspaceId) throw notFound();
      if (parent.kind === "database") throw new HttpError(400, "database_parent", t("error.databaseInDatabase"));
    } else {
      requireWorkspaceRole(db, user.id, input.workspaceId, CAN_CREATE_ROOT_PAGES);
    }
    const id = createDatabase(db, {
      ...input,
      position: nextPosition(db, input.workspaceId, input.parentId),
      userId: user.id,
    });
    const { page, role } = requireDatabase(db, user.id, id, "viewer");
    return { database: loadDatabase(db, page, role, canReadAs(db, user.id)) };
  });

  app.get<{ Params: { id: string } }>("/:id", async (req) => {
    const user = requireUser(req);
    const { page, role } = requireDatabase(db, user.id, req.params.id, "viewer");
    return { database: loadDatabase(db, page, role, canReadAs(db, user.id)) };
  });

  // --- Columns ---

  app.post<{ Params: { id: string } }>("/:id/properties", async (req) => {
    const user = requireUser(req);
    const input = parseBody(createPropertyInput, req.body);
    const { page: database } = requireDatabase(db, user.id, req.params.id, "editor");
    const config: PropertyConfig = {
      ...defaultConfig(input.type),
      ...input.config,
    };
    delete config.twinPropertyId;
    let twin: { databaseId: string; id: string } | null = null;
    if (input.type === "relation") {
      if (!config.databaseId) throw new HttpError(400, "relation_target", t("error.relationTarget"));
      // Linking needs to see the other database; a two-way link also adds a column there.
      requireDatabase(db, user.id, config.databaseId, input.twoWay ? "editor" : "viewer");
      if (input.twoWay) twin = { databaseId: config.databaseId, id: randomUUID() };
    } else {
      delete config.databaseId;
    }
    if (input.type === "rollup") checkRollupConfig(db, listProperties(db, req.params.id), config);
    if (input.type === "formula" && config.expression?.trim()) checkFormula(listProperties(db, req.params.id), null, config.expression);
    const nextPos = (databaseId: string) =>
      (db
        .select({ max: max(databaseProperties.position) })
        .from(databaseProperties)
        .where(eq(databaseProperties.databaseId, databaseId))
        .get()?.max ?? -1) + 1;
    const id = randomUUID();
    db.transaction((tx) => {
      tx.insert(databaseProperties)
        .values({
          id,
          databaseId: req.params.id,
          name: input.name,
          type: input.type,
          config: input.type === "relation" ? { ...config, twinPropertyId: twin?.id ?? null } : config,
          position: nextPos(req.params.id),
        })
        .run();
      if (twin) {
        tx.insert(databaseProperties)
          .values({
            id: twin.id,
            databaseId: twin.databaseId,
            name: (database.title || t("common.untitled")).slice(0, 100),
            type: "relation",
            config: { databaseId: req.params.id, twinPropertyId: id },
            position: nextPos(twin.databaseId),
          })
          .run();
      }
    });
    return {
      property: listProperties(db, req.params.id).find((p) => p.id === id),
    };
  });

  app.patch<{ Params: { id: string; propId: string } }>("/:id/properties/:propId", async (req) => {
    const user = requireUser(req);
    const input = parseBody(updatePropertyInput, req.body);
    requireDatabase(db, user.id, req.params.id, "editor");
    const properties = listProperties(db, req.params.id);
    const prop = properties.find((p) => p.id === req.params.propId);
    if (!prop) throw notFound();
    if (input.type && input.type !== prop.type && (prop.type === "title" || input.type === "title")) {
      throw new HttpError(400, "title_type", t("error.titleType"));
    }
    if (input.type && input.type !== prop.type && (STRUCTURAL_TYPES.includes(prop.type) || STRUCTURAL_TYPES.includes(input.type))) {
      throw new HttpError(400, "structural_type", t("error.structuralType"));
    }
    if (input.config && prop.type === "relation") {
      // The related database and the twin column are fixed once created.
      input.config = {
        ...input.config,
        databaseId: prop.config.databaseId,
        twinPropertyId: prop.config.twinPropertyId ?? null,
      };
    }
    if (input.config && prop.type === "rollup") checkRollupConfig(db, properties, input.config);
    if (input.config?.expression?.trim() && prop.type === "formula" && input.config.expression !== prop.config.expression) {
      checkFormula(properties, prop.id, input.config.expression);
    }

    db.transaction((tx) => {
      const rows = listRowPages(tx, req.params.id);
      const set: Partial<typeof databaseProperties.$inferInsert> = {};
      if (input.name && input.name !== prop.name) {
        set.name = input.name;
        // Formulas refer to columns by name: follow the rename.
        for (const f of properties) {
          if (f.type !== "formula" || !f.config.expression || f.id === prop.id) continue;
          const expression = renameFormulaReference(f.config.expression, prop.name, input.name);
          if (expression !== f.config.expression) tx.update(databaseProperties).set({ config: { ...f.config, expression } }).where(eq(databaseProperties.id, f.id)).run();
        }
      }
      if (input.position !== undefined) set.position = input.position;

      if (input.type && input.type !== prop.type) {
        // Re-type every value, then store the new type and its (possibly generated) options.
        const current = rows.map((r) => toRow(r, properties).values[prop.id]);
        const target = input.type as PropertyType;
        const { values, config } = convertColumn(current, prop, target, {
          ...defaultConfig(target),
          ...(input.config ?? {}),
        });
        rows.forEach((r, i) => {
          const props = { ...(r.props ?? {}) } as Record<string, CellValue>;
          if (values[i] === null || ["created_time", "last_edited_time", "created_by"].includes(target)) delete props[prop.id];
          else props[prop.id] = values[i];
          tx.update(pages).set({ props }).where(eq(pages.id, r.id)).run();
        });
        set.type = target;
        set.config = config;
      } else if (input.config) {
        set.config = input.config;
        // Removing select options clears the cells that used them.
        if ((prop.type === "select" || prop.type === "multi_select") && input.config.options) {
          const kept = new Set(input.config.options.map((o) => o.id));
          for (const r of rows) {
            const props = { ...(r.props ?? {}) } as Record<string, CellValue>;
            const v = props[prop.id];
            if (v == null) continue;
            const next = prop.type === "select" ? (kept.has(v as string) ? v : null) : (v as string[]).filter((x) => kept.has(x));
            if (JSON.stringify(next) === JSON.stringify(v)) continue;
            if (next === null || (Array.isArray(next) && next.length === 0)) delete props[prop.id];
            else props[prop.id] = next;
            tx.update(pages).set({ props }).where(eq(pages.id, r.id)).run();
          }
        }
      }
      if (Object.keys(set).length) tx.update(databaseProperties).set(set).where(eq(databaseProperties.id, prop.id)).run();
    });
    return {
      property: listProperties(db, req.params.id).find((p) => p.id === prop.id),
    };
  });

  app.delete<{ Params: { id: string; propId: string } }>("/:id/properties/:propId", async (req) => {
    const user = requireUser(req);
    requireDatabase(db, user.id, req.params.id, "editor");
    const prop = listProperties(db, req.params.id).find((p) => p.id === req.params.propId);
    if (!prop) throw notFound();
    if (prop.type === "title") throw new HttpError(400, "title_delete", t("error.titleDelete"));
    db.transaction((tx) => {
      for (const r of listRowPages(tx, req.params.id)) {
        if (!r.props || !(prop.id in r.props)) continue;
        const { [prop.id]: _removed, ...rest } = r.props;
        tx.update(pages).set({ props: rest }).where(eq(pages.id, r.id)).run();
      }
      tx.delete(databaseProperties).where(eq(databaseProperties.id, prop.id)).run();
      // The other side of a two-way relation stays, as a one-way relation.
      if (prop.type === "relation" && prop.config.twinPropertyId) {
        const twin = tx.select().from(databaseProperties).where(eq(databaseProperties.id, prop.config.twinPropertyId)).get();
        if (twin)
          tx.update(databaseProperties)
            .set({ config: { ...twin.config, twinPropertyId: null } })
            .where(eq(databaseProperties.id, twin.id))
            .run();
      }
    });
    return { ok: true };
  });

  // --- Rows ---

  app.post<{ Params: { id: string } }>("/:id/rows", async (req) => {
    const user = requireUser(req);
    const input = parseBody(rowInput, req.body);
    const { page: database } = requireDatabase(db, user.id, req.params.id, "editor");
    const properties = listProperties(db, database.id);
    checkRelationAccess(user.id, properties, input.values);
    const { values, title } = validateValues(db, properties, null, input.values);
    const id = randomUUID();
    db.transaction((tx) => {
      tx.insert(pages)
        .values({
          id,
          kind: "row",
          workspaceId: database.workspaceId,
          parentId: database.id,
          title: title ?? input.title ?? "",
          props: values,
          position: nextPosition(db, database.workspaceId, database.id),
          createdBy: user.id,
        })
        .run();
      for (const p of properties) if (p.type === "relation" && values[p.id]) syncTwin(tx, p, id, [], values[p.id] as string[]);
    });
    return rowResponse(user.id, database.id, id);
  });

  app.get<{ Params: { id: string; rowId: string } }>("/:id/rows/:rowId", async (req) => {
    const user = requireUser(req);
    // Reading a row only needs access to the row (it may have been shared on its own).
    const { role } = requireRow(db, user.id, req.params.id, req.params.rowId, "viewer");
    const properties = listProperties(db, req.params.id);
    const row = db.select().from(pages).where(eq(pages.id, req.params.rowId)).get()!;
    const data = toRow(row, properties);
    const { related, rollupTargets } = enrichRows(db, properties, [data], canReadAs(db, user.id));
    return {
      properties,
      row: data,
      role,
      people: collectPeople(db, properties, [data], rollupTargets),
      related,
      rollupTargets,
    };
  });

  app.patch<{ Params: { id: string; rowId: string } }>("/:id/rows/:rowId", async (req) => {
    const user = requireUser(req);
    const input = parseBody(rowInput, req.body);
    requireRow(db, user.id, req.params.id, req.params.rowId, "editor");
    const properties = listProperties(db, req.params.id);
    checkRelationAccess(user.id, properties, input.values);
    const { values, title } = validateValues(db, properties, req.params.rowId, input.values);
    db.transaction((tx) => {
      const current = tx.select({ props: pages.props }).from(pages).where(eq(pages.id, req.params.rowId)).get()!;
      const before = { ...(current.props ?? {}) } as Record<string, CellValue>;
      const props = { ...before };
      for (const [k, v] of Object.entries(values)) {
        if (v === null) delete props[k];
        else props[k] = v;
      }
      const newTitle = title ?? input.title;
      tx.update(pages)
        .set({
          props,
          updatedAt: new Date(),
          ...(newTitle !== undefined ? { title: newTitle } : {}),
        })
        .where(eq(pages.id, req.params.rowId))
        .run();
      for (const p of properties) {
        if (p.type === "relation" && p.id in values)
          syncTwin(tx, p, req.params.rowId, (before[p.id] as string[] | null) ?? [], (props[p.id] as string[] | null) ?? []);
      }
    });
    return rowResponse(user.id, req.params.id, req.params.rowId);
  });

  // Moves rows to the trash (they can be restored from there like any page).
  app.post<{ Params: { id: string } }>("/:id/rows/delete", async (req) => {
    const user = requireUser(req);
    const { ids } = parseBody(z.object({ ids: z.array(z.string()).min(1).max(1000) }), req.body);
    for (const id of ids) requireRow(db, user.id, req.params.id, id, "editor");
    db.update(pages)
      .set({ deletedAt: new Date(), deletedBy: user.id })
      .where(and(inArray(pages.id, ids), eq(pages.parentId, req.params.id)))
      .run();
    return { ok: true };
  });

  // --- Views ---

  app.patch<{ Params: { id: string; viewId: string } }>("/:id/views/:viewId", async (req) => {
    const user = requireUser(req);
    const input = parseBody(updateViewInput, req.body);
    requireDatabase(db, user.id, req.params.id, "editor");
    const view = db
      .select()
      .from(databaseViews)
      .where(and(eq(databaseViews.id, req.params.viewId), eq(databaseViews.databaseId, req.params.id)))
      .get();
    if (!view) throw notFound();
    db.update(databaseViews)
      .set({
        ...(input.name ? { name: input.name } : {}),
        ...(input.type ? { type: input.type } : {}),
        ...(input.config ? { config: input.config } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
      })
      .where(eq(databaseViews.id, view.id))
      .run();
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/:id/views", async (req) => {
    const user = requireUser(req);
    const input = parseBody(createViewInput, req.body);
    requireDatabase(db, user.id, req.params.id, "editor");
    let config: Record<string, unknown> = {};
    if (input.duplicateOf) {
      const source = db
        .select()
        .from(databaseViews)
        .where(and(eq(databaseViews.id, input.duplicateOf), eq(databaseViews.databaseId, req.params.id)))
        .get();
      if (!source) throw notFound();
      config = source.config;
    }
    const last = db.select({ p: max(databaseViews.position) }).from(databaseViews).where(eq(databaseViews.databaseId, req.params.id)).get();
    const view = { id: randomUUID(), databaseId: req.params.id, name: input.name, type: input.type, config, position: (last?.p ?? -1) + 1 };
    db.insert(databaseViews).values(view).run();
    return { view: { id: view.id, name: view.name, type: view.type, config: view.config, position: view.position } };
  });

  app.delete<{ Params: { id: string; viewId: string } }>("/:id/views/:viewId", async (req) => {
    const user = requireUser(req);
    requireDatabase(db, user.id, req.params.id, "editor");
    const views = db.select({ id: databaseViews.id }).from(databaseViews).where(eq(databaseViews.databaseId, req.params.id)).all();
    if (!views.some((v) => v.id === req.params.viewId)) throw notFound();
    if (views.length === 1) throw new HttpError(400, "last_view", t("error.lastView"));
    db.delete(databaseViews).where(eq(databaseViews.id, req.params.viewId)).run();
    return { ok: true };
  });

  // --- Export / import ---

  app.get<{ Params: { id: string }; Querystring: { viewId?: string; format?: string; sep?: string } }>("/:id/export", async (req, reply) => {
    const user = requireUser(req);
    const { page, role } = requireDatabase(db, user.id, req.params.id, "viewer");
    const data = loadDatabase(db, page, role, canReadAs(db, user.id));
    const name = safeName(page.title);
    if (req.query.format === "json") {
      return reply
        .header("content-type", "application/json; charset=utf-8")
        .header("content-disposition", attachmentHeader(`${name}.json`))
        .send(JSON.stringify(databaseJson(data, req.query.viewId), null, 2));
    }
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", attachmentHeader(`${name}.csv`))
      .send(databaseCsv(data, req.query.viewId, req.query.sep === "semicolon" ? ";" : ","));
  });

  app.post<{ Params: { id: string } }>("/:id/import", async (req) => {
    const user = requireUser(req);
    const input = parseBody(z.object({ csv: z.string().min(1), createColumns: z.boolean().default(true) }), req.body);
    const { page: database } = requireDatabase(db, user.id, req.params.id, "editor");
    const csv = parseCsv(input.csv);
    if (csv.length < 2) throw new HttpError(400, "empty_csv", t("error.emptyCsv"));
    if (csv.length - 1 > IMPORT_MAX_ROWS) throw new HttpError(400, "too_many_rows", t("error.tooManyRows", { max: IMPORT_MAX_ROWS }));
    const properties = listProperties(db, database.id);
    const plan = planImport(db, properties, csv, {
      createColumns: input.createColumns,
      canLink: (p) => atLeast(getPageRole(db, user.id, p.config.databaseId!), p.config.twinPropertyId ? "editor" : "viewer"),
    });
    db.transaction((tx) => {
      let position = (tx.select({ max: max(databaseProperties.position) }).from(databaseProperties).where(eq(databaseProperties.databaseId, database.id)).get()?.max ?? -1) + 1;
      const newIds = new Map<string, string>();
      for (const c of plan.newColumns) {
        const id = randomUUID();
        newIds.set(`new:${c.index}`, id);
        tx.insert(databaseProperties).values({ id, databaseId: database.id, name: c.name, type: c.type, config: c.config, position: position++ }).run();
      }
      for (const [propId, options] of plan.options) {
        const prop = properties.find((p) => p.id === propId)!;
        tx.update(databaseProperties).set({ config: { ...prop.config, options } }).where(eq(databaseProperties.id, propId)).run();
      }
      let rowPosition = nextPosition(db, database.workspaceId, database.id);
      for (const row of plan.rows) {
        const values = Object.fromEntries(Object.entries(row.values).map(([k, v]) => [newIds.get(k) ?? k, v]));
        const id = randomUUID();
        tx.insert(pages)
          .values({ id, kind: "row", workspaceId: database.workspaceId, parentId: database.id, title: row.title, props: values, position: rowPosition++, createdBy: user.id })
          .run();
        for (const p of properties) if (p.type === "relation" && values[p.id]) syncTwin(tx, p, id, [], values[p.id] as string[]);
      }
    });
    return { imported: plan.rows.length, createdColumns: plan.newColumns.map((c) => c.name), ignoredColumns: plan.ignored };
  });
};
