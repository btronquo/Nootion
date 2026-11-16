# Writing, finding and printing

This page explains, for everyday users, the editor and search features that are not obvious at first sight: text
colours, code blocks, equations, the list of all your to-dos, locking a page or a database, the command palette,
search filters and saved searches, and printing a page or saving it as PDF. Importing Markdown, HTML, Word or CSV
files is described in
[DEPLOYMENT.md](DEPLOYMENT.md#importing-from-files).

## Text colour and highlight

Select some text: the selection toolbar has an **A** button. It opens the nine colours that blocks already have,
twice: once for the **text** itself, once for a **highlight** behind it. *Default* and *No highlight* take them off.

- **Ctrl+Shift+H** (⌘⇧H on a Mac) highlights the selection in yellow, or removes the highlight.
- On a phone, the editing bar above the keyboard has the same **A** button.
- Colours show on public pages, in the page history and through the API.
- In Markdown (export, import, API), a highlight is written between `==`: `==important==`.

## Code blocks

Type ` ``` ` or choose *Code* in the "/" menu. The menu above the block picks the language of the code:

- **Auto** (the default) guesses the language as you type, and shows what it found ("Auto · Python").
- Type in the menu to find one of about 35 languages; **Plain text** turns colours off.
- **Copy** copies the whole block; **Wrap lines** shows long lines on several lines instead of scrolling sideways.
- **Tab** indents inside a code block.

Each language is downloaded the first time a block uses it, so pages without code load nothing more. Public pages
show the colours too. Code blocks imported from Markdown (` ```python `) or from other tools keep their language.

## Equations

Equations are written in LaTeX and drawn as they would be on paper.

- **A block equation**, centred on its own line: type `$$` then a space at the start of an empty line, or choose
  *Equation* in the "/" menu. Its editor opens at once.
- **An equation in a line of text**: type it between dollars, `$\pi r^2$`; the closing `$` turns it into an
  equation. *Inline equation* in the "/" menu does the same. Prices are left alone: in "between $5 and $10" nothing
  changes, because an equation may not start or end with a space and a `$` followed by a digit does not close one.
  Type `\$` for a dollar that should never start an equation.
- **Click an equation** (or select it and press Enter) to change it: a small editor shows the LaTeX and the drawing
  as you type. A mistake is explained under it ("Expected '}'…") and the equation shows its LaTeX in red until it is
  fixed. Enter closes the editor of an inline equation; a block takes several lines and closes with Ctrl+Enter (⌘↩)
  or *Done*. An equation left empty is removed.

The drawing library is downloaded the first time a page shows an equation, so pages without one load nothing more.
Equations show on public pages, in the history, in print and in the dark theme. Search finds a page by the LaTeX of
its equations. For safety, commands that would make links or add HTML (`\href`, `\url`, `\includegraphics`…)
are not drawn.

