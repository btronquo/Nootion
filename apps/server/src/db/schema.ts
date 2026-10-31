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
    // Interface language ("en", "fr"…).
    locale: text("locale").notNull().default("en"),
    // The user's home page (a page of their personal workspace), created on first visit.
    homePageId: text("home_page_id"),
    // The page quick notes land in (in their personal workspace), created on first capture.
    inboxPageId: text("inbox_page_id"),
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
    /** Banner at the top of the page: an attachment, an image link or a built-in gradient (see coverSchema). */
    cover: text("cover"),
    /** Vertical position of the cover image, from 0 (top) to 100 (bottom). */
    coverPosition: integer("cover_position").notNull().default(50),
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
    // A page template (offered when starting an empty page), or a row template of its database (hidden from its rows).
    template: integer("template", { mode: "boolean" }).notNull().default(false),
    // Databases only: the row template new rows start from, if any.
    defaultTemplateId: text("default_template_id"),
  },
  (t) => [index("pages_workspace_idx").on(t.workspaceId), index("pages_parent_idx").on(t.parentId)],
);

/** Pages a user starred, in the order shown at the top of their sidebar. */
export const favorites = sqliteTable(
  "favorites",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.pageId] })],
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
    // Text read from the file (PDF text, OCR of images and scans), for search.
    text: text("text"),
    textStatus: text("text_status", { enum: ["pending", "done", "unsupported", "failed"] }).notNull().default("pending"),
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

/** What a plugin keeps for one user (e.g. their account on another service), encrypted. */
export const pluginUserData = sqliteTable(
  "plugin_user_data",
  {
    pluginId: text("plugin_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    value: text("value").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.pluginId, t.userId] })],
);

/** Notion workspace imported into a Nootion space: its integration token, for importing again. */
export const notionConnections = sqliteTable("notion_connections", {
  workspaceId: text("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  // Encrypted with APP_SECRET.
  token: text("token").notNull(),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  lastImportAt: integer("last_import_at", { mode: "timestamp_ms" }),
});

/** Which Nootion page each imported Notion page, database or row became: a new import updates them. */
export const notionLinks = sqliteTable(
  "notion_links",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    notionId: text("notion_id").notNull(),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    // Notion's last_edited_time when it was imported: unchanged pages are skipped next time.
    notionEditedAt: text("notion_edited_at"),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.notionId] }), index("notion_links_page_idx").on(t.pageId)],
);

