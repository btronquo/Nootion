<div align="center">

# Nootion

**Your pages, wikis and real databases, on your own server.**<br>
An open-source, self-hosted workspace that fits in a single Docker container.

[![Version 4.2.0](https://img.shields.io/badge/version-4.2.0-7c3aed)](CHANGELOG.md)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)
[![CI](https://github.com/btronquo/Nootion/actions/workflows/ci.yml/badge.svg)](https://github.com/btronquo/Nootion/actions/workflows/ci.yml)
[![Docker image](https://img.shields.io/badge/docker-ghcr.io%2Fbtronquo%2Fnootion-2496ED?logo=docker&logoColor=white)](https://github.com/btronquo/Nootion/pkgs/container/nootion)
[![amd64 | arm64](https://img.shields.io/badge/platforms-amd64%20%7C%20arm64-555)](docs/DEPLOYMENT.md)
<br>
[![Languages](https://img.shields.io/badge/languages-EN%20%C2%B7%20FR%20%C2%B7%20DE%20%C2%B7%20ES%20%C2%B7%20IT-0f766e)](docs/TRANSLATING.md)
[![Desktop app](https://img.shields.io/badge/desktop-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-444)](docs/DESKTOP.md)
[![PWA](https://img.shields.io/badge/phone-installable%20app%20%C2%B7%20offline-5a0fc8)](docs/DEPLOYMENT.md#installing-the-app-on-a-phone-or-computer)
[![Self-hosted](https://img.shields.io/badge/self--hosted-no%20telemetry-success)](#why-nootion)
[![Node.js 22](https://img.shields.io/badge/node-22-339933?logo=node.js&logoColor=white)](#development)

[Getting started](#getting-started) · [Screenshots](#screenshots) · [All features](#all-features) ·
[Documentation](#documentation) · [What's new](CHANGELOG.md)

</div>

> Version 4.2.0. See [CHANGELOG.md](CHANGELOG.md) for what changed.

![A Nootion page with its sidebar, a callout, a table of contents and formatted text](docs/screenshots/editor.png)

## Why Nootion

Most workspace apps are closed cloud services: your notes live on their servers, under their terms and prices. The
open-source ones you can host yourself are often built for wikis only. Nootion brings the two together: the freedom of
an open-source app you host yourself, and the databases that make a workspace really useful.

- **Your data stays at home.** One container and one data folder (a SQLite file and your attached files):
  backing up Nootion is copying a folder. No telemetry, no external service needed.
- **Real databases.** Typed columns, relations in both directions, rollups, formulas, filters, sorts, groups and
  calculations, table, board, list, gallery, calendar and timeline views, embedded in any page. Enough to run
  invoices, projects, a reading list or a CRM.
- **Move in without losing anything.** Import from other tools (through their API, or from Markdown, HTML, Word and
  CSV files): pages, databases, relations, rollups, formulas, files and links between pages come along.
- **Write together.** Real-time collaborative editing, comments and @mentions, shared spaces with roles, groups,
  guests from outside, and public links with an optional password and end date, every access checked on the server.
- **Secure by default.** Two-factor authentication, passkeys, single sign-on and SCIM, and an activity log for
  administrators.
- **Let it run by itself.** Database automations, recurring templates, buttons, and automatic backups to a NAS or
  Nextcloud.
- **On the phone and the desktop, even offline.** Installs as an app on phones; a desktop app for Windows, macOS and
  Linux keeps whole spaces on the computer. Pages stay readable and editable offline and sync when the connection
  comes back, merged with others' changes.
- **Yours to extend.** Plugins add editor blocks, database column types, entries in the selection menu, API routes,
  scheduled tasks and formula functions. An optional AI assistant works with your own key or a model on your network.
- **Open for good.** Licensed under the AGPL-3.0: the code, and the code of any hosted version of it, stays open.
- **Light.** Runs on a small home server or NAS (amd64 and arm64), no separate database server or Redis.

The interface is available in English, French, German, Spanish and Italian; each user picks their language.

## Screenshots

### Write

| | |
| --- | --- |
| ![A callout and a list shown in two pages at once, with "Synced in 2 pages", "Copy synced block" and "Unsync"](docs/screenshots/synced-blocks.png) | ![A page with an inline equation, a centred equation block and a Mermaid flowchart](docs/screenshots/equations-mermaid.png) |
| **Synced blocks**: the same content in several pages, edited from any of them. | **Equations and diagrams**: LaTeX in a line or as a block, and Mermaid diagrams drawn as you type. |
| ![The AI assistant's chat beside a page, answering "What is left to do?" with "Insert in the page" and "Copy"](docs/screenshots/ai-chat-page.png) | ![The command palette in German, listing the actions of the open page](docs/screenshots/languages.png) |
| **AI assistant** (optional plugin): summarise, translate, rewrite or chat about a page, with your own key or a local model. | **Five languages** and a **command palette** (Ctrl+K) for pages and actions. Here in German. |

### Organise

| | |
| --- | --- |
| ![The Projects database as a table, with status, priority, date range and owner columns](docs/screenshots/database-table.png) | ![The same database as a board grouped by status](docs/screenshots/database-board.png) |
| **Databases**: one database, many views (table, board, calendar, timeline, gallery, list). | **Board** view, grouped by any select or status column. |
| ![The database as a monthly calendar, with multi-day entries shown as bars](docs/screenshots/database-calendar.png) | ![The options of a status column, sorted into To do, In progress and Done](docs/screenshots/status-options.png) |
| **Calendar** with date ranges and times. | **Status** columns: options sorted into To do, In progress and Done. |
| ![A table view with an ID column (PRJ-1…), a status column, progress bars and phone numbers](docs/screenshots/database-columns.png) | ![Clock, weather, donut and bar charts and progress bars widgets](docs/screenshots/widgets.png) |
| **Column types** for tracking: IDs, progress bars, phone numbers, last edited by and more. | **Widgets** for dashboards: charts, progress, weather, clock and more. |

### Share and administer

| | |
| --- | --- |
| ![The share window of a page, with a guest from another company who can comment, "Invite a guest" and the public link](docs/screenshots/share-guests.png) | ![Administration: a group of two people, and the guests with the pages they see](docs/screenshots/groups-guests.png) |
| **Guests**: invite someone from outside on one page, nothing else. | **Groups**: share a space or a page with a whole team at once. |
| ![The activity log: account created, guest invited, page shared, member added to a group, with filters and a CSV export](docs/screenshots/activity-log.png) | ![Dragging a draft from the personal space to a shared space asks who will see it](docs/screenshots/move-between-spaces.png) |
| **Activity log**: who signed in, shared, exported or changed what, with filters and a CSV export. | **Move pages between spaces**: write a draft privately, then share it by dragging it. |

### Get started

| | |
| --- | --- |
| ![The setup assistant: eight steps from the server to the team, the first one open](docs/screenshots/setup-assistant.png) | ![A card of the guided tour, "Pages made of blocks", with the keys to press](docs/screenshots/guided-tour.png) |
| **Setup assistant** for administrators: e-mail, sign-in, backups, AI, plugins and team, one step at a time. | **Guided tour** for each new account, shown once and available again at any time. |
| ![The demo page in dark mode](docs/screenshots/dark.png) | |
| **Dark mode**, following the system or picked by hand. | |

## Getting started

```bash
mkdir nootion && cd nootion
curl -O https://raw.githubusercontent.com/btronquo/Nootion/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/btronquo/Nootion/main/.env.example
# Set APP_SECRET (openssl rand -hex 32) and APP_URL in .env, then:
docker compose up -d
```

Then open `APP_URL` and create the administrator account: the setup assistant takes you through the main settings.
The image, `ghcr.io/btronquo/nootion`, runs on amd64 and arm64.
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) covers `docker run`, updates, backups, HTTPS, S3 storage, installing the app
on a phone, offline use and imports.

## All features

### Accounts and spaces

- First launch: creation of the administrator account, then a setup assistant for the main settings (e-mail, sign-in,
  backups, AI assistant, plugins, team), which can be skipped and opened again from Administration.
- A guided tour of the features for each new account, shown once and available again from My account or the palette.
- Sign in / sign out, secure sessions (httpOnly cookie, argon2 password hashes).
- Two-factor authentication with an authenticator app (6-digit codes), with recovery codes; administrators can
  turn it off for someone who lost their phone.
- Passkeys (fingerprint, face, phone, password manager or security key): sign in without typing anything; a passkey
  counts as both steps of two-factor authentication, and the password still works.
- Invitations by link (valid 7 days, optionally restricted to one email), admin / member roles, account disabling.
- Guests: people from outside invited on one page from its share window, who only see the pages shared with them
  (no spaces, no people directory, no API tokens); administrators list them apart, make them members or forbid them.
- Activity log for administrators: sign-ins, shares, public links, exports, deletions, roles and settings, with filters,
  a CSV export and a chosen retention time.
- A private personal space for each user, and shared spaces with roles (owner, editor, commenter, viewer).
- Groups of people made by administrators (or by the company's directory through SCIM): share a space or a page with
  a whole group, and `@group` in a page tells everyone in it.
- Pages move between spaces with their subpages (drag and drop in the sidebar, or "Move to…"): write a draft in
  your personal space, then share it by moving it into a shared space.
- Single sign-on with Microsoft Entra ID, Google, Okta, Keycloak or any OpenID Connect provider, and SCIM so that
  people who leave the company are disabled automatically. See [docs/SSO.md](docs/SSO.md).
- Branding: your own name and logo instead of Nootion's (sidebar, sign-in page, browser tab, installed app and
  e-mails), set in Administration, with a discreet "Powered by Nootion" under it.
- "My account" page: name, email, password, profile picture, language, light / dark / system theme, imports, emptying a space and deleting the account with its data.
- Interface in English, French, German, Spanish and Italian, chosen per user; dates, numbers and plurals follow the language, and a partly translated language falls back to English text by text.

### Pages and editor

- Page tree (subpages, drag and drop, icons), cover images, trash with restore, favorites at the top of the sidebar.
- Pages are private by default: share a page with a user (inherited by subpages), or through a revocable read-only public link, optionally protected by a password and an end date.
  Every access check is done on the server (`apps/server/src/permissions.ts`) and covered by tests.
- Block editor ("/" commands, to-do lists, tables, callouts, toggles, columns, images and attached files,
  links between pages with "@", people mentions, table of contents), with real-time collaborative editing.
- Several blocks selected at once (a rectangle drawn from the margin, Shift+click, Escape, or Ctrl+A twice) to copy,
  cut, delete, duplicate, colour or move them together. See [docs/EDITOR.md](docs/EDITOR.md#selecting-several-blocks).
- Repeating to-dos: checked, their date moves on to the next day, week, month or chosen days, reminder included.
- Tasks: every to-do of every page you can read in one list, by page or by date (overdue, today, this week…), checked
  from there, with a home page widget. See [docs/EDITOR.md](docs/EDITOR.md#tasks-all-your-to-dos-in-one-list).
- Text colour and highlight on a selection (Ctrl+Shift+H for yellow), on the computer and on the phone.
- Code blocks coloured by their language (about 35, chosen or guessed), with a copy button and line wrapping.
- Equations in LaTeX, in a line (`$…$`) or as a centred block (`/equation`), edited with a live preview and kept in
  Markdown export and import. See [docs/EDITOR.md](docs/EDITOR.md#equations).
- Synced blocks: the same blocks in several pages, edited from any of them ("Turn into synced block", then paste it
  elsewhere, or `/synced`). See [docs/EDITOR.md](docs/EDITOR.md#synced-blocks-the-same-content-in-several-pages).
- Mermaid diagrams (`/mermaid`, or any code block set to "Mermaid"): flowcharts, sequences, Gantt charts… drawn as
  you type.
- Lock a page or a database against accidental edits, from its menu or the command palette. See
  [docs/EDITOR.md](docs/EDITOR.md#locking-a-page-or-a-database).
- Columns side by side with a bar to resize them.
- Print a page or save it as PDF (Ctrl+P): only the page, toggles open, every row of its databases, optional new
  sheet before headings. See [docs/EDITOR.md](docs/EDITOR.md).
- Images: a handle on each side to resize them, and a bar to align, caption, comment, crop (free or 1:1, 4:3,
  16:9, 3:4, the file stays whole), download or reset them. They open full screen to go through a page's images.
- Videos (`/video`): YouTube, Vimeo, Dailymotion, Loom, PeerTube, Twitch or Google Drive links, or video files.
- Drawing block (`/drawing`): pen, highlighter, shapes, arrows and text boxes, saved with the page, with a
  full-screen whiteboard and an SVG download.
- Comments on a passage or on the whole page: threads with replies, resolved and reopened, that follow their
  passage as the page is edited. "@" mentions someone, in a comment or in the page, and notifies them.
- Quick capture (Ctrl+Alt+N or ⌘⌥N, or shared from another app to the installed app): a note dropped in your inbox,
  to file later.
- Page history: versions kept automatically with their authors, changes highlighted, any version restored.
- Backlinks: each page lists the pages that mention it.
- Page graph: the pages of your spaces and the links between them, as a map to explore.
- "Full width" option per page.

### Databases

- Databases: typed columns (text, number, currency amount, percent (optionally as a progress bar), date, select,
  multi-select, status (options in To do / In progress / Done), checkbox, link, email, phone, person, files, ID
  (numbered rows with an optional prefix), created time, last edited time, created by, last edited by), table view (column order, width and visibility),
  each row opens as a page with its properties. Rows have a full menu (right click or ⋮⋮: favorite, icon, open,
  copy link, duplicate, trash), a "+" to add one just below, and can be dragged to reorder them. A database can be
  a page of its own or embedded in a page
  (`/database` command), and shows read-only on public links.
- Database pages are easy to spot: a small mark on their icon everywhere, a "Database" badge that explains them, and a
  short description under the title.
- Linked views (`/linked view`): an existing database shown in any page, with its own filters, sorts and views. See
  [docs/EDITOR.md](docs/EDITOR.md#linked-views-a-database-shown-in-another-page).
- Calculations under columns (sum, average, median, min, max, count, percent checked, dates…).
- Relations between databases (one way or both ways, kept up to date automatically) and rollups
  (e.g. the total of a supplier's invoices).
- Sub-items and dependencies: rows shown under their parent in tables, folded or not, with the share of sub-items
  done; "Blocked by" / "Blocking" drawn as arrows on the timeline, with the rows that wait moving along with the
  dates if wanted. See [docs/DATABASES.md](docs/DATABASES.md).
- Formulas: `prop("Price") * 1.2`, `if(prop("Paid"), "OK", "To pay")`, `dateBetween(now(), prop("Due"), "days")`…
  Editor with live checking and function help; formulas work with relations, rollups and calculations. The newer
  formula syntax works too: lists `[1, 2]`, methods `prop("Name").upper()`, `let`/`lets`, and `map`, `filter`, `find`,
  `some`, `every`, `sort` with `current`, including the columns of related pages:
  `prop("Invoices").filter(current.prop("Paid")).map(current.prop("Total")).sum()`.
- Several views per database (table, board, list, gallery, calendar or timeline), each with its own filters
  (and / or, relative dates such as "the next week"), sorts, groups and visible columns. Drag and drop between board
  columns, between calendar days to change a date, and along the timeline to move or stretch a date range.
- A `/calendar` block for any page: the dated rows of several databases on one calendar, each in its colour,
  with a private iCal link to follow them in a phone or desktop calendar (Google, Apple, Outlook, Thunderbird).
- Templates: row templates (content and default values, one used for every new row if chosen) and page templates
  offered on any empty page, copied with their subpages, databases and files. A template can repeat: a new page or
  row every N days, on some days of the week or on a day of the month.

### Home page and widgets

- A personal home page with widgets: recently visited pages, your to-dos, favorites, upcoming events, the first rows of a
  database view (e.g. the open to-dos), arranged by each user.
- Widgets for any page, from the "/" menu: charts of a database (bars, columns, line, donut), progress bars (of the
  year, of a goal, of the rows checked), countdown, Pomodoro timer, habit tracker, clock, weather, quote of the day and
  image carousel.

### Automation

- Database automations: when a row is added, a column changes or a date arrives, run steps on the row (e.g. "Status
  set to Paid → fill in the payment date"), or on a schedule (every day, week or month), with the last runs and
  their errors listed. Steps can hold formulas (`{{= dateAdd(prop("Due"), 1, "weeks")}}`).
- Buttons with automations and forms: add a row, change the current row, create a page from a template, open a
  link, call a webhook, after an optional form that can also be opened by a public link. See [docs/BUTTONS.md](docs/BUTTONS.md).
- Dates written in plain words (`@tomorrow 9am`, `@vendredi`, `@in 3 days`) with reminders, sent as notifications
  to the phone or computer, and by e-mail.
- E-mail through any SMTP server or Resend, set in Administration: reminders, mentions, replies, invitations and
  "Forgot password"; each user picks the e-mails they get.

### Search

- Full-text search in page titles and content (Ctrl+K or ⌘K), accent-insensitive, limited to the pages the user can read.
- Search inside attached files: PDFs, images and scans (OCR), text files.
- Search inside database values ("Dupont" finds the invoice whose customer is Dupont), with filters (space, type,
  database, author, edited since) and searches saved under a name.
- Command palette: the same Ctrl+K box lists actions too (new page, go to…, theme, the open page's share, history,
  move, print…); type ">" for actions only. See [docs/EDITOR.md](docs/EDITOR.md).

### Integrations and extensions

- REST API with personal tokens (per space, read-only or read and write): pages as Markdown, database queries,
  rows, files, search. See [docs/API.md](docs/API.md).
- Built-in MCP server: connect Claude (as a custom connector) or another AI agent to search, read and write your
  pages and databases, within the spaces you choose, with every change it makes logged. See [docs/MCP.md](docs/MCP.md).
- Plugins: editor blocks, database column types, API routes, scheduled tasks and formula functions, turned on and
  set up in the administration. See [docs/PLUGINS.md](docs/PLUGINS.md) to write your own. Nootion ships with:
  - "Embeds" (`/embed`: YouTube, Vimeo, Spotify, Google Maps, Figma, link previews);
  - "Nextcloud": each person connects their account, then copies files into pages and "File" columns, or links to
    them ([docs/NEXTCLOUD.md](docs/NEXTCLOUD.md));
  - "Google Calendar": syncs a database with a Google calendar, both ways, with the administrator's OAuth client or
    each person's own ([docs/GOOGLE_CALENDAR.md](docs/GOOGLE_CALENDAR.md));
  - "Ratings": a column of one to five stars;
  - "Test management (QA)": test cases, runs and results as in TestRail, over several products at once
    ([docs/QA.md](docs/QA.md));
  - "Map": the rows of a database as pins on a map, places added by address or with a click, the nearest ones to
    you ([docs/MAP.md](docs/MAP.md));
  - "AI assistant" (off by default): summarise, translate, improve or continue a selection, or ask about it, with
    your own key (Anthropic, OpenAI, Mistral) or a model on your network (Ollama); nothing is sent without a click
    ([docs/AI_ASSISTANT.md](docs/AI_ASSISTANT.md)).

### Import, export and backups

- Import from files: Markdown, HTML, Word (.docx), text or CSV files, or a zip of them (a folder of notes, an export
  from another tool). Folders become pages with subpages, CSV files databases, links and `[[wiki links]]` links
  between pages; the import can be undone as a whole. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#importing-from-files).
- Import from other tools through their API: pages, databases with their columns (status, IDs and phone numbers
  included), relations, rollups and formulas, files and links between pages, with a report of what was imported
  differently. Imported pages can then be moved to other spaces; importing again keeps updating them there.
  See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- Export a page or a space as Markdown (.zip: subpages, attached files, databases as CSV and JSON),
  export a database as CSV (or CSV for Excel) and JSON with computed formulas, import a CSV into a database
  (columns and options created as needed), full backup downloadable by the admin, and automatic backups every
  day or week to a folder of the server or a WebDAV folder (Nextcloud), keeping the last copies.
  See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

### Phone and offline

- Works on phones and installs as an app (PWA, over HTTPS): sidebar as a drawer, editing toolbar above the keyboard,
  database rows as cards. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#installing-the-app-on-a-phone-or-computer).
- Works offline: pages already opened stay readable and editable, and changes sync when the connection comes back
  (page content is merged with others' changes, database cells are sent in order).

### Desktop app

- For Windows, macOS and Linux: connect to one or more Nootion servers, or keep a space on the computer with no
  server at all. Spaces of a server can be synced to the computer, to work on them without a connection; changes
  from both sides are merged. See [docs/DESKTOP.md](docs/DESKTOP.md).

### Hosting

- Single Docker image (amd64 and arm64), data in `/data`.
- Attached files in the data folder, or in S3-compatible storage (AWS S3, MinIO, Garage, Backblaze B2, Cloudflare
  R2…) for larger instances. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#attached-files-in-s3-compatible-storage).
- Hardened by default: security headers and a content security policy, sign-in attempts limited, requests to
  addresses people type (webhooks, link previews) kept away from the server's own network, and a people directory
  limited to those one works with. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#securing-your-instance).
- "What's new" window after an update: the release notes of the versions each person hasn't seen yet.

## Documentation

| Guide | |
| --- | --- |
| [Deployment](docs/DEPLOYMENT.md) | Docker, variables, updates, HTTPS and security, S3 storage, passkeys, e-mail, imports, activity log |
| [Writing, finding and printing](docs/EDITOR.md) | Editor, equations, synced blocks, linked views, tasks, search, palette, guests, groups, public links |
| [Databases](docs/DATABASES.md) | Sub-items and dependencies |
| [Buttons](docs/BUTTONS.md) | Buttons, automations and forms |
| [AI assistant](docs/AI_ASSISTANT.md) | Services, settings and privacy |
| [Desktop app](docs/DESKTOP.md) | Windows, macOS and Linux, offline spaces |
| [Single sign-on](docs/SSO.md) | OpenID Connect and SCIM |
| [API](docs/API.md) and [MCP](docs/MCP.md) | REST API with tokens, and AI agents |
| [Plugins](docs/PLUGINS.md) | Writing your own; [Nextcloud](docs/NEXTCLOUD.md), [Google Calendar](docs/GOOGLE_CALENDAR.md), [QA](docs/QA.md), [Map](docs/MAP.md) |
| [Translating](docs/TRANSLATING.md) | Adding or finishing a language |
| [Architecture](docs/ARCHITECTURE.md) | Finding your way in the code |

## Development

Requirements: Node.js 22 and pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm dev          # server on :3000, interface on http://localhost:5173
pnpm test         # automated tests
pnpm typecheck
pnpm lint         # mistakes the compiler doesn't see (ESLint)
pnpm format       # formatting (Prettier, 160 columns)
pnpm build
```

After changing `apps/server/src/db/schema.ts`, run `pnpm --filter @nootion/server db:generate` to create the migration.
Migrations are applied automatically at startup.

Interface texts live in `packages/shared/src/i18n/` (`en.ts` is the reference, one file per language);
see [docs/TRANSLATING.md](docs/TRANSLATING.md) to add or finish a language, and `pnpm i18n:check` to check them.

To find your way in the code: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Project layout

```
apps/server      Fastify API + Drizzle + SQLite
apps/web         React + Vite + Tailwind interface
apps/desktop     Desktop app for Windows, macOS and Linux (Tauri), see docs/DESKTOP.md
packages/shared  Types, validation, formulas, views and translations shared by both
docker/          Dockerfile
docs/            Documentation (deployment, editor and search, architecture, API, SSO, plugins…)
```

## Contributing

Bug reports and ideas are welcome in the issues. Nootion doesn't accept code contributions (pull requests):
see [CONTRIBUTING.md](CONTRIBUTING.md).
For a security issue: [SECURITY.md](SECURITY.md).

## License

[AGPL-3.0](LICENSE)
