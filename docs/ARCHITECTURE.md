# How Nootion is built

A map of the code for whoever wants to read it, fork it or write a plugin. To run it, see
[DEPLOYMENT.md](DEPLOYMENT.md).

- [The three packages](#the-three-packages)
- [A request, from the browser to the database](#a-request-from-the-browser-to-the-database)
- [Who can see what](#who-can-see-what)
- [Page content and collaborative editing](#page-content-and-collaborative-editing)
- [Databases](#databases)
- [Work that runs by itself](#work-that-runs-by-itself)
- [Requests the server makes](#requests-the-server-makes)
- [Plugins](#plugins)
- [The web app](#the-web-app)
- [Tests](#tests)
- [Where to look](#where-to-look)

## The three packages

```
packages/shared   What the server and the web app must agree on: request shapes (zod), types, the formula
                  engine, filters and sorts of views, dates in plain words, translations (en, fr).
apps/server       The API (Fastify), the database (SQLite through Drizzle), collaborative editing (Hocuspocus),
                  background work, the plugins that ship with the app.
apps/web          The interface (React, Vite, Tailwind, TipTap), built to static files that the server serves.
```

One process and one data folder: no separate database server, queue or cache. In production the server serves the
built web app, the API under `/api`, the collaborative editing websocket and the MCP endpoint.

## A request, from the browser to the database

1. `apps/server/src/app.ts` builds the Fastify app: security headers, rate limits, then who is asking. That is
   either a session cookie (`auth/sessions.ts`), a personal API token or an agent's OAuth token (`api-tokens.ts`).
2. With a token, the request first passes a whitelist of routes (`ALLOWED` in `api-tokens.ts`): a route that isn't
   listed is refused, so a new route is closed to tokens until someone opens it. The token's spaces are then kept
   for the whole request, and the permission checks below take them into account by themselves.
3. The route (`routes/*.ts`) reads its input with a zod schema from `packages/shared` (`parseBody`), asks for the
   role it needs (`requirePageRole`, `requireWorkspaceRole`) and calls the module that does the work
   (`pages.ts`, `databases.ts`, `buttons.ts`…).
4. Errors are `HttpError`s with a code and a translated message (`http.ts`); "not allowed to see" is answered as
   404, like "doesn't exist", so that ids can't be probed.

Routes are thin on purpose: the same modules are called by the REST API, the MCP server (`mcp.ts`), buttons,
automations and plugins.

## Who can see what

`apps/server/src/permissions.ts` is the single place that decides. The role someone has on a page is the best of
their role in the page's space and of any share on the page or one of its ancestors (shares are inherited). Pages
in the trash are invisible. Every route that touches a page goes through it, and so do the websocket, public
links, search results and exports. The tests in `apps/server/test/permissions.test.ts` and `security.test.ts`
cover it.

Three things sit beside it:

- **Public links and public forms** (`routes/public.ts`, `routes/buttons.ts`) serve people without an account, and
  only what the link names.
- **Tokens** narrow a user's rights to some spaces, read-only or not. They never widen them.
- **The people directory** (`users.ts`) only lists those who share a space or a page with you; administrators see
  everyone.

## Page content and collaborative editing

A page's content is a Yjs document, stored as a blob in the `pages` table (`content_state`). `collab.ts` runs
Hocuspocus on a websocket: each editor sends its changes, they are merged without conflict and saved. On every
save the server also keeps the content as ProseMirror JSON (for exports, public pages, the API's Markdown) and as
plain text (for search, SQLite FTS5). Those two are derived: only the Yjs document is the truth.

Anything on the server that writes into a page (the API's Markdown, the MCP server, buttons, the Notion import)
goes through `writeContent` in `collab.ts`, so that people with the page open see the change arrive like anyone
else's. `markdown.ts` and `markdown-in.ts` turn content into Markdown and back; `history.ts` keeps versions.

## Databases

A database is a page of kind `database`; its rows are pages too (which is why a row opens as a page, can be
shared, commented and searched). Columns, cell values, views and relations are in their own tables
(`db/schema.ts`), handled by `databases.ts`. Formulas, rollups, filters, sorts, groups and calculations are
computed by `packages/shared` (`formula.ts`, `views.ts`, `calculations.ts`), the same code on the server (API
queries, exports, automations) and in the browser (instant display, offline).

The schema changes through Drizzle migrations (`apps/server/migrations/`), generated with
`pnpm --filter @nootion/server db:generate` and applied at startup.

## Work that runs by itself

No queue: timers in the server process, each reading what is due from the database, so that a restart loses nothing.

| What | Where |
| --- | --- |
| Automations (a row added, a column changed, a date reached) | `automations.ts`, steps shared with buttons in `buttons.ts` |
| Recurring templates | `recurrences.ts` |
| Reminders, notifications, e-mails | `reminders.ts`, `mail.ts` |
| Text of attached files (PDF, OCR) for search | `extract.ts` |
| Automatic backups | `backups.ts` |
| Plugins' scheduled tasks | `plugins.ts` |

A button's steps run as the person who clicks it (for a public form, as the author of its link); an automation's or a
recurring template's as the person who last saved it. Always with their rights at the time of the run.

## Requests the server makes

Webhooks and link previews fetch addresses that people type. They all go through `net.ts` (`outboundRequest`),
which refuses the server itself, its local network and cloud metadata addresses, checks the address at the moment
the connection is made (so a name can't change its answer in between) and every redirection. The administrator
can allow webhooks to the local network (Administration › Security). Plugins get the same function as
`nootion.net.request`. Requests to services the administrator set up (SMTP, WebDAV backups, the single sign-on
provider) aren't restricted.

## Plugins

A plugin is a folder with a manifest, an optional `server.js` (routes, scheduled tasks, formula functions, storage)
and an optional `web.js` (editor blocks, column types). `plugins.ts` loads them and hands them the `nootion`
object: the same permission checks and modules as the app, nothing more privileged in intent, but a plugin is code
that runs in the server, so it is installed on trust. See [PLUGINS.md](PLUGINS.md).

## The web app

- `pages/` are the screens, `components/` what they share, `editor/` the TipTap editor and its blocks,
  `database/` the views and cells, `buttons/`, `comments/`, `plugins/` their features.
- Data comes through TanStack Query (`lib/queries.ts`, `lib/api.ts`); the server pushes "this changed" events
  (`lib/live.ts`) that refresh what is on screen.
- Offline (`lib/offline.ts` and the service worker): pages already opened are kept in the browser, page content
  merges when the connection returns (Yjs), database changes wait in a queue and are replayed in order.
- Every text shown is a key of `packages/shared/src/i18n/en.ts`, translated in `fr.ts`.

## Tests

`apps/server/test` holds the tests (Vitest): each file starts a real app on an empty database (`helpers.ts`:
`makeApp`, `setupAdmin`, `inviteUser`) and talks to it over HTTP, as a client would. Formulas, views and dates
have unit tests in the same folder (`formula.test.ts`, `views.test.ts`…). `pnpm test` runs everything; CI runs it on every pull request.

## Where to look

| To change… | Start in |
| --- | --- |
| who may do what | `apps/server/src/permissions.ts` |
| what tokens and agents reach | `apps/server/src/api-tokens.ts` |
| a table or a column of the schema | `apps/server/src/db/schema.ts`, then generate the migration |
| a request's shape | `packages/shared/src/*.ts` (the zod schema), then the route |
| a button or automation step | `packages/shared/src/buttons.ts`, `apps/server/src/buttons.ts` |
| an editor block | `apps/web/src/editor/` |
| a database view or cell | `apps/web/src/database/`, `packages/shared/src/views.ts` |
| the instance's options | `packages/shared/src/settings.ts`, `apps/server/src/settings.ts` |
| security headers, proxies, rate limits | `apps/server/src/app.ts`, `apps/server/src/config.ts` |
