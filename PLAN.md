# Nootion: design and roadmap

> Status: **V1 done** (version 1.0.0). This document records the original design and what comes next.

## 1. Vision

An open-source note-taking app in the spirit of Notion and Docmost, self-hostable on a NAS (TrueNAS) with Docker,
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
| Deployment | **Single Docker image** + `docker-compose.yml` | Installs as a YAML "Custom App" on TrueNAS SCALE |

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

1. **Foundation**: monorepo, Fastify + SQLite, accounts, sessions, Docker image running on the NAS.
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

## 8. After V1.1

- **Nextcloud** plugin (pick a Nextcloud file and insert it in a page or a "file" property) and **Google Calendar** plugin
  (an agenda block, and syncing a database's date property with a calendar).
- Per-user plugin credentials (OAuth, Nextcloud account), stored encrypted, and plugin property types.
- Search in the property values of database rows.
- Page titles updated live for other users.
- Later: calendar, gallery and chart views; OIDC sign-in (Authentik, Nextcloud…); scheduled Markdown export to a NAS folder;
  comments; version history; templates; more interface languages.
