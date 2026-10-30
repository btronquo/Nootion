# Nootion: design and roadmap

> Status: **V1.1 done** (version 1.1.0). This document records the original design and what comes next.

## 1. Vision

An open-source note-taking app in the spirit of Notion and Docmost, self-hostable with Docker (home server, NAS or VPS),
whose flagship feature is **databases**: typed tables, relations between databases, formulas, filters, sorts,
groups and calculations (for example, an invoice log related to a suppliers database, with the total per supplier and per year).

Principles:

- **Easy to host**: one container, one `/data` volume, no Redis or separate database server.
- **Your data stays yours**: Markdown export of pages, CSV/JSON export of databases, backup = copying a folder.
- **Multi-user and private by default**: nobody sees a page that wasn't shared with them, as in Notion.
- **Extensible**: a plugin system to connect Nextcloud, Google Calendar, and so on.
- **AGPL-3.0 license**.

## 2. Existing projects

| Project | Databases | Why it isn't quite enough |
|---|---|---|
| Docmost | No | A well-liked starting point, but no databases; heavy stack (NestJS + Postgres + Redis) |
| AFFiNE | Yes (basic) | Limited formulas and calculations, heavier to self-host |
| AppFlowy | Yes (grid, board, calendar) | Complex self-hosting (several services), limited formulas |
| Outline / BookStack / Wiki.js | No | Wiki-oriented |
| NocoDB / Baserow | Yes, very complete | They are "Airtables", not note-taking tools |

Nootion's niche: **Docmost's simplicity + serious databases (relations, rollups, formulas, calculations), all in a single container.**

## 3. Technical stack

All **TypeScript**, in a monorepo (front end, back end, formula engine and plugin SDK share the same types).

| Layer | Choice | Why |
|---|---|---|
| Editor | **TipTap** (ProseMirror) | Mature block editor, extensible (needed for plugins), Markdown export doable |
| Collaborative editing | **Yjs + Hocuspocus** | Two people can edit the same shared page without overwriting each other |
| Front end | **React + Vite** | Richest ecosystem for TipTap and tables |
| UI | Tailwind | Fast to build, accessible |
| Back end | **Node.js + Fastify** | Light, with a native plugin system |
| ORM | **Drizzle ORM** | Typed, simple migrations, supports SQLite and Postgres |
| Database | **SQLite** (WAL mode, file in `/data`) | No service to manage, backup = a file. Plenty for a family or a small team |
| Search | SQLite **FTS5**, filtered by permissions | Nothing to install |
| Formulas | **In-house engine** (parser + evaluator, shared package) | Safe (no `eval`), Notion-like syntax, handles `prop()` on relations and rollups |
| Files | `/data/uploads` folder, served only after an access check | Simple, included in backups |
| Auth | Local accounts (argon2 password hashes) + session cookie | Enough for self-hosting; OIDC later, as a plugin |
| Translations | In-house catalogue in `packages/shared/src/i18n` | Typed keys, shared by the server (errors, exports) and the browser |
| Deployment | **Single Docker image** + `docker-compose.yml` | Runs anywhere Docker runs (home server, NAS, VPS), amd64 and arm64 |

## 4. Users, spaces and permissions

Modeled on Notion:

- **Personal space**: each user has a private space. Its pages are only visible to them.
- **Shared spaces** (e.g. "Home", "Club"): a space has members with a role (**owner, editor, commenter, viewer**).
  Every page of the space is visible to its members, according to their role.
- **Sharing a page with a user**: a page can be shared with a given user and a role. The share **applies to subpages** (inheritance).
- **Public link**: a page (and optionally its subpages) can be published **read only** through an unguessable link, revocable at any time.
- **Private by default, checked on the server**: knowing a page's URL is never enough. Every request (page, database row,
  attached file, search, export, relation, formula) goes through the same access check.
- **Administration**: an admin account (created at first launch) manages users (invitation links, disabling).
  No public sign-up.

Access control is **covered by automated tests** (a second user gets an error on every resource of the first one).

## 5. Plugin system

A plugin is a folder (in `/data/plugins` or built into the image) with a manifest that declares:

- **Editor**: new blocks and `/` commands (e.g. `/embed`).
- **Databases**: new formula functions (new property types later).
- **Server**: API routes, scheduled tasks.
- **Settings**: a settings form generated from the manifest; the admin turns each plugin on or off.

Safeguards: plugins check access through the same rules as the app (a plugin only shows what the user can see).
No marketplace: plugins are installed on trust, as on any personal server. See [docs/PLUGINS.md](docs/PLUGINS.md).

## 6. V1 scope (delivered)

1. **Foundation**: monorepo, Fastify + SQLite, accounts, sessions, Docker image.
2. **Spaces and permissions**: spaces, roles, sharing, public links, with access tests from the start.
3. **Pages**: page tree, TipTap editor, collaborative editing (Yjs).
4. **Databases**: typed properties, table view, inline editing.
5. **Relations and rollups**.
6. **Formula engine** (with unit tests).
7. **Filters, sorts, groups, calculations**, saved views, board view.
8. **Plugins**: SDK, loading, administration, "Embeds" plugin.
9. **Export / import**: Markdown, CSV / JSON, backup.
10. **Search, polish, deployment guide, first release**, English and French interface.