/** Which Nootion column each imported Notion database property became. */
export const notionPropertyLinks = sqliteTable(
  "notion_property_links",
  {
    propertyId: text("property_id")
      .primaryKey()
      .references(() => databaseProperties.id, { onDelete: "cascade" }),
    databaseId: text("database_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    notionPropertyId: text("notion_property_id").notNull(),
  },
  (t) => [uniqueIndex("notion_property_links_unique").on(t.databaseId, t.notionPropertyId)],
);

/** Private iCal links: a user's read-only feed of the dates shown by one calendar block. */
export const calendarFeeds = sqliteTable(
  "calendar_feeds",
  {
    // Random and unguessable; calendar apps keep the whole link, so it is stored as is, like public links.
    token: text("token").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    // The block's id attribute, in the page content.
    blockId: text("block_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("calendar_feeds_block_unique").on(t.userId, t.pageId, t.blockId)],
);

/** Last time each user opened each page, for "Recently visited". */
export const pageVisits = sqliteTable(
  "page_visits",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    visitedAt: integer("visited_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.pageId] }), index("page_visits_recent_idx").on(t.userId, t.visitedAt)],
);

/** Versions of a page's content kept over time, for its history. */
export const pageSnapshots = sqliteTable(
  "page_snapshots",
  {
    id: text("id").primaryKey(),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    // ProseMirror JSON of the content at that time.
    content: text("content", { mode: "json" }).notNull(),
    // Who edited the page since the previous version.
    authors: text("authors", { mode: "json" }).$type<string[]>().notNull().default([]),
    // Set on the version a restore produced: when the restored version was made.
    restoredFrom: integer("restored_from", { mode: "timestamp_ms" }),
    // Set on a version written by an app or AI agent through the API: its token's name.
    agent: text("agent"),
    createdAt: createdAt(),
  },
  (t) => [index("page_snapshots_page_idx").on(t.pageId, t.createdAt)],
);

/** Reminders set on dates written in pages: one per date and per page, for the user who set it. */
export const reminders = sqliteTable(
  "reminders",
  {
    id: text("id").primaryKey(),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    // The date's id in the page content.
    mentionId: text("mention_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The date as written: "2026-11-15" or "2026-11-15T09:00".
    date: text("date").notNull(),
    remindAt: integer("remind_at", { mode: "timestamp_ms" }).notNull(),
    // The line of text the date is in.
    text: text("text").notNull().default(""),
    // Sent to the user's devices.
    notifiedAt: integer("notified_at", { mode: "timestamp_ms" }),
    // Marked as done by the user.
    dismissedAt: integer("dismissed_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("reminders_mention_unique").on(t.pageId, t.mentionId), index("reminders_user_idx").on(t.userId, t.remindAt)],
);

/** Devices that receive notifications (Web Push), one per browser or installed app. */
export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    endpoint: text("endpoint").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("push_subscriptions_user_idx").on(t.userId)],
);

/** Personal API tokens: each one acts as its user, limited to some spaces, and possibly to reading. */
export const apiTokens = sqliteTable(
  "api_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // SHA-256 of the token: it is shown once, at creation.
    tokenHash: text("token_hash").notNull(),
    // Its first characters, to tell tokens apart in the list.
    prefix: text("prefix").notNull(),
    workspaceIds: text("workspace_ids", { mode: "json" }).$type<string[]>().notNull(),
    readOnly: integer("read_only", { mode: "boolean" }).notNull().default(true),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    // Tokens given to an app connected with OAuth: the app, and the token that renews the access when it expires.
    clientId: text("client_id").references(() => oauthClients.id, { onDelete: "cascade" }),
    refreshHash: text("refresh_hash"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("api_tokens_hash_unique").on(t.tokenHash),
    uniqueIndex("api_tokens_refresh_unique").on(t.refreshHash),
    index("api_tokens_user_idx").on(t.userId),
  ],
);

/** Apps that registered themselves to connect with OAuth (such as Claude's connectors). */
export const oauthClients = sqliteTable("oauth_clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  redirectUris: text("redirect_uris", { mode: "json" }).$type<string[]>().notNull(),
  createdAt: createdAt(),
});

/** Codes given to an app once the user allowed it, exchanged within minutes for its token. */
export const oauthCodes = sqliteTable("oauth_codes", {
  codeHash: text("code_hash").primaryKey(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClients.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  redirectUri: text("redirect_uri").notNull(),
  // PKCE: the S256 hash of the secret the app proves it holds.
  codeChallenge: text("code_challenge").notNull(),
  workspaceIds: text("workspace_ids", { mode: "json" }).$type<string[]>().notNull(),
  readOnly: integer("read_only", { mode: "boolean" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
});

/** What apps and agents changed with a user's tokens, for "My account". */
export const agentActivity = sqliteTable(
  "agent_activity",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The token's name when it was used: kept after the token is revoked.
    agent: text("agent").notNull(),
    // What was done, e.g. "page.create", "content.replace", "row.update".
    action: text("action").notNull(),
    pageId: text("page_id"),
    createdAt: createdAt(),
  },
  (t) => [index("agent_activity_user_idx").on(t.userId, t.createdAt)],
);

/** Links to a button's form, for people without an account: their answers run the button's steps as its author. */
export const publicForms = sqliteTable(
  "public_forms",
  {
    token: text("token").primaryKey(),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    blockId: text("block_id").notNull(),
    // Who made the link: the steps run with their rights.
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("public_forms_block_unique").on(t.pageId, t.blockId)],
);

/** A discussion on a page: about a passage (anchor) or the whole page. Its messages are in `comments`. */
export const commentThreads = sqliteTable(
  "comment_threads",
  {
    id: text("id").primaryKey(),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    // Encoded Yjs relative positions (base64) of the passage's start and end; null for the whole page.
    anchorStart: text("anchor_start"),
    anchorEnd: text("anchor_end"),
    quote: text("quote").notNull().default(""),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    resolvedBy: text("resolved_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("comment_threads_page_idx").on(t.pageId)],
);

export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => commentThreads.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Plain text; `<@userId>` mentions someone.
    body: text("body").notNull(),
    editedAt: integer("edited_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [index("comments_thread_idx").on(t.threadId)],
);

/** Someone was mentioned in a comment, or a thread they take part in got a reply. */
export const commentNotifications = sqliteTable(
  "comment_notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    commentId: text("comment_id")
      .notNull()
      .references(() => comments.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["mention", "reply"] }).notNull(),
    readAt: integer("read_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [index("comment_notifications_user_idx").on(t.userId, t.createdAt), uniqueIndex("comment_notifications_unique").on(t.userId, t.commentId)],
);

/** "When this happens to a row of the database, run these steps" (see automations.ts). */
export const automations = sqliteTable(
  "automations",
  {
    id: text("id").primaryKey(),
    databaseId: text("database_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    name: text("name").notNull().default(""),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    trigger: text("trigger", { mode: "json" }).notNull(),
    steps: text("steps", { mode: "json" }).notNull(),
    // The steps run as this person, with their rights.
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [index("automations_database_idx").on(t.databaseId)],
);

export const automationRuns = sqliteTable(
  "automation_runs",
  {
    id: text("id").primaryKey(),
    automationId: text("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    rowId: text("row_id"),
    // For dates reached: "<row>:<date>", so that each date sets it off once.
    key: text("key"),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("automation_runs_idx").on(t.automationId, t.createdAt), uniqueIndex("automation_runs_key_unique").on(t.automationId, t.key)],
);

/** A template that makes a new page or row on a schedule (see recurrences.ts). */
export const recurrences = sqliteTable("recurrences", {
  templateId: text("template_id")
    .primaryKey()
    .references(() => pages.id, { onDelete: "cascade" }),
  rule: text("rule", { mode: "json" }).notNull(),
  nextRunAt: integer("next_run_at", { mode: "timestamp_ms" }),
  lastRunAt: integer("last_run_at", { mode: "timestamp_ms" }),
  lastError: text("last_error"),
  // New pages are made as this person, with their rights.
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
});

/** People mentioned in page content ("@Name"): one row per mention, which is also their notification. */
export const pageMentions = sqliteTable(
  "page_mentions",
  {
    id: text("id").primaryKey(),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    // The id of the mention in the content.
    mentionId: text("mention_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
    // The line it is on, as it was written.
    excerpt: text("excerpt").notNull().default(""),
    readAt: integer("read_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [index("page_mentions_user_idx").on(t.userId, t.createdAt), uniqueIndex("page_mentions_unique").on(t.pageId, t.mentionId)],
);

/** The schedule of automatic backups (one row, "default"), and how the last one went. */
export const backupSchedules = sqliteTable("backup_schedules", {
  id: text("id").primaryKey(),
  // BackupScheduleInput, without the WebDAV password.
  config: text("config", { mode: "json" }).notNull(),
  // The WebDAV password, encrypted with APP_SECRET.
  secret: text("secret"),
  nextRunAt: integer("next_run_at", { mode: "timestamp_ms" }),
  lastRunAt: integer("last_run_at", { mode: "timestamp_ms" }),
  lastError: text("last_error"),
  lastName: text("last_name"),
  lastSize: integer("last_size"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

/** Images people uploaded to use as page icons, shared by everyone on the server. Pages refer to one as "icon:<id>". */
export const customIcons = sqliteTable("custom_icons", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // The file's name in the "icons" folder of the data folder.
  file: text("file").notNull(),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});