In Markdown (export, import, API), an inline equation is written `$…$` and a block between two `$$` lines;
` ```math ` blocks are read as equations too. Equations from other tools' exports (HTML pages drawn with KaTeX, the
API import) are kept as equations.

## Tasks: all your to-dos in one list

**Tasks**, in the sidebar under *Notifications*, lists every to-do still unchecked in the pages you can read, in all
your spaces and in the pages shared with you. To-dos are the checkboxes of the editor (type `[]` or choose *To-do
list* in the "/" menu); database rows keep their own filtered views.

- **By page** (the default) shows the to-dos page by page, the pages changed last first, in the order of each page.
- **By date** sorts them by the first date written in their line (`@friday`, `@2026-12-01`): *Overdue* (in red),
  *Today*, *Next 7 days*, *Later* and *No date*. Each to-do then says which page it is in.
- Filters: a **space**, **Mentioning me** (to-dos with your `@name`) and **With a date**.
- **Check a box** in the list and it is checked in its page, for everyone who has it open, and kept in the page's
  history. A repeating to-do behaves as in its page: it unchecks by itself on its next day, with its date moved.
- **Click the text** to open the page at that to-do: the page scrolls to it and shows it for a moment.
- **Done lately**, at the bottom, lists what was checked in the last 7 days, here or in the pages: uncheck one to put
  it back on the list.

You can only check the to-dos of pages you may edit; the others show a box you can't click. To-dos of templates and
of pages in the trash are not listed. The home page has a **Tasks** widget with the first to-dos (the dated ones
first) and a link to the whole list; add it to any page with *Tasks* in the "/" menu.

## Locking a page or a database

A reference page (a procedure, a contract, a checklist used by everyone) can be changed by accident. Lock it: in the
page's **⋯** menu, turn on **Lock page** (or *Lock database*), or type "lock" in the command palette.

- A locked page shows a **Locked** padlock at the top. Its content, title, icon and cover are read-only for
  everyone, you included, until someone unlocks it.
- Anyone who can edit the page can unlock it: click the padlock, or turn the switch off in the menu. The lock
  prevents mistakes; it is not a permission (sharing decides who can edit).
- A **locked database** keeps its columns, views (filters, sorts, groups, widths) and row templates as they are,
  and shows the padlock beside its view tabs, also where it is shown inside another page. Its rows can still be
  added, filled in and deleted; only existing options can be picked in a select column.
- A row opened as a page can be locked on its own: its cells and content are then read-only.
- Comments, favourites, sharing, moving and exporting still work on a locked page. Its to-dos show in **Tasks** but
  can't be checked from there. A version from the history is restored once the page is unlocked.
- People who have the page open see it switch to read-only (or back) at once.

The server refuses the changes too, not only the interface: the API answers `423 Locked`, and the live editor opens
the page read-only. The lock travels with the desktop app's sync like the page's other settings.

## Linked views: a database shown in another page

A **linked view** shows a database that lives elsewhere, inside any page, with filters, sorts and views of its own.
Typical use: one "Tasks" database, and in each project page a view of it showing only that project's tasks.

- Type **/linked view** (or *Linked view* in the "/" menu), then pick the database in the list that appears.
- The view starts as a copy of the database's first view. Filter, sort, group, hide columns or add views (board,
  calendar, timeline…) as usual: it changes only this block, never the database's own views or other linked views.
- Rows are the database's: adding, editing or deleting a row here does it in the database, for everyone.
- The title (with a link icon) is the database's and opens it. Renaming happens in the database itself.
- Who sees what doesn't change: someone who can't read the database sees a notice instead. The editors of the page
  may change the linked view's views even if they can only read the database; its rows stay read-only for them.
- Deleting the block removes its views after 30 days, so that undo or the page's history bring it back intact.
  Duplicating the page, or making pages from a template, copies the linked view with its filters.
- A linked view's views belong to its page: locking the database doesn't freeze them, locking the page does.

## Command palette (Ctrl+K)

**Ctrl+K** (⌘K on a Mac), or *Search* in the sidebar, opens one box for both finding pages and doing things.

- With nothing typed, it lists the actions you used last, then your **saved searches**.
- Typing finds pages (see below) and, above them, the **actions** whose name matches: new page or database (in the
  open page's space or another one), quick capture, add a subpage, go to Home, Notifications, Tasks, All pages, Graph,
  Trash, My account or Administration, change the theme or the language, and the open page's own actions (share,
  favorite, comments, history, full width, duplicate, move to, copy link, export, print).
- Start with **>** to list actions only.
- **↑ ↓** choose, **Enter** opens the page or runs the action, **Esc** closes.

Matching ignores accents and case, and the actions used most recently come first. Actions you can't do (editing a
read-only page, for example) are not listed.

## Search

Search looks in page titles and content, in attached files (PDF, images and scans, text files), and in the
**values of databases**: searching "Dupont" also finds the invoice whose "Customer" cell says Dupont. Such a result
shows the database and the row ("Invoices › INV-12"), with the matching cells under it ("Customer: Dupont · Status:
Paid"). Text, number, select, status, person, link, e-mail, phone, file and ID columns are searched.

### Filters

The filters under the search box narrow the results. They can be combined:

| Filter | What it keeps |
| --- | --- |
| Space | Pages of one space (shown when you belong to several). |
| Type | Pages, databases, database rows or files. |
| Database | Rows of one database. |
| Author | Pages created by you, or by someone else. |
| Edited | Pages changed in the last 24 hours, 7 days, 30 days or 12 months. |

With filters and no words, the latest changed pages that match are listed, for example "the rows of Invoices
changed in the last 7 days". The **×** at the end clears every filter.

### Saved searches

Once words or filters are set, **Save** (the bookmark next to the search box) keeps the search under a name. Saved
searches are listed when the box is empty: choose one to run it again, or remove it with its **×**. Each person has
their own.

The REST API (`GET /api/search`) and the MCP server's search take the same filters: see [API.md](API.md).

## Printing and saving as PDF

Choose **Print / Save as PDF** in the page menu (**…** at the top right), or press **Ctrl+P** (⌘P). Only the page is
printed: no sidebar, buttons or handles, on white even with the dark theme.

- Toggles are printed open, and databases print all their rows (not only the first ones loaded), in the view shown.
- Rows and blocks are not cut across two sheets.
- **New sheet before**: nothing, each heading 1, or each heading 1 and 2.
- **Write the address of links**: the address is printed after each link, for a paper copy.

To get a PDF, choose **Save as PDF** as the printer in the browser's print window. The PDF is made by the browser,
so nothing more runs on the server.

## Public links: password and end date

**Share** › **Public link** gives an address anyone can open without an account, read-only. Under the address, two
options protect it:

- **Ask for a password**: type a password (at least 4 characters) and save. Visitors first see a small page asking
  for it; once typed, their browser remembers it for 12 hours, for this link only (the page, its subpages, its files
  and its databases). Changing the password asks every visitor again; unticking the box opens the link to anyone
  who has the address. The password is never shown again, only that there is one.
- **Stops working**: never, after 1, 7 or 30 days, or on a date (the end of that day). After the end, the address
  shows "This link has expired" and nothing of the page. In the share window the address is greyed and struck
  through, with **Extend by 7 days**; any other choice in the list works too. The address stays the same, so it
  works again as soon as it is extended.

Wrong passwords are limited to 10 a minute for each link, whoever types them. The answers of a protected link are not
kept in the browser's offline copy.

Public forms of buttons have the same two options, under their address (see [BUTTONS.md](BUTTONS.md#public-link)).