## 7. Version 1.1

Three gaps that Notion and the self-hosted alternatives leave open.

1. **Mobile app that edits, not just reads** (PWA, done). Installable from the browser (manifest, icons, service worker),
   with a layout made for phones: sidebar as a drawer, a toolbar above the keyboard for the editor, the `/` menu
   and block actions usable by touch, database rows opened as cards instead of a wide table.
2. **Offline and sync** (done). The app shell and recently opened pages stay available without a network. Page bodies are
   already Yjs documents: they are kept in IndexedDB, edited offline and merged with no conflict when the connection
   comes back. Database changes made offline go into a queue replayed in order, with a clear rule when a row was
   changed on both sides (last write wins per cell; changes the server refuses are shown to the user). An indicator shows what is waiting to sync.
3. **Lossless import from Notion** (done). Through the Notion API (an integration token), not the Markdown export:
   page tree, emoji icons, blocks, databases with their property types, select options, relations, rollups
   and formulas (translated to Nootion's formula language, with a report of what could not be converted),
   attachments and links between pages. Notion's API does not expose views, so views are recreated as a default
   table view. The import can run again to bring in what changed.

## 8. Version 1.2

What makes everyday use comfortable, in this order (quick wins first, then what builds on them).

1. **Favorites** (done). A star on each page and database; a "Favorites" section at the top of the sidebar, per user,
   reorderable by drag and drop. Also in the mobile drawer.
2. **Cover images** (done). A cover at the top of a page (uploaded image or link, a few built-in gradients),
   repositioned by dragging, shown on public pages. The Notion import brings covers in.
3. **Toggles and columns** (done). Collapsible blocks (and toggle headings) and side-by-side columns in the editor.
   They are the two blocks the Notion import can't render as they are today.
4. **New database views**, next to table and board, each with its own filters, sorts and properties shown:
   - *Calendar* (done): rows placed on a date property, month and week, drag a row to change its date, click a day to add one;
   - *Gallery* (done): cards with the row's cover or first image;
   - *List* (done): one compact line per row;
   - *Timeline* (done): bars from a start date to an end date (date ranges), dragged to move or resize.
5. **Calendar widget** (done). A `/calendar` block for any page that gathers the dated rows of one or several databases
   (tasks, appointments, bills due…), each with its colour. Read-only iCal feed (private link) to see these dates
   in a phone or desktop calendar.
6. **Personal home page** (done). A home page per user, opened at sign-in (and from "Home" in the sidebar), made of widgets
   each user arranges: a greeting, recently visited pages (cards with their cover), favorites, upcoming events (the
   calendar block's rows, next days first), the first rows of a database view (e.g. the 5 open to-dos), and any page
   content (it is an ordinary page underneath, so every block works there). Builds on the calendar widget and the
   database views.
7. **Templates** (done). Page templates and database row templates (content and default values), chosen when creating.
8. **Page history** (done). Snapshots of each page kept over time, compared and restored (built on Yjs).
9. **Backlinks** (done). "Linked from" at the bottom of a page: the pages that link or mention it.
10. **Search inside attached files** (done). Text of PDFs and of images (OCR, e.g. scanned bills), indexed when the file
   arrives, in a background job; results point to the page holding the file.
11. **Dates in plain words and reminders** (done). Typing `@tomorrow`, `@friday`, `@15/11 9:00` in the editor inserts a date;
    a date can carry a reminder, shown in the app (and as a notification of the installed app) when it is due.
12. **API with personal tokens** (done). A documented REST API (read and write pages, query and fill databases, search),
   with tokens created in "My account", each limited to some spaces and read-only or read-write.
   It is what the V2 MCP server builds on.

Possible later in 1.x: comments and @mentions with notifications, search in database values with filters
(`status:paid`) and saved searches, a command palette (Ctrl+K also runs actions), one view of all the to-dos of all
pages, a Markdown mirror (every page kept as a `.md` file in a folder of the NAS, readable by other tools), page titles updated
live for other users, chart view, OIDC sign-in (Authentik, Nextcloud…), scheduled Markdown export to a NAS folder,
more interface languages.

## 9. Version 2

- **MCP server**, so that Claude (or another assistant) can work with Nootion: search, read and write pages, query
  databases and add or change rows, within the rights of the token's owner. Served by Nootion itself over HTTP
  (remote MCP), connected to Claude as a custom connector with a token from "My account".
  Each agent token is limited to some spaces and to reading or writing; what an agent changed is logged, and text
  written by an AI is marked as such.
- **Buttons with automations and forms.** A button block in pages, and a button column in databases, that runs a
  list of steps when clicked: add a row to a database, change properties of the current row, create a page from a
  template, open a page or a link, call a webhook. Steps can use variables (current row, current user, today's
  date, values of the row). Optionally the button first opens a **form**: its fields (text, number, date, select,
  person, file…) are filled in, then their values feed the steps, for example to add an expense to a database
  from a phone in a few taps. A form can also get a link of its own, to collect answers from people without an
  account (public form, with rate limiting).
- **Nextcloud** plugin (pick a Nextcloud file and insert it in a page or a "file" property) and **Google Calendar** plugin
  (syncing a database's date property with a calendar).
- Per-user plugin credentials (OAuth, Nextcloud account), stored encrypted, and plugin property types.
