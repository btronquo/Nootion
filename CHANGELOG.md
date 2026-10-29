# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and version numbers follow
[Semantic Versioning](https://semver.org/).

## [1.1.0] - unreleased

### Mobile

- Installable app (PWA): manifest, icons, service worker that keeps the app's shell available.
- Phone layout: the sidebar opens as a drawer, page headers stay at the top, smaller margins.
- Editing toolbar above the keyboard on touch screens: "/" menu, bold, italic, link, heading, lists,
  indent and outdent, move a block up or down, undo and redo.
- Database tables show as cards on phones; a new row opens at once to fill it in.
- Menus fit the screen and the space left by the keyboard.

## [1.0.0] - unreleased

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

[1.0.0]: ../../releases/tag/v1.0.0
