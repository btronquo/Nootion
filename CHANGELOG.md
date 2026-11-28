# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and version numbers follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [4.3.1] - 2026-11-28

### Added

- A website with the documentation, searchable: https://btronquo.github.io/Nootion/ (built from `docs/` and
  published by GitHub Pages).

### Fixed

- In a bulleted or numbered list, the handle shown on hover ("+" and the dots) covered the bullet or the number of
  the line. It now sits left of it, at every level of a nested list.

## [4.3.0] - 2026-11-25

### Added

- Tabs of open pages, as in a web browser (optional: Account › Appearance, or "Show the tabs" in the command
  palette; wide screens only). A bar over the content lists the open pages: a click shows one, its cross or a middle
  click closes it, and following a link changes the current tab. Ctrl+click (⌘+click) or a middle click on a link of
  the app opens it in a new tab behind the current one, as does "Open in a new tab" in a page's menu in the sidebar
  (the browser's new tab becomes "Open in a new window").
  Tabs are dragged to reorder them, and a page dragged from the sidebar onto the bar
  opens where it is dropped. Right-click a tab to pin it, duplicate it, or close the others or those on its right:
  pinned tabs stay on the left, show only their icon and keep their page (a link followed from one opens in another
  tab). The tabs are remembered on the device for each account, and the installed app reopens the last one shown.
  The guided tour presents them (wide screens) with a button to turn them on right away.

### Changed

- The macOS desktop app is signed and notarized by Apple: it opens without the "unidentified developer" warning.

### Fixed

- A long property name in the list above an opened database row was cut after a dozen characters, with no way to
  read it. It now goes on a second line, and the whole name shows on hover there, in the table headers and on cards.
- A person picked in a person cell showed as "User" until the page was reloaded: their name now shows at once, in
  every language.

## [4.2.0] - 2026-11-24

### Added

- Branding: administrators give the app their own name and logo (Administration › Branding). The name replaces
  "Nootion" in the interface and e-mail texts, the browser tab and the installed app; the logo (PNG, JPEG, WebP, GIF
  or SVG, up to 1 MB) becomes the favicon, the home screen icon, the logo at the top of the sidebar and on the sign-in
  page, and heads e-mails (raster images only, since many mail apps don't show SVG). The server writes both into the
  page and its manifest, so they show before any script runs, and the logo is part of backups. A discreet "Powered by
  Nootion" stays under the custom name; texts about the software itself (version, updates, desktop sync) keep its
  real name.
- Several blocks can be selected at once, to copy, cut, paste over, delete, duplicate or move them together: draw a
  rectangle from the margin of the page, press Escape while typing (then Shift+↑/↓ to add blocks), Shift+click
  another block, or press Ctrl+A twice. Dragging the handle of one of them moves them all, and a click on it opens a
  menu for all of them (colour, copy, cut, duplicate, move, delete). Typing doesn't replace them. Details in
  [docs/EDITOR.md](docs/EDITOR.md#selecting-several-blocks).

### Changed

- The interface moves more smoothly, with one set of short durations and curves everywhere (120 to 240 ms, nothing
  moves when the system asks to reduce motion). Putting the sidebar away (or bringing it back) slides it while the
  page glides over, instead of jumping; sub-pages unfold in the sidebar, as does the content of an opened toggle; the
  formatting toolbar rises from the selected text, and the colour and plugin menus pop in. Buttons, links and menu
  entries change colour softly on hover. The handles beside a block fade in, and a dragged block shows where it will
  land with a soft blue line. A page that loads shows grey lines where its title and text will be, rather than an
  empty screen. The comments panel slides in from the right and back out when closed, and the page scrolls smoothly
  to where a link, the table of contents or a comment takes it.

### Fixed

- After cutting text or blocks, a click elsewhere followed by Enter or Ctrl+V sometimes acted where the cut had been:
  the browser hadn't told the editor about the click. The editor now takes the cursor the browser shows before a key,
  a paste, a cut or a copy.

## [4.1.0] - 2026-11-18

### Added

- Images can be resized and arranged in the page. On hover (or after a first tap on a touch screen), an image shows a
  handle on each side to set its width, kept in the page, and a bar to align it (left, centre, right), add a caption,
  comment on it, crop it (free or 1:1, 4:3, 16:9, 3:4: the file itself is kept whole, so a crop can be changed
  later), see it full screen, download it, go back to its original size or delete it. A commented image shows a
  badge that opens its thread. Captions are exported to Markdown and come with images imported from other tools.

### Fixed

- Desktop app on Windows: "On this computer" opens again. The local space no longer stops at start with
  "EISDIR: illegal operation on a directory, lstat 'C:'" in server.log: the app now gives the built-in server its
  folders in the usual Windows form (`C:\...`) rather than the `\\?\C:\...` form Node can't start from (#50).
- Desktop app: the server picker showed "Nootion for desktop 3.5.0" whatever the version installed, and the local
  space believed it ran 3.5.0, so its "What's new" window missed the notes of later versions. The app now takes its
  version from the same place as its installers.

## [4.0.0] - 2026-11-17

### Added

- Database pages are easy to tell apart: a database shows a small database mark in the corner of its icon (or the
  database icon when it has none) in the sidebar, favourites, the breadcrumb, search and the command palette, the
  home page's lists and backlinks. Under its title, a "Database" badge explains, when clicked, that such a page holds
  rows rather than free text, and how to write around it (a page showing it with "/linked view"). Below it, a
  description of a few lines ("Add a description…"), kept by the desktop sync, shown on public links, and filled in
  from the database's own description when importing from other tools. Enter in the title moves to it. Migration
  0050 adds `pages.description`.
- Guided tour for new accounts: about ten cards, each with a small drawing, a short text and the keys to press,
  show what Nootion can do (blocks and "/", databases and their views, equations and Mermaid diagrams, synced
  blocks, the command palette and quick capture, tasks and dates written in words, working together, the AI
  assistant when it is on, imports, PDF and the apps), then "Open the examples page". It can be skipped, is shown
  once, and comes back from "My account › Demo page" ("Take the guided tour again") or the palette ("Guided tour of
  Nootion"). Guests and accounts from before don't get it. Arrow keys move through it; on phones it opens from the
  bottom.
- Setup assistant for administrators: right after creating the first account, a full-screen assistant goes through
  the main settings one step at a time, each step being the matching section of Administration: language and the
  server's address and file storage, e-mail, sign-in and security (adding a passkey, single sign-on, webhooks),
  backups, the AI assistant, the other plugins, and the team (invitations, guests). Every step can be skipped and is
  saved at once; a summary says what is set and leads back to what isn't, then the guided tour starts. "Finish
  later" leaves a card at the top of Administration to resume it; Administration and the palette open it again at
  any time (`/admin/setup`). Migration 0049 adds `users.tour_pending`.
- AI assistant, an optional plugin (off by default): once an administrator turns it on and gives a key (Anthropic,
  OpenAI, Mistral) or the address of a model on the network (Ollama, or a server compatible with OpenAI's API), the
  bar over selected text gets "✨ AI" with "Summarise", "Translate to…", "Improve the writing", "Continue" and
  "Ask…" (on phones, a ✨ button in the bar above the keyboard). The answer is written as it comes in a panel under
  the passage, which stays highlighted, then "Replace", "Insert below" (or "Insert" for a continuation), "Try again"
  or "Discard"; Markdown of the answer becomes real blocks. A round ✨ button at the bottom right of pages opens a chat
about the page being read (suggestions such as "Summarise this page" or "What is left to do?"), each answer with
"Insert in the page" and "Copy"; readers of a page may chat about it too. DeepSeek, OpenRouter, Groq and other
services compatible with OpenAI's API work with their address and key. Nothing leaves the server without a click, only the
  selection is sent, and the menu and the panel say where the text goes. The key is kept encrypted and only the
  configured address may be on the local network. Settings for the model, a daily limit per person, and guests
  (refused by default). See [docs/AI_ASSISTANT.md](docs/AI_ASSISTANT.md).
- Plugins can add entries to the menu of a selection (`registerSelectionMenu`), with a panel under the passage that
  replaces it or inserts after or below it, add a round button at the bottom right of pages that opens a panel beside
  them (`registerPagePanel`), send a route's answer as it is written (`nootion.stream`, read in the
  browser with `nootion.fetch`), turn Markdown into page blocks (`nootion.markdown`), and read an outside answer as it
  arrives (`net.request(url, { stream: true })`). See [docs/PLUGINS.md](docs/PLUGINS.md).
- German, Spanish and Italian interfaces, besides English and French: every text, the e-mails and the server's
  messages, with dates, numbers and plurals in the language's own format, emoji names in the icon picker and form
  validation messages. Dates written in words in a page are understood in all five languages whatever the one chosen
  (`@morgen um 9 Uhr`, `@el próximo viernes`, `@domani alle 15`, `@erinnere mich Freitag`), and so are yes/no words
  when a column becomes a checkbox or a CSV is imported (`ja`, `sí`, `vero`). A language may now be partly
  translated: the menu shows its progress ("Polski (62 %)") and the missing texts appear in English, one by one.
  Plural forms follow each language's rules (`few`, `many`… for languages that have them). `pnpm i18n:check` lists
  per language the missing texts and the ones to fix (placeholders, plural forms, texts removed from English), and
  runs in the CI. Adding a language is described in [docs/TRANSLATING.md](docs/TRANSLATING.md).
- Passkeys: in "My account > Passkeys", "Add a passkey" (after typing the password) saves one with the device's
  fingerprint, face or screen lock, a password manager or a security key. Passkeys are listed with their name, when
  they were added and last used, and whether they are synced to other devices; they can be renamed and removed. On
  the sign-in page, "Sign in with a passkey" needs no e-mail, password or code: a passkey counts as both steps of
  two-factor authentication, and the password still works beside it. Passkeys need HTTPS and the address set in
  `APP_URL`: elsewhere the button doesn't show and My account says why. Disabled accounts, forbidden guests and
  SSO-only rules apply as for a password; each challenge works once and for 5 minutes.
- Groups of people: in Administration › Groups, administrators make groups (Marketing, Accounting…) and choose who is
  in them. A shared space is opened to a group from its members list (as editor, commenter or viewer, never owner),
  and a page is shared with a group from the share window, with its subpages, as with a person. Everyone in the group
  gets that access at once, and loses it when taken out; someone's access is the best of their own and their
  groups'. Typing `@` and a group's name in a page tells everyone in it who can read the page, and a to-do with
  `@group` shows in their tasks. With SCIM, the company's directory makes and fills groups itself (`/Groups`), marked
  "From the directory". Guests are never in a group and don't see groups. Migration 0047 adds the tables and two
  views, `effective_workspace_members` and `effective_page_permissions`, which the permission checks read.
- Activity log for administrators, in Administration: who signed in (and failed to, with the reason; with a password,
  a passkey or SSO), shared what with whom or with which group, invited a guest, made or changed a public link,
  exported a page or a space, downloaded a backup, moved to the trash or deleted, changed a role, a space member, a
  group or a setting, added a passkey, created an API token. Each line keeps the
  person's name, the page or person concerned, a few facts (role, settings changed, never their values when secret)
  and the address; page content is never written. Filters by family, person, words and days, "Show more" page after
  page, an export of the filtered lines as CSV (spreadsheet formulas made harmless), and "Keep the log" for 30 days to
  forever (one year by default). Migration 0048 adds the `audit_events` table.
- Attached files in S3-compatible storage (AWS S3, MinIO, Garage, Backblaze B2, Cloudflare R2…), for larger
  instances: set `FILES_S3_BUCKET`, the keys and, outside AWS, `FILES_S3_ENDPOINT`. The data folder stays the default
  and nothing changes for people: uploads, downloads with byte ranges (videos), copies of pages and templates,
  exports, imports, search in files and sync all go through the bucket, and access is still checked by Nootion.
  `FILES_S3_REDIRECT=true` sends browsers to a link signed for 5 minutes instead of streaming through the server;
  `FILES_S3_PREFIX` lets several instances share a bucket. `node dist/files-move.js to-bucket` (or `to-folder`)
  moves existing files, and can be run again. Backups then hold everything but the files, with a note saying which
  bucket has them. See "Attached files in S3-compatible storage" in docs/DEPLOYMENT.md.
- Synced blocks: the same content in several pages, edited from any of them and updated live in all. "Turn into
  synced block" in a block's menu, then "Copy synced block" and paste it elsewhere; or "/synced" to make a new one or
  show one already used. A thin frame and "Synced in 3 pages" show on hover, with the list of those pages. Removing a
  copy leaves the others; "Unsync" turns a copy into ordinary blocks. People who can't read the page where it lives
  see "No access to this content". Its content is a hidden page under that page, so history, permissions, the trash,
  offline use and the desktop sync work as for any page. Search and backlinks lead to the page where it lives;
  exports, public pages and the Markdown of the API write its content out; the import from other tools keeps synced
  blocks synced instead of copying their content.
- Guests: people from outside invited on one page. In the share window, "Invite a guest" takes an e-mail address and
  an access (can view, comment or edit); the person gets a link by e-mail (or the link to send another way), creates
  a guest account and sees only that page and its subpages, under "Shared with me", which is their home. Guests have
  no space of their own, can't be added to a space, see in the people lists only those the page is shared with, and
  can't make API tokens, connect apps, import, share or publish pages; the server refuses all of it. Pending
  invitations are listed in the share window and can be cancelled. Administration has a "Guests" list, with the pages
  each one sees, "Make a member" (they get a personal space and keep their shares) and a setting to forbid guests
  (pending invitations stop working and guests are signed out until it is on again). With SSO, people without an
  invitation can arrive as guests instead of members.
- Public links with a password and an end date: under the address in the share window, "Ask for a password" and
  "Stops working" (never, after 1, 7 or 30 days, or on a date). Visitors type the password once per browser, for that
  link only (the page, its subpages, its files and databases); changing it asks them again. After the end date the
  link shows "This link has expired", and its owner sees it greyed with "Extend by 7 days". Public forms of buttons
  get the same two options. Passwords are hashed like account passwords, and wrong ones are limited to 10 a minute
  for each link.
- Linked views: "/linked view" shows an existing database in any page, with filters, sorts and views of its own that
  don't change the database's views (for example the "Tasks" database in each project page, filtered on that
  project). Rows, columns and access stay those of the database; the title leads to it. The page's editors may change
  the linked view's views even if they only read the database. Its views go with the block: kept 30 days after it is
  deleted (undo, history), copied with the page when it is duplicated or made from a template, carried by sync, and
  exported by the API and CSV export like the database's.
- Equations in LaTeX: `/equation` (or `$$` and a space on an empty line) adds a centred block, and `$…$` typed in a
  line becomes an inline equation when the closing `$` is typed ("$5 and $10" stays text). Click an equation, or
  select it and press Enter, to edit its LaTeX with a live preview that explains mistakes. Equations show on public
  pages, in print, in the history and in the dark theme, and search finds them by their LaTeX. Markdown export writes
  `$…$` and `$$…$$`, and the import reads them back, as well as ` ```math ` blocks; the import from other tools now
  keeps their equations (it used to turn them into LaTeX code blocks), from their API and from their HTML exports.
  The drawing library (KaTeX) is downloaded the first time a page shows an equation, and runs without `trust`: no
  links nor HTML from an equation.
- Locking a page or a database, from the page's menu ("Lock page") or the command palette. A locked page shows a
  padlock at the top and its content, title, icon and cover are read-only for everyone until someone who can edit it
  unlocks it (a click on the padlock). A locked database keeps its columns, views and row templates while its rows
  can still be added and filled in. The server refuses the changes too: the API answers 423 and the live editor
  opens the page read-only, including for people who already had it open. The lock travels with the desktop sync.
- Sub-items and dependencies between the rows of a database, in the ⋯ menu of its toolbar ("Organise rows").
  Sub-items add "Parent item" and "Sub-items" columns: tables show sub-items indented under their parent, folded or
  not, with the share of them done (`1/3`); a matching sub-item keeps its parents in view when filtering; a row's page
  lists its sub-items with a progress bar and "Add a sub-item" (also in the row menu). Dependencies add "Blocked by"
  and "Blocking" columns: the timeline draws an arrow from each row to the rows waiting on it (red when they overlap),
  a row's page says what it still waits on, and, if chosen, moving the end of a row's date moves the rows it blocks by
  as many days. A row has one parent at most, and loops are refused. Both are ordinary relations of the database to
  itself, so filters, rollups, formulas and the API work with them. See [docs/DATABASES.md](docs/DATABASES.md).
- Tasks: one list of every to-do still unchecked in the pages you can read ("Tasks" in the sidebar, under
  Notifications). Grouped by page, or by date (overdue, today, next 7 days, later, no date) from the first date
  written in each to-do; filters for a space, the to-dos mentioning you and those with a date. Checking a box in the
  list checks it in its page, live for everyone who has it open (a repeating to-do moves on as in its page); clicking
  the text opens the page at that to-do. "Done lately" lists what was checked in the last 7 days, to undo a mistake.
  A "Tasks" widget shows the first ones on the home page (new home pages get it) or in any page. To-dos are read
  from the pages as they are saved; existing pages are read once after the upgrade.
- Text colour and highlight on a selection: the selection toolbar (and the editing bar on a phone) has an "A" button
  with the nine colours blocks already have, for the text and for a highlight behind it. Ctrl+Shift+H highlights in
  yellow. Colours show on public pages and in the history, go through the API, and the import from other tools keeps
  the colours of text it used to drop. In Markdown, highlights are written between `==`.
- Import from files, in "My account › Import", from the import button of a space or from a page's menu ("Import
  files"): drop Markdown, HTML, Word (.docx), text or CSV files, or a zip of them (a folder of notes, an export from
  another tool). Folders become pages with their subpages ("Page.md" beside a "Page/" folder, or "Folder/Folder.md",
  is that folder's page), a CSV becomes a database whose rows get the pages found beside it, images and files are
  copied, and relative links and `[[wiki links]]` between the files become links between the pages. Markdown keeps
  its front matter (title, icon, tags), callouts (`> [!note]`), toggles and underlines; the editor's own export reads
  back as it was. The import runs in the background with its progress, lists what it imported differently, and can
  be undone as a whole: everything it made goes to the trash. Archives are unpacked with size limits and no path
  leaving them (`IMPORT_MAX_MB`, 500 MB by default).
- Search in database values: searching "Dupont" also finds the invoice whose "Customer" cell says Dupont, shown as
  "Invoices › INV-12" with "Customer: Dupont · Status: Paid" under it. Text, number, select, status, person, link,
  e-mail, phone, file and ID columns are searched; renaming an option or a column is followed. Filters under the search
  box narrow the results: space, type (pages, databases, database rows, files), a database, author, edited since; with
  filters and no words, the latest changed pages that match are listed. A search with its filters can be saved under a
  name: saved searches are listed when the search box is empty. The API and the MCP server's search take the same
  filters.
- Resizable columns: a bar shows in the gap between two columns side by side; drag it to share the width between
  them, double-click it to give every column of the row the same width again. Widths are kept with the page, shared
  with everyone editing it, and ignored on a phone, where columns are one under the other. Columns are a little
  further apart, for the bar. The import from other tools keeps the widths of resized columns.
- Gallery cards size: small, medium or large (in "Properties"). There are as many cards in a row as fit in the width
  of the database, so a gallery in a narrow column shows fewer, smaller cards.
- Command palette: Ctrl+K (⌘K) still finds pages, and the same box now lists actions too, with their shortcut:
  new page or database (in the open page's space, or another one), quick capture, a subpage, go to Home,
  Notifications, All pages, Graph, Trash, My account or Administration, theme and language, and the open page's own
  actions (share, favorite, comments, history, full width, duplicate, move to, copy link, export, print). Typing ">" first
  lists actions only; matching ignores accents, and the most recently used actions come first. With nothing typed,
  the saved searches are listed under the actions.
- Code blocks are coloured by their language: choose it from the menu above the block (searchable, about 35
  languages), or leave it on "Auto" and the language is guessed as you type. "Plain text" turns colours off. A copy
  button and a "Wrap lines" switch sit next to it; long lines otherwise scroll sideways. Each language is downloaded
  the first time a block uses it, so pages without code load nothing more. Tab indents inside a code block. Public
  pages show the colours too, and blocks imported from other tools or from Markdown keep their language.
- Mermaid diagrams: `/mermaid` adds a diagram, and any code block set to "Mermaid" (or imported with that language,
  from Markdown fences or other tools) draws it under its source. The source shows while the cursor is in the block
  and hides when you leave it, leaving the diagram alone; click the diagram or "Edit" to change it. The drawing
  follows typing, keeps the last good one while the source has a mistake, and says on which line the mistake is.
  Flowcharts, sequence, class, state, Gantt, pie and the other Mermaid diagrams work, in the light and dark themes.
  Public pages show the diagram only, and printing puts the diagram on paper instead of its source. The library is
  downloaded the first time a page shows a diagram, and runs in strict mode (no HTML nor scripts in labels).
- Print and save as PDF, from the page menu ("…") or with Ctrl+P (⌘P): only the page is printed, without the
  sidebar, buttons or handles, on white even with the dark theme. Toggles are open, databases show all their rows
  (not only the first batch) and only the view shown, rows and blocks are not cut across two sheets, and the address
  of links is written after them. A new sheet can start before each heading 1, or each heading 1 and 2. The PDF is
  made by the browser ("Save as PDF" printer), so nothing more runs on the server.
- Date range filters: "is between" picks a first and a last day on a calendar, and "is relative to today" follows
  the current date (this week, this month, this year, the past 7 days, the next 2 months…). "Is", "is before",
  "is after"… also show a calendar.
- Simpler filters: "+ Filter" opens a searchable list of columns and adds a chip above the rows (Date: This week,
  Amount: > 100…). Click a chip to change its condition and value, in a small panel that opens smoothly. Chips all
  apply together; rules combined with "and" / "or" live in the advanced filter, at the bottom of the same list.
  Filters made by earlier versions show up as the advanced filter.

### Changed

- The gallery looks closer to what other tools show: wider covers, titles on up to two lines, softer cards, and a
  "New page" card as tall as the others at the end.

### Fixed

- Locking a page or a database in the desktop app didn't lock it on the server after the sync (unlocking did).
- Activity log: lines written in the same millisecond (a group taken out of a page right before someone is taken out
  of the group…) could be listed in either order. Their ids now follow the order they were written in.
- Clicking a block's dots to open its menu emptied the page (since equations came in, not in a released version).
- In a subpage, the breadcrumb showed the internal code of a parent page's uploaded image icon instead of the image.

## [3.6.0] - 2026-11-12

### Added

- Moving pages between spaces, with their subpages: drag a page onto another space's tree or onto its name in the
  sidebar, or choose the space in "Move to…" (right click). Handy to sort a Notion import, or to write a draft in
  your personal space and share it by moving it into a shared one. A confirmation says who will gain or lose access;
  content, history, attached files, comments, direct shares and public link are kept. Only owners and editors of
  both spaces can do it. A later Notion import keeps updating moved pages where they are, and leaves alone those its
  author can no longer edit. The desktop app follows moves made on the server (it refuses them in synced spaces).
- Status columns, as in Notion: one choice among options sorted into three categories (To do, In progress, Done),
  starting with Not started / In progress / Done. Options can be renamed, recolored, added to any category or moved
  to another; filters, sorts, groups, boards and charts follow the categories' order. A board picks a status column
  first. The Notion import keeps status columns and their categories (they used to become select columns), and
  turns the ones an earlier import made into selects back into status columns.
- "Last edited by" columns: who changed the row last (a cell, its title or its content), else its author.
- ID columns: rows are numbered 1, 2, 3… in the order they were created, with an optional prefix (TASK-12). New and
  duplicated rows get the next number; a number is never given twice.
- Phone columns: the number is a link that calls it.
- Percent columns can be shown as progress bars.
- The Notion import brings these too: phone numbers, IDs (with their prefix and numbers) and "Last edited by" (when
  the person has an account here), instead of texts or nothing. A new import upgrades the columns an earlier one
  imported as texts.

### Fixed

- Editing a database row template through the API (`PATCH /api/databases/:id/rows/:templateId`) answered with an
  error 500, although the change was saved.
- The map block (Map plugin) showed "Access blocked" instead of OpenStreetMap's tiles: they are now requested with
  the site's address, as OpenStreetMap's tile usage policy asks.

## [3.5.0] - 2026-11-11

### Added

- Repeating to-dos: "Repeat" in a to-do's block menu (every day, week, two weeks, month, year, or on chosen days).
  Checking it moves the first date written in it to the next time it is due, keeping its reminder; it stays checked
  until that day, then unchecks by itself. A loop after the text shows that it repeats.
- Automations on a schedule: every N days, weeks (on some days) or months (on a day), at a time in a time zone,
  from a day and until an optional last one. Their steps add rows, create pages or call webhooks. A time missed
  while the server was off still runs once, within a day.
- Formulas in automation and button steps: `{{= dateAdd(prop("Due"), 1, "weeks")}}` is computed as a formula column
  of the row would be. A task can repeat as in Notion: when its status becomes Done, move its due date on and set
  the status back. A formula that fails stops the steps, with its message in the automation's runs.
- Videos in pages (`/video`): a YouTube, Vimeo, Dailymotion, Loom, PeerTube, Twitch or Google Drive link plays in
  the site's own player (YouTube's without cookies until played), and a video file (MP4, WebM) uploaded or dropped
  in a page plays in the browser's. A video link pasted alone on an empty line becomes a video. Notion videos are
  imported as videos, and attached files can be played from any point (HTTP ranges).
- Images open full screen when clicked, in pages, columns and public pages: arrows, swipe or the keyboard go through
  the page's images, a click shows a large image at full size, Esc closes. Alt+click still selects the image.
- A desktop app for Windows, macOS and Linux (`apps/desktop`, built with Tauri): type the address of a Nootion
  server, keep several servers and switch between them from the menu. It reopens the last server at start, keeps you
  signed in, and opens links in the default browser. Its installers are attached to each release.
- The desktop app can also keep a Nootion space on the computer, with no server: "On this computer" starts Nootion in
  the background and signs in at once, without an account to create.
- Sync between the desktop app and a Nootion server: link spaces of a server from *Sync*, and they stay on the
  computer, usable without a connection, with changes from both sides merged (latest change of each field and cell,
  page text merged). Attached files and comments come along, with their authors.

### Changed

- The Notion import's report lists what was imported differently, line by line: the page or database, the column or
  block, the file's name, and a link to it in Notion, to check everything before deleting the Notion workspace. The
  list can be downloaded as a CSV file.

### Fixed

- Files linked from another site in a Notion file column showed a missing message in the import report.
- The block handle no longer covers a callout's emoji.
- The map block (Map plugin) showed "Access blocked" instead of OpenStreetMap's tiles: they are now requested with
  the site's address, as OpenStreetMap's tile usage policy asks.

## [3.4.0] - 2026-11-10

### Added

- Formulas speak Notion 2: lists `[1, 2, 3]`, method calls (`prop("Name").upper()`), variables with `let()` and
  `lets()`, and `map`, `filter`, `find`, `findIndex`, `some`, `every` and `sort` with `current` and `index`. A
  relation's pages give their columns with `current.prop("…")`, for example
  `prop("Invoices").filter(not current.prop("Paid")).map(current.prop("Total")).sum()`. New functions: `at`,
  `first`, `last`, `reverse`, `unique`, `flat`, `includes`, `split`, `median`, `test`, `match`, `replaceRegex`,
  `replaceAllRegex`, `repeat`, `padStart`, `padEnd`, `name`, `sign`, `cbrt`, `exp`, `ln`, `log10`, `log2`, `week`,
  `fromTimestamp`, `dateRange` and `id`, plus the constants `pi` and `e`. The Notion import keeps these formulas
  as formulas instead of freezing their values (only `link()` and `email()` still are).
- Two-factor authentication: in the account settings, signing in with a password can also ask for a 6-digit code
  from an authenticator app (Microsoft Authenticator, Google Authenticator, 2FAS, Aegis…), set up by scanning a QR
  code. Ten single-use recovery codes sign in when the phone is lost, and can be renewed. Administrators see who
  has it on and can turn it off for someone who lost both. Signing in through SSO is not affected.
- API tokens can read and write comments and set recurring templates, as [docs/API.md](docs/API.md) said they
  could: `/api/pages/:id/comments`, `/api/comments/…` and `/api/pages/:id/recurrence`. So can they change, pause and
  delete automations, list the icons and read and fill the inbox (with a token that reaches the personal space).
  An automation saved with a token can only add rows or pages in the spaces the token reaches.
- Documentation: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (how the code is laid out), a "Securing your
  instance" chapter in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), linking accounts in [docs/SSO.md](docs/SSO.md),
  webhooks and the local network in [docs/BUTTONS.md](docs/BUTTONS.md), hotfixes and image publishing in
  [CONTRIBUTING.md](CONTRIBUTING.md), features grouped by theme in the README.
- Plugins get `nootion.net.request`, an http(s) request that refuses the server's own network unless allowed.
- "What's new" window: after an update, each person sees the release notes of the versions they haven't seen yet,
  once, taken from this changelog (shipped in the image, so it works without internet access). New accounts don't
  get it, nor development builds.
- Database rows work as in Notion: a right click on a row (or a click on its ⋮⋮ handle) opens a menu to add it to
  the favorites, change its icon, open it (here or in a new tab), copy its link, duplicate it (Ctrl+D) and move it
  to the trash (Del), with a search field and when it was last edited. With several rows selected, the menu
  duplicates or trashes all of them. On hover, a "+" on the left of a row adds a new row right below it, and the ⋮⋮
  handle drags the row to reorder it (in a view without a sort; in a grouped table, dropping it in another group
  changes its group). The table shows each row's icon before its title.
- "Test management (QA)" plugin, off by default: test cases, test runs and results as in TestRail or Qase, kept in
  four ordinary databases (test cases, products, test runs, results) that the "/test run" block creates in one
  click. A run takes some suites and priorities, and can cover several products at once (PC, Xbox, PlayStation…):
  the block shows a grid of cases and products where each result is set with a click or the keys 1 to 5, with a
  comment, a ticket, who tested it and when. Tickets can be Azure DevOps work items, given by their number:
  the block links to them and shows their title and state. See [docs/QA.md](docs/QA.md).
- "Map" plugin, off by default: the "/map" block (`/carte`) shows the rows of a database as pins on an OpenStreetMap
  map, from a "Place" column (a new column type holding coordinates) or from latitude and longitude columns. It
  creates a "Places to visit" database in one click, searches addresses, towns and monuments (Nominatim), adds a
  place where one clicks or from a search, moves a pin by dragging it, shows only some statuses, goes to the user's
  position, lists the nearest places within a chosen distance, and opens in full screen. Each pin links to its row
  and to directions. See [docs/MAP.md](docs/MAP.md).
- Plugins can ship files (a library, styles, images) in an `assets/` folder, served at
  `/api/plugins/<id>/assets/…`.
- Plugin blocks receive `pageId`, the page they are in (null on public pages).
- Drawing block (`/drawing`, `/dessin`), like a sketch in Google Keep or a small Miro board: pen, highlighter,
  line, arrow, rectangle, ellipse, eraser, select and move, 10 colors (dark mode included) and 4 thicknesses, undo
  and redo (Ctrl+Z / Ctrl+Shift+Z). The drawing is saved with the page, scales to the width of the screen and its
  height can be changed by dragging its bottom edge. The whiteboard button opens it in full screen, on a canvas with
  no edges: move around with two fingers, the middle button, Space + drag or the hand tool, zoom with Ctrl + wheel or
  a pinch. On a phone, a finger scrolls the page and draws on the whiteboard; a pen draws everywhere. A drawing can be
  downloaded as SVG, and the Markdown export includes it as an image.
- Text boxes in drawings: with the T tool, click where the text goes and type (Enter for a new line, Escape or a
  click elsewhere to finish). The color and thickness set its color and size; click a text with the T tool, or
  double-click it, to change it, and move it with the selection tool. The text of drawings is found by the search.

### Fixed

- Notion import: "Import again" can also import the pages that didn't change in Notion, so that pages imported
  by an older version get what the import does better now (columns side by side, covers…). Image icons are
  copied as custom icons instead of being left out. A callout keeps every block inside it (headings, lists, links
  to pages), not only its paragraphs, and stays without an emoji when it has none in Notion; its paragraphs are
  shown one under the other instead of side by side.
- The export of the personal space was always named "Espace personnel", whatever the language.
- Dragging inside a widget of a page (the map) up or down follows the pointer again: the block handle used to give
  the whole page a false pointer position while it was over a widget.
- The handle left of a drawing, a widget or a database placed inside a to-do or a list stays on that block when the
  pointer moves towards it, instead of jumping to the to-do around it.
- The block handle follows the page when it scrolls, instead of staying beside another block (in an empty column,
  for instance).
- In columns, the handle of a line of text stays on it when the pointer is on its first line or moves towards the
  handle, instead of jumping to the whole columns block.

### Security

- Link previews ("Embeds" plugin) could be pointed at the server's own network with an IPv6 form of a local address
  (`http://[::ffff:7f00:1]/`). Local addresses are now recognised however they are written, and the address is
  checked as the connection is made (so a name can't change between the check and the request).
- Button webhooks no longer call addresses of the server's local network, unless an administrator allows it in
  **Administration › Security** (the button editor says which applies). On a public form, the answers can't change
  the server a webhook calls, and people without an account aren't told why a webhook failed.
- A personal API token limited to some spaces could list the pages of the user's other spaces through
  `GET /api/pages/all` and `GET /api/pages/graph`. Both now stay within the token's spaces.
- The server refuses to start in production with the example `APP_SECRET` of `docker-compose.yml`, which now reads
  `APP_SECRET`, `APP_URL` and `TZ` from a `.env` file next to it (copy [`.env.example`](.env.example)). An existing
  `docker-compose.yml` keeps working as it is.
- Single sign-on: an e-mail address the provider marks as not verified no longer links an existing account or makes
  a new one. Linking existing accounts by their address is now a setting of the SSO administration (on by default),
  with a warning about when to turn it off. The page opened after signing in is checked more strictly.
- Security headers on every answer (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, HSTS over
  HTTPS) and a Content-Security-Policy for the interface: only scripts served by Nootion run. Public pages and forms
  can still be shown inside another site. `CONTENT_SECURITY_POLICY=off` leaves the policy out.
- `X-Forwarded-*` headers are only believed from a reverse proxy on the server itself or its private network, so a
  visitor can't choose the address the sign-in limit counts. `TRUST_PROXY` changes this (see
  [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).
- An account that got twenty wrong passwords in fifteen minutes has to wait, wherever the attempts come from.
- The user directory no longer gives every account's name and e-mail address to everyone: people see those they
  work with (members of their shared spaces, people of the pages shared with or by them). Someone else is added to
  a page or a space by typing their exact e-mail address. Administrators still see everyone.
- Updated nodemailer (6 to 10), drizzle-orm and @fastify/static, which had known vulnerabilities. CI now runs
  `pnpm audit` on what ships in the image, and Dependabot proposes updates every week.
- "Link" cells refuse addresses that run code (`javascript:`, `data:`…) and only link web, mail and phone addresses.

## [3.3.0] - 2026-11-03

### Added

- The sidebar can be resized by dragging its right edge, as in Notion (from 200 to 480 pixels, remembered per
  browser); clicking the edge puts it away. With the keyboard: focus the edge, then the arrows.
- A click on the dots left of a block opens its menu, as in Notion: turn it into another kind (text, headings,
  lists, to-do, quote, callout, code), duplicate, move up or down, comment or delete it, with a search box.
  Ctrl+D duplicates the block the cursor is in, and Ctrl+Shift+Up/Down moves it.
- Blocks can be colored from their menu: the text, or the background, in Notion's colors (dark mode included).
- "Copy link to block" in the block menu: the link opens the page scrolled to the block, which is shown for a moment.
- The block menu says who last edited the block, and when.

## [3.2.1] - 2026-11-03

### Fixed

- Drop-down lists (roles, view settings…) are readable in dark mode on Windows: their options were light text on a
  white background.
- Opening a page no longer shows a scrollbar for a split second, shifting the content sideways.

## [3.2.0] - 2026-11-03

3.1.0 was tagged on the code of 3.0.0 by mistake: its changes come with this version, listed below.

### Added

- Single sign-on (SSO) with any OpenID Connect provider (Microsoft Entra ID, Google Workspace, Okta, Keycloak…),
  set in Administration > Single sign-on: "Sign in with Microsoft" on the sign-in page and on invitations, existing
  accounts linked by their address, new accounts for invited people, some domains or everyone, sessions limited
  to 12 hours by default, and passwords that can be turned off (except for administrators).
  SCIM lets the provider create accounts, keep them up to date and disable people who leave. See
  [docs/SSO.md](docs/SSO.md).
- The version running shows at the bottom of the sidebar. When a newer release is out, administrators see a ⚠ next
  to "Administration" and a notice in Administration with a link to what's new, which they can hide until the next
  release; "Check now" looks right away. `UPDATE_CHECK=false` turns the check off.
- E-mail, set by administrators in Administration > E-mail, through an SMTP server or Resend, with a test e-mail:
  - reminders, mentions and comment replies are also sent by e-mail; each user picks which in My account;
  - an invitation made for an address is sent to it;
  - "Forgot your password?" on the sign-in page sends a link (valid an hour, once) to choose a new password.
- A demo page, "Discover Nootion", given to each new user on their first visit: every kind of block, a "Projects"
  database with its six views, a subpage and all the widgets, filled with made-up data. It is an ordinary page to
  delete; "Create the demo page" in My account makes a new one. `DEMO_PAGE=false` turns it off.
- Widgets in the "/" menu, for dashboards and home pages:
  - Chart: the rows of a database view by status, month, person… as bars, columns, a line or a donut, counting rows
    or adding up a number column.
  - Progress bar: of the year, month, week or day, of the rows checked in a database, or towards a goal of your own.
  - Countdown to a date and time, ticking every second.
  - Pomodoro timer, with short and long breaks, a chime, and the time left in the tab's title.
  - Habit tracker: a grid of days as on GitHub, with the current streak; tick today in one click.
  - Clock (any time zone) and weather with the next days' forecast (from Open-Meteo, asked by the browser).
  - Quote of the day, from a set of classics or from a database of your own.
  - Image carousel, with uploaded images or addresses, changing on its own or by hand.
- The page's top bar tells when it was last edited ("Edited at 14:32", "Edited yesterday at…", the full date on
  hover), and shows "Saved" for a moment once your changes are on the server.
- Date ranges and times in databases, as in Notion: the date editor has an end date and an "Include time" switch, for
  things that last several days or have a start and end time. The calendar shows them as one bar across the days,
  with the start time on the first day and the end time on the last ("14:00–15:00" when on one day).
- "All pages" in the sidebar: every page and database you can open, with where it is, who made it and when it
  changed, to search by title, filter by kind or space, and sort.
- "Graph" in the sidebar, as in Obsidian: every page as a dot, with lines for the links and mentions between pages
  (dotted for subpages). Hover a page to light up its links, click to open it, zoom and drag to look around.
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
- On phones, the bottom of the sidebar (My account, Administration) no longer hides under the browser's toolbar;
  My account also links to the administration for administrators.

## [3.1.0] - 2026-10-31

Tagged on the code of 3.0.0 by mistake; its changes are in 3.2.0.

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

[4.3.1]: ../../releases/tag/v4.3.1
[4.3.0]: ../../releases/tag/v4.3.0
[4.2.0]: ../../releases/tag/v4.2.0
[4.1.0]: ../../releases/tag/v4.1.0
[4.0.0]: ../../releases/tag/v4.0.0
[3.6.0]: ../../releases/tag/v3.6.0
[3.5.0]: ../../releases/tag/v3.5.0
[3.4.0]: ../../releases/tag/v3.4.0
[3.3.0]: ../../releases/tag/v3.3.0
[3.2.1]: ../../releases/tag/v3.2.1
[3.2.0]: ../../releases/tag/v3.2.0
[3.1.0]: ../../releases/tag/v3.1.0
[3.0.0]: ../../releases/tag/v3.0.0
[2.0.1]: ../../releases/tag/v2.0.1
[2.0.0]: ../../releases/tag/v2.0.0
[1.2.0]: ../../releases/tag/v1.2.0
[1.1.0]: ../../releases/tag/v1.1.0
[1.0.0]: ../../releases/tag/v1.0.0
