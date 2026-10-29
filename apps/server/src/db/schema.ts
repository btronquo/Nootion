import { sql } from "drizzle-orm";
import { blob, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`);

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ["admin", "member"] }).notNull().default("member"),
    disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
    // File name of the profile picture in <data>/avatars, or null.
    avatar: text("avatar"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    // SHA-256 of the cookie token: a leaked database does not leak live sessions.
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const invitations = sqliteTable("invitations", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  email: text("email"),
  role: text("role", { enum: ["admin", "member"] }).notNull().default("member"),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  usedAt: integer("used_at", { mode: "timestamp_ms" }),
  usedBy: text("used_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["personal", "shared"] }).notNull(),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const workspaceMembers = sqliteTable(
  "workspace_members",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "editor", "commenter", "viewer"] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index("workspace_members_user_idx").on(t.userId)],
);

export const pages = sqliteTable(
  "pages",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    // "database": the page is a database (its rows are its children). "row": a database row.
    kind: text("kind", { enum: ["page", "database", "row"] }).notNull().default("page"),
    title: text("title").notNull().default(""),
    icon: text("icon"),
    fullWidth: integer("full_width", { mode: "boolean" }).notNull().default(false),
    // Fractional-free ordering: siblings are sorted by position, then creation time.
    position: integer("position").notNull().default(0),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('subsec') * 1000)`),
    // Set on the page that was moved to the trash; its descendants are trashed through it.
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    deletedBy: text("deleted_by").references(() => users.id, { onDelete: "set null" }),
    // Collaborative document (Yjs update encoding). Source of truth for the content.
    contentState: blob("content_state", { mode: "buffer" }),
    // Derived from contentState on every save: ProseMirror JSON (exports, public pages) and plain text (search).
    contentJson: text("content_json", { mode: "json" }),
    contentText: text("content_text"),
    // Rows only: cell values by property id.
    props: text("props", { mode: "json" }).$type<Record<string, unknown>>(),
  },
  (t) => [index("pages_workspace_idx").on(t.workspaceId), index("pages_parent_idx").on(t.parentId)],
);

export const pagePermissions = sqliteTable(
  "page_permissions",
  {
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["full", "editor", "commenter", "viewer"] }).notNull(),
    grantedBy: text("granted_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.pageId, t.userId] }), index("page_permissions_user_idx").on(t.userId)],
);

export const publicLinks = sqliteTable("public_links", {
  // One public link per page; the token is random and unguessable.
  pageId: text("page_id")
    .primaryKey()
    .references(() => pages.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  includeSubpages: integer("include_subpages", { mode: "boolean" }).notNull().default(true),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const attachments = sqliteTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("attachments_page_idx").on(t.pageId)],
);

export const databaseProperties = sqliteTable(
  "database_properties",
  {
    id: text("id").primaryKey(),
    databaseId: text("database_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull(),
    config: text("config", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("database_properties_db_idx").on(t.databaseId)],
);

export const databaseViews = sqliteTable(
  "database_views",
  {
    id: text("id").primaryKey(),
    databaseId: text("database_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull().default("table"),
    config: text("config", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("database_views_db_idx").on(t.databaseId)],
);

export const plugins = sqliteTable("plugins", {
  id: text("id").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  /** Setting values by key; passwords are encrypted. */
  settings: text("settings", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
