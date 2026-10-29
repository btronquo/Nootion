# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and version numbers follow
[Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-10-29

### Mobile

- Installable app (PWA): manifest, icons, service worker that keeps the app's shell available.
- Phone layout: the sidebar opens as a drawer, page headers stay at the top, smaller margins.
- Editing toolbar above the keyboard on touch screens: "/" menu, bold, italic, link, heading, lists,
  indent and outdent, move a block up or down, undo and redo.
- Database tables show as cards on phones; a new row opens at once to fill it in.
- Menus fit the screen and the space left by the keyboard.

### Offline

- Pages already opened on a device open and can be edited without network; their content is kept in the browser
  and merged with others' changes when the connection comes back.
- Database cells, page titles and icons changed offline are queued and sent in order once back online.
- Badge showing the offline state, the changes waiting and those the server refused.
- Signing out removes the offline copy of the account from the device.

### Account and data

- "Import" section in "My account", presenting the ways to bring data in (Notion, CSV / JSON, backup).
- "Empty a space": deletes every page and database of a space one owns, trash included.
- "Delete my account": deletes the account, its personal space and the shared spaces only it is in.
  Refused while the account is the last administrator or the only owner of a space others use.

### Import from Notion

- "Import from Notion" in "My account" › "Import": imports the pages and databases shared with a Notion integration into a space.
- Page tree, emoji icons, text with its formatting, lists, to-dos, quotes, callouts, code, tables, images and files
  (copied to Nootion), mentions and links between pages.
- Databases with their columns (select options, number formats, people matched by email), rows and their content,
  two-way relations, rollups and formulas translated to Nootion's formula language.
- Formulas Nootion can't compute keep their values in a text column; a report lists them along with what was
  imported differently (toggles shown open, columns put one under the other…).
- Importing again brings in what changed in Notion without creating duplicates. The integration secret is stored encrypted.

### Fixes and documentation

- Database tables show one line above the column headers instead of two.
- File sizes are shown in the interface's language.
- The deployment guide is no longer specific to TrueNAS: it describes running with Docker Compose on any host.

## [1.0.0] - 2026-10-29

First public version.

### Accounts and sharing

- Administrator account created at first launch, invitation links, admin / member roles.
- Private personal space for each user and shared spaces (owner, editor, commenter, viewer).
- Pages private by default, sharing a page with a user, revocable read-only public link.
- English and French interface, chosen when creating the account and changeable in "My account".

### Pages

- Notion-like editor with "/" commands, real-time collaborative editing, attached files, links between pages.
- Page tree with drag and drop, icons, trash with restore.
- Full-text search in titles and content (Ctrl+K or ⌘K), accent-insensitive.

### Databases

- Typed columns (text, number, amount, percent, date, selects, checkbox, link, email, person,
  files, automatic dates and author).
- Calculations under columns, one-way or two-way relations, rollups.
- Notion-like formulas with live checking.
- Table and board views, each with its own filters, sorts, groups and columns.

### Plugins

- SDK to add blocks, API routes, scheduled tasks and formula functions, with translatable manifests.
- "Embeds" plugin included (`/embed`: YouTube, Vimeo, Spotify, Google Maps, Figma, link previews).

### Data

- Markdown (.zip), CSV and JSON export, CSV import, full backup download.
- Single Docker image (amd64 and arm64), data in `/data`, migrations applied at startup.

[1.1.0]: ../../releases/tag/v1.1.0
[1.0.0]: ../../releases/tag/v1.0.0
