# Writing, finding and printing

This page explains, for everyday users, the editor and search features that are not obvious at first sight: text
colours, code blocks, the command palette, search filters and saved searches, and printing a page or saving it as
PDF. Importing Markdown, HTML, Word or CSV files is described in
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

## Command palette (Ctrl+K)

**Ctrl+K** (⌘K on a Mac), or *Search* in the sidebar, opens one box for both finding pages and doing things.

- With nothing typed, it lists the actions you used last, then your **saved searches**.
- Typing finds pages (see below) and, above them, the **actions** whose name matches: new page or database (in the
  open page's space or another one), quick capture, add a subpage, go to Home, Notifications, All pages, Graph,
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
