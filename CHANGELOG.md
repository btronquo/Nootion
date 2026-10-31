# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and version numbers follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- The sidebar can be put away, as in Notion: « at its top, or Ctrl+\ (⌘\ on a Mac). It then shows over the page while
  the menu button or the left edge of the window is hovered; a click on the menu button keeps it open again.
- A new icon picker: every emoji, by category, with a search in your language, recent ones and "Random"; and your
  own images ("Custom" tab), uploaded once and shared by everyone on the server.
- Nicer to-do boxes, as in Notion: a bit bigger, blue with a check that pops in when checked, and the line through
  the text fades in.
- Block handles in the editor, as in Notion: hovering a block shows "+", which adds a block below it and opens the
  "/" menu, and the dots, which move the block (or a list item) by dragging, or select it with a click.
- A menu on each page of the sidebar, opened by right-clicking it or with its "…" button: add to favorites, copy
  link, duplicate (with its subpages), rename, move to another page, move to the trash, open in a new tab.

### Fixed

- "Saving…" above the editor only shows when a save takes more than a second and a half (a slow connection),
  instead of flashing at each change.
- The sidebar shows the pages others add, rename, move or delete in a shared space (or share with you) right away,
  without reloading the page.

## [3.0.0] - 2026-10-31

### Changed

- Moving a page moves its link with it: out of the old parent page, to the end of the new one, as in Notion.
- Calmer interface: dialogs fade and rise in, and fade out when closed; menus and popovers pop in; pages fade in
  when you move between them; buttons respond to a press. Everything is off when the system asks for reduced motion.
- Dialogs put the cursor in their first field, and Escape closes them even when the focus is elsewhere.

### Added

- Google Calendar without the administrator: when no OAuth client is set in Administration, each person can paste
  their own Google OAuth client in the block (the redirect URI to authorize is shown there).
- Plugins can add column types to databases: the plugin draws and edits the cells, which keep a text that filters,
  sorts and exports like one. The new built-in **Ratings** plugin (off by default) adds a "Rating" column of one to
  five stars.
- Automatic backups (Administration): the full backup every day or every week at a set time, to a folder of the
  server (a NAS share) or a WebDAV folder such as Nextcloud, keeping the last N copies. "Back up now" tries it at
  once, and the page shows how the last one went.
- Mention people in a page: type "@" and their name. They get a notification (in the app, and on their devices) if
  they can read the page, listed with the comment ones in "Notifications".
- "/table of contents": links to the page's headings, kept up to date, that scroll to them.
- Quick capture: "Quick capture" in the sidebar, or Ctrl+Alt+N (⌘⌥N on a Mac), drops a note in your inbox, a page of
  your personal space made for it. The first line is the title. The installed app also takes what you share to it
  from other apps (a link, a text), and has a "Capture" shortcut on its icon. File a note by moving it, from the
  sidebar or its menu. Agents can add to it too (`capture_to_inbox`).
- Recurring templates ("Repeat" on a template): make a new page from a page template, or a new row from a row
  template, every N days, on some days of the week, or on a day of the month, at a chosen time. New pages go in a
  page of your choice; new rows can get the day in a date column. The template shows when it runs next.
- Database automations ("Automations" above a database): when a row is added, when a column changes (or takes a
  given value), or when a date arrives, run steps on the row, the same steps as buttons. For example "Status set to
  Paid → fill in the payment date with today". They can be paused, and their last runs are listed with any error.
- Comments: select text and comment on it, or comment on the whole page, from the comments panel. Threads have
  replies, can be resolved and reopened, and follow their passage as the page is edited. People with the
  "commenter" role can take part. Type "@" to mention someone: they get a notification, as do the others in the
  thread when it gets a reply. "Reminders" in the sidebar becomes "Notifications" and lists them too.
- A new subpage gets a link at the end of its parent page, as in Notion (from the sidebar, the API, the MCP server
  or a button). It is an ordinary link: remove it if you don't want it.

## [2.0.1] - 2026-10-30

### Fixed

