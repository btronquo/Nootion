# Nootion

**An open-source, self-hosted alternative to Notion, Capacities and Docmost**: pages, wikis and real databases,
on your own server, in a single Docker container.

> Version 1.1.0. See [CHANGELOG.md](CHANGELOG.md) for what changed and [PLAN.md](PLAN.md) for what comes next.

## Why Nootion

Notion and Capacities are closed cloud services: your notes live on their servers, under their terms and prices.
Docmost is open source and self-hosted, but is built for wikis and documentation. Nootion brings the two together:
the freedom of an open-source app you host yourself, and the databases that make Notion so useful.

- **Your data stays at home.** One container and one data folder (a SQLite file and your attached files):
  backing up Nootion is copying a folder. No telemetry, no external service needed.
- **Real databases.** Typed columns, relations in both directions, rollups, Notion-like formulas, filters, sorts,
  groups and calculations, table, board, list, gallery, calendar and timeline views, embedded in any page. Enough to run invoices, projects,
  a reading list or a CRM.
- **Leave Notion without losing anything.** The Notion import brings pages, databases, relations, rollups,
  formulas, files and links between pages, and can run again to fetch what changed.
- **Write together.** Real-time collaborative editing, shared spaces with roles, page sharing and read-only
  public links, with every access checked on the server.
- **On the phone, even offline.** Installs as an app on phones and computers; pages already opened stay readable
  and editable offline and sync when the connection comes back, merged with others' changes.
- **Yours to extend.** Plugins add editor blocks, API routes, scheduled tasks and formula functions.
- **Open for good.** Licensed under the AGPL-3.0: the code, and the code of any hosted version of it, stays open.
- **Light.** Runs on a small home server or NAS (amd64 and arm64), no separate database server or Redis.

The interface is available in English and French; each user picks their language.

## Getting started

```bash
mkdir nootion && cd nootion
curl -O https://raw.githubusercontent.com/btronquo/Nootion/main/docker-compose.yml
# Set APP_URL and APP_SECRET in docker-compose.yml, then:
docker compose up -d
```

Then open `APP_URL` and create the administrator account. The image, `ghcr.io/btronquo/nootion`, runs on amd64 and arm64.
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) covers `docker run`, updates, backups, HTTPS, installing the app on a phone,
offline use and the Notion import.

## All features

- First launch: creation of the administrator account.
- Sign in / sign out, secure sessions (httpOnly cookie, argon2 password hashes).
- Invitations by link (valid 7 days, optionally restricted to one email), admin / member roles, account disabling.
- A private personal space for each user, and shared spaces with roles (owner, editor, commenter, viewer).
- Page tree (subpages, drag and drop, icons), cover images, trash with restore, favorites at the top of the sidebar.
- Pages are private by default: share a page with a user (inherited by subpages), or through a revocable read-only public link.
  Every access check is done on the server (`apps/server/src/permissions.ts`) and covered by tests.
- Notion-like page editor ("/" commands, to-do lists, tables, callouts, toggles, columns, images and attached files,
  links between pages with "@"), with real-time collaborative editing.
- Databases: typed columns (text, number, currency amount, percent, date, select, multi-select, checkbox, link,
  email, person, files, created time, last edited time, created by), table view (column order, width and visibility),
  each row opens as a page with its properties. A database can be a page of its own or embedded in a page
  (`/database` command), and shows read-only on public links.
- Calculations under columns (sum, average, median, min, max, count, percent checked, dates…).
- Relations between databases (one way or both ways, kept up to date automatically) and rollups
  (e.g. the total of a supplier's invoices).
- Notion-like formulas: `prop("Price") * 1.2`, `if(prop("Paid"), "OK", "To pay")`, `dateBetween(now(), prop("Due"), "days")`…
  Editor with live checking and function help; formulas work with relations, rollups and calculations.
- Several views per database (table, board, list, gallery, calendar or timeline), each with its own filters
  (and / or, relative dates such as "the next week"), sorts, groups and visible columns. Drag and drop between board
  columns, between calendar days to change a date, and along the timeline to move or stretch a date range.
- A `/calendar` block for any page: the dated rows of several databases on one calendar, each in its colour,
  with a private iCal link to follow them in a phone or desktop calendar (Google, Apple, Outlook, Thunderbird).
- A personal home page with widgets: recently visited pages, favorites, upcoming events, the first rows of a
  database view (e.g. the open to-dos), arranged by each user.
- Templates: row templates (content and default values, one used for every new row if chosen) and page templates
  offered on any empty page, copied with their subpages, databases and files.
- Page history: versions kept automatically with their authors, changes highlighted, any version restored.
- Backlinks: each page lists the pages that mention it.
- Search inside attached files: PDFs, images and scans (OCR), text files.
- Dates written in plain words (`@tomorrow 9am`, `@vendredi`, `@in 3 days`) with reminders, sent as notifications
  to the phone or computer.
- REST API with personal tokens (per space, read-only or read and write): pages as Markdown, database queries,
  rows, files, search. See [docs/API.md](docs/API.md).
- Plugins: editor blocks, API routes, scheduled tasks and formula functions, turned on and set up in the
  administration. Ships with the "Embeds" plugin (`/embed`: YouTube, Vimeo, Spotify, Google Maps, Figma,
  link previews). See [docs/PLUGINS.md](docs/PLUGINS.md) to write your own.
- Export a page or a space as Markdown (.zip: subpages, attached files, databases as CSV and JSON),
  export a database as CSV (or CSV for Excel) and JSON with computed formulas, import a CSV into a database
  (columns and options created as needed), full backup downloadable by the admin.
- Full-text search in page titles and content (Ctrl+K or ⌘K), accent-insensitive, limited to the pages the user can read.
- English and French interface, chosen per user.
- Works on phones and installs as an app (PWA, over HTTPS): sidebar as a drawer, editing toolbar above the keyboard,
  database rows as cards. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#installing-the-app-on-a-phone-or-computer).
- Works offline: pages already opened stay readable and editable, and changes sync when the connection comes back
  (page content is merged with others' changes, database cells are sent in order).
- Import from Notion through its API: pages, databases with their columns, relations, rollups and formulas, files
  and links between pages, with a report of what was imported differently. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#importing-from-notion).
- "My account" page: name, email, password, profile picture, language, light / dark / system theme, imports, emptying a space and deleting the account with its data.
- "Full width" option per page.
- Single Docker image (amd64 and arm64), data in `/data`.

## Development

Requirements: Node.js 22 and pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm dev          # server on :3000, interface on http://localhost:5173
pnpm test         # automated tests
pnpm typecheck
pnpm build
```

After changing `apps/server/src/db/schema.ts`, run `pnpm --filter @nootion/server db:generate` to create the migration.
Migrations are applied automatically at startup.

Interface texts live in `packages/shared/src/i18n/` (`en.ts` is the reference, `fr.ts` the French translation);
see [CONTRIBUTING.md](CONTRIBUTING.md#translations) to add a language.

## Project layout

```
apps/server      Fastify API + Drizzle + SQLite
apps/web         React + Vite + Tailwind interface
packages/shared  Types, validation, formulas, views and translations shared by both
docker/          Dockerfile
docs/            Documentation (deployment, plugins)
```

## Contributing

Bug reports and ideas are welcome in the issues. Nootion doesn't accept code contributions (pull requests):
see [CONTRIBUTING.md](CONTRIBUTING.md).
For a security issue: [SECURITY.md](SECURITY.md).

## License

[AGPL-3.0](LICENSE)
