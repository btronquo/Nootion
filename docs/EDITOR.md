# Writing, finding and printing

This page explains, for everyday users, the editor and search features that are not obvious at first sight: text
colours, code blocks, the list of all your to-dos, the command palette, search filters and saved searches, and
printing a page or saving it as PDF. Importing Markdown, HTML, Word or CSV files is described in
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
