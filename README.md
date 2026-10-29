# Nootion

An open-source, self-hosted note-taking app in the spirit of Notion, whose strong point is **databases**
(relations, rollups, formulas, filters, calculations).

> Status: version 1.0.0. See [CHANGELOG.md](CHANGELOG.md) for details and [PLAN.md](PLAN.md) for what comes next.

The interface is available in English and French; each user picks their language when creating their account
and can change it in **My account**.

## Features

- First launch: creation of the administrator account.
- Sign in / sign out, secure sessions (httpOnly cookie, argon2 password hashes).
- Invitations by link (valid 7 days, optionally restricted to one email), admin / member roles, account disabling.
- A private personal space for each user, and shared spaces with roles (owner, editor, commenter, viewer).
- Page tree (subpages, drag and drop, icons), trash with restore.
- Pages are private by default: share a page with a user (inherited by subpages), or through a revocable read-only public link.
  Every access check is done on the server (`apps/server/src/permissions.ts`) and covered by tests.
- Notion-like page editor ("/" commands, to-do lists, tables, callouts, images and attached files,
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
- Several views per database (table or board), each with its own filters (and / or, relative dates such as
  "the next week"), sorts, groups and visible columns. Drag and drop between board columns.
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
- "My account" page: name, email, password, profile picture, language, light / dark / system theme.
- "Full width" option per page.
- Single Docker image (amd64 and arm64), data in `/data`.

## Run with Docker

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (TrueNAS SCALE and plain Docker).

```bash
docker compose up -d --build
```

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
deploy/          TrueNAS install file
docs/            Documentation (deployment, plugins)
```

## Contributing

Bug reports, ideas and pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).
For a security issue: [SECURITY.md](SECURITY.md).

## License

[AGPL-3.0](LICENSE)