- Nootion opened at a plain http address (e.g. `http://nas.local:3002`): inserting a button, calendar or columns
  block, adding options to a column and copying links no longer fail (the browser only offers `crypto.randomUUID`
  and the clipboard API on https or localhost).

## [2.0.0] - 2026-10-30

### Added

- Google Calendar plugin: syncs a database with a Google calendar, both ways, every minute (`/google calendar`):
  rows with a date become events, and events created, moved or deleted in Google change the database. Each person
  connects their own Google account (OAuth; the administrator creates the OAuth client once). See
  [docs/GOOGLE_CALENDAR.md](docs/GOOGLE_CALENDAR.md).
- "My account › Connected services" lists each person's accounts on other services used by plugins (Nextcloud,
  Google Calendar), with a button to disconnect them. Plugins add theirs with `connectedAccount`.
- Plugins: `request` (call Nootion's API as a user, with their rights), `redirect` and `appUrl`.
- Nextcloud plugin: each person connects their own Nextcloud account (Nextcloud's login page, or an app password),
  then picks files to copy into a page (`/nextcloud`) or a "File" column, or inserts a link that opens a file or
  folder in Nextcloud (`/nextcloud link`). Browse folders, search by name, thumbnails. App passwords are stored
  encrypted and revoked on disconnecting. See [docs/NEXTCLOUD.md](docs/NEXTCLOUD.md).
- Plugins: `userSecrets` (encrypted data per user, such as an account on another service), `attachments.create`
  (attach a file to a page), `binary` (send an image from a route), and in the browser `registerFileSource`
  (another place to pick files from, offered in the "/" menu and in "File" columns) and `ui` (the app's dialog
  and buttons). See [docs/PLUGINS.md](docs/PLUGINS.md).
- Buttons: a block in pages (`/button`) and a column type in databases that run steps when clicked: add a row to a
  database, change the current row, create a page (from a template or not), open a page or a link, call a webhook.
  Steps use variables (`{{today}}`, `{{user}}`, `{{row.<column>}}`, `{{form.<field>}}`…) and run with the rights of
  the person clicking. A button can first open a form (text, number, date, choice, checkbox, person), and that form
  can get a public link to collect answers from people without an account. See [docs/BUTTONS.md](docs/BUTTONS.md).
- MCP server: Claude or another AI assistant can search, read and write pages, and create, query and fill
  databases, as you, within the spaces you choose and read only or read and write. On claude.ai and Claude's apps,
  Nootion is added as a custom connector: Claude opens a Nootion page where you choose its spaces and access
  (OAuth 2.1). Claude Code and other agents can use a personal token. See [docs/MCP.md](docs/MCP.md).
- Versions of a page written through the API or by an agent are marked with the token's name in the page's
  history ("via Claude"), and "My account" lists what apps and agents changed.

## [1.2.0] - 2026-10-30

### Added

- Favorites: a star in each page's header adds the page to a "Favorites" section at the top of the sidebar
  (also in the phone drawer). Favorites are per user, reordered by drag and drop, and a page dragged from a tree
  onto the section is starred. Pages in the trash or no longer shared with the user are hidden from the list.
- Cover images: a banner at the top of a page or database, from an uploaded image, an image link or one of six
  built-in gradients. Images are repositioned by dragging them up or down. Covers show on public links, and the
  Notion import brings them in (Notion's own files are copied, links are kept).
- Toggle blocks and toggle headings ("/" menu): each reader opens and closes them without changing the page for
  others. Columns: blocks side by side in 2 or 3 columns, one under the other on phones; Backspace in an empty
  column removes it. The Notion import keeps toggles and columns, and the Markdown export writes toggles as
  `<details>`.
- The "/" menu also finds commands by their name in the interface language.
- New database views: list (one line per row), gallery (cards topped by the row's cover or the first image of its
  page) and calendar (month or week, rows placed on a date column, dragged to another day to change their date,
  date ranges shown on every day, "+" on a day to add a row on that date).
- Timeline view: rows as bars from their start date to their end date, by days, weeks or months. Bars are dragged
  to move them and by their ends to change the start or the end (on phones too); a row without a date gets one by
  clicking on its line.
- Calendar block ("/" menu): the dated rows of one or several databases on one month or week calendar, each
  database in its colour and with its date column. Rows are dragged to another day, "+" adds a row in the chosen
  database, and readers only see the databases they can open. "Subscribe" gives each user a private, read-only
  iCal link (renewable, can be turned off) for phone and desktop calendars. Public links show the databases they
  publish.
- Personal home page, opened at sign-in and from "Home" in the sidebar: a greeting, then widgets each user
  arranges like blocks of a page ("/" to add one, drag to reorder): recently visited pages (cards with their
  cover), favorites, upcoming events of chosen databases (next 7 to 90 days), and the first rows of a database view
  (a checkbox column can be ticked from there). It is an ordinary page underneath, so any other block works too.
- Templates. Row templates ("Templates" in a database's toolbar): content and values that new rows start with, edited
  like a row, one of them used for every new row if chosen. Page templates ("Use as a template" in a page's menu):
  an empty page offers them, and the copy brings the template's content, icon, cover, subpages and databases (with
  their columns, views and rows), and attached files.
- Page history (clock button in a page's header): versions are kept as the page is edited (every 10 minutes at
  most while people type, and when the last of them leaves), with who edited. Each version shows what changed
  (added lines in green, removed ones struck in red) or the page as it was, and can be restored; the current
  content stays in the history. All versions of the last day are kept, then one a day for a month, then one a week.
- Backlinks: "Linked from" at the bottom of a page lists the pages that link to it or mention it (with the
  sentence around the link), among those the reader can open.
- Search inside attached files: the text of PDFs, of images and scanned PDFs (OCR, French and English) and of text
  files is read in the background when they arrive, existing files included. Search finds them by their words or
  their name; the result opens the page holding the file, with a link to the file itself. The Docker image now
  includes poppler and tesseract (`OCR_LANGS` sets the OCR languages).
- Dates in plain words: typing "@" followed by a date in French or in English inserts it in the text, whatever the
  interface language: `@demain 9h`, `@tomorrow at 2pm`, `@vendredi`, `@next monday`, `@dans 3 jours`, `@in 2 weeks`,
  `@15 novembre`, `@nov 15`, `@15/11` (`11/15` in English), `@2026-11-15`… A date shows as "Tomorrow at 9:00 AM" and
  opens to change its day, its time and its reminder. The Notion import brings Notion's dates in, search finds pages
  by their dates (`2026-11-15`), and the Markdown export writes them as such.
- Reminders: a date can remind the person who set it (`@rappel demain 9h`, `@remind friday`, or from the date itself),
  at the time or some minutes, hours or days before (9:00 for a day without a time). "Reminders" in the sidebar lists
  them, with the number of those due; each is marked as done from there. The app shows a notification when one falls
  due, and devices where "Get notifications on this device" is turned on receive it even with the app closed (Web
  Push; needs HTTPS, and on iPhone the app added to the home screen).
- REST API with personal tokens ("My account › API tokens"): each token is limited to some spaces, read-only or
  read and write, and can expire; it is shown once, and the list shows when each was last used. With a token,
  scripts and apps read and write pages (content as Markdown or as the editor's JSON, changes shown live to people
  editing), query databases (filters, sorts, pages of results; columns and options named by their names), add and
  change rows, upload files and search. Tokens can't touch the account, sharing, public links or the
  administration. Documented in [docs/API.md](docs/API.md).

### Fixed

- French interface: a few labels were not translated (column menu, filters, code button, plugins page, one
  server error), and wording is now consistent ("base" rather than "database", "agrégation" rather than "rollup").
- The "Write, or type /" hint stayed on empty lines after the cursor had left them.

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

[3.0.0]: ../../releases/tag/v3.0.0
[2.0.1]: ../../releases/tag/v2.0.1
[2.0.0]: ../../releases/tag/v2.0.0
[1.2.0]: ../../releases/tag/v1.2.0
[1.1.0]: ../../releases/tag/v1.1.0
[1.0.0]: ../../releases/tag/v1.0.0
