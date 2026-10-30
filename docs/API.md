# Nootion API

Nootion's REST API lets scripts and other apps (Home Assistant, n8n, a backup script…) read and write pages, query
and fill databases, and search, as you, with a **personal token**. AI assistants connect more simply through the
[MCP server](MCP.md).

- [Tokens](#tokens)
- [Requests and errors](#requests-and-errors)
- [Spaces and pages](#spaces-and-pages)
- [Page content](#page-content)
- [Databases](#databases)
- [Files](#files)
- [Search](#search)
- [Examples](#examples)

## Tokens

Create a token in **My account › API tokens**:

- **Name**: to recognise it later (e.g. "Home Assistant").
- **Spaces**: the spaces it can reach, among those you belong to. Pages shared with you from other spaces are out of
  its reach.
- **Access**: *read only* (it can read and search, nothing else) or *read and write*. With write access it can do
  what you can do in those spaces.
- **Expiry**: 30, 90 or 365 days, or never.

The token (`nt_…`) is shown **once**: copy it then. The list shows when each token was last used, apps connected
with OAuth (such as Claude), and what was changed with your tokens; revoke one there and apps using it stop at once.
Page versions written with a token are marked with its name in the page's history. A token stops working too when it expires or when your account is disabled.

A token can't change your account, other tokens, sharing or public links, delete anything for good (the trash keeps
what it deletes), or use the administration.

## Requests and errors

Send the token in the `Authorization` header, and JSON bodies with `Content-Type: application/json`:

```sh
curl https://nootion.example.com/api/auth/me -H "Authorization: Bearer nt_…"
```

Answers are JSON. Errors have an HTTP status and a body like `{ "error": "token_read_only", "message": "This API
token is read-only." }` (the message is in your interface language):

| Status | `error` | Meaning |
| --- | --- | --- |
| 400 | `invalid_input`, `bad_content`, `unknown_property`… | The request is wrong; the message says what. |
| 401 | `bad_token` | Unknown, revoked or expired token. |
| 403 | `token_not_allowed` | Tokens can't make this request (see above). |
| 403 | `token_read_only` | Writing with a read-only token. |
| 404 | `not_found` | It doesn't exist, or the token can't reach it (they are not told apart). |
| 429 | `too_many_requests` | More than 300 requests in a minute with this token (`API_RATE_LIMIT` on the server changes it). |

Ids are UUIDs. Dates are ISO 8601.

## Spaces and pages

| Request | What it does |
| --- | --- |
| `GET /api/auth/me` | The token's user. |
| `GET /api/users` | Active users of the instance (`id`, `name`, `email`), for person columns. |
| `GET /api/workspaces` | The token's spaces, with your role in each (`viewer` with a read-only token). |
| `GET /api/workspaces/:id/pages` | Every page and database of a space (`id`, `parentId`, `kind`, `title`, `icon`, `position`…). Database rows are not listed: query their database. |
| `GET /api/pages/:id` | A page's details: title, icon, cover, `kind` (`page`, `database` or `row`), your role, breadcrumb. |
| `POST /api/pages` | Creates a page: `{ "workspaceId", "parentId": null, "title", "icon"?, "markdown"? }` (or `content`, see below). |
| `PATCH /api/pages/:id` | Changes `title`, `icon`, `cover` (`https://…` image), `fullWidth`. |
| `POST /api/pages/:id/move` | Moves it: `{ "parentId": "…" or null, "index"? }`. |
| `DELETE /api/pages/:id` | Moves it to the trash, with its subpages. |
| `POST /api/pages/:id/restore` | Takes it out of the trash. |
| `GET /api/pages/:id/backlinks` | Pages that link to it. |
| `GET /api/pages/:id/history` | Its versions; `GET /api/pages/:id/history/:versionId` reads one. |
| `GET /api/pages/templates` | Page templates; `POST /api/pages/:id/apply-template` with `{ "templateId" }` fills an empty page from one. |

## Page content

Pages and database rows have content. It is read and written as **Markdown**, or as the editor's JSON
(ProseMirror) for everything Markdown can't say.

| Request | What it does |
| --- | --- |
| `GET /api/pages/:id/content` | `{ "id", "title", "markdown", "content" }`. Includes what people are typing right now. |
| `PUT /api/pages/:id/content` | Replaces the content: `{ "markdown": "…" }` or `{ "content": { "type": "doc", … } }`. The previous content stays in the page's history. |
| `POST /api/pages/:id/content` | Adds at the end of the page, same body. |

Changes show at once to people who have the page open.

Markdown understood: headings (`#` to `###`), paragraphs, **bold**, *italic*, ~~strike~~, `code`, links, bulleted,
numbered and to-do lists (`- [ ]`, `- [x]`, nested by indentation), quotes, code blocks with their language, tables,
images (`![alt](https://…)`), dividers (`---`). Links and images must point to `http(s)://`, `mailto:` or the
server's files (`/api/attachments/…`).

The JSON form takes the editor's blocks only (toggles, callouts, columns, dates, links to pages…); read a page's
`content` to see how they are written. A date with a reminder keeps it only if the reminder is yours.

## Databases

A database is a page of kind `database`; its rows are pages of kind `row`, with cell values and content.

| Request | What it does |
| --- | --- |
| `GET /api/databases` | Databases you can read. |
| `GET /api/databases/:id` | Its columns (`properties`: `id`, `name`, `type`, `config` with select options), views, and all rows. |
| `POST /api/databases/:id/query` | Rows filtered and sorted, a page at a time (below). |
| `POST /api/databases` | Creates one: `{ "workspaceId", "parentId": null, "title" }`. |
| `POST /api/databases/:id/rows` | Adds a row: `{ "values": { … }, "markdown"? }`. |
| `PATCH /api/databases/:id/rows/:rowId` | Changes cells: `{ "values": { … } }` (cells not named stay as they are; `null` empties one). |
| `POST /api/databases/:id/rows/delete` | Moves rows to the trash: `{ "ids": [ … ] }`. |
| `POST /api/databases/:id/properties` | Adds a column: `{ "name", "type", "config" }`. `PATCH`/`DELETE …/properties/:propId` change or remove one. |

### Cell values

`values` is keyed by column id **or name** (any case). A select option may be given by its id or its name.

| Column type | Value |
| --- | --- |
| `title`, `text`, `url`, `email` | `"text"` |
| `number`, `currency`, `percent` | `12.5` |
| `checkbox` | `true` / `false` |
| `date` | `{ "start": "2026-11-15", "end": null }`; with a time: `{ "start": "2026-11-15T09:00" }` |
| `select` | `"Done"` (option name or id) |
| `multi_select` | `["Urgent", "Home"]` |
| `person` | `["<user id>"]` |
| `relation` | `["<row id>"]` |
| `file` | `[{ "id": "<attachment id>", "name": "bill.pdf" }]` |
| `created_time`, `last_edited_time`, `created_by`, `rollup`, `formula` | Read only. |

Rows read back have `values` keyed by column **id**, with option ids: `GET /api/databases/:id` (or the query's
`properties`) gives the names.

### Query

```json
POST /api/databases/:id/query
{
  "filters": [{ "propertyId": "Status", "operator": "is", "value": "To do" }],
  "filterMode": "and",
  "sorts": [{ "propertyId": "Due", "direction": "asc" }],
  "limit": 100,
  "cursor": null
}
```

All fields are optional. `viewId` uses a view's filters and sorts instead. Columns are named by id or name.
The answer is `{ "rows", "total", "nextCursor", "properties", "people", "related" }`: pass `nextCursor` as `cursor`
for the next rows, until it is `null`. `limit` goes up to 1000. A read-only token can query.

Operators, by column type:

| Type | Operators | `value` |
| --- | --- | --- |
| text, url, email, title | `contains`, `not_contains`, `is`, `is_not`, `starts_with`, `ends_with` | text |
| number, currency, percent | `eq`, `neq`, `gt`, `lt`, `gte`, `lte` | number |
| date, created/edited time | `is`, `before`, `after`, `on_or_before`, `on_or_after` | `"2026-11-15"`, or `today`, `tomorrow`, `yesterday`, `one_week_ago`, `one_week_from_now`, `one_month_ago`, `one_month_from_now` |
| date | `within` | `past_week`, `past_month`, `past_year`, `next_week`, `next_month`, `next_year` |
| checkbox | `checked`, `unchecked` | none |
| select | `is`, `is_not` | option name or id |
| multi_select | `contains`, `not_contains` | option name or id |
| person, created_by | `contains`, `not_contains` | user id, or `me` for you |
| relation, file | `contains`, `not_contains` | text found in a linked row's title or a file's name |
| all | `is_empty`, `is_not_empty` | none |

## Files

| Request | What it does |
| --- | --- |
| `POST /api/pages/:id/attachments` | Uploads a file (`multipart/form-data`, field `file`): `{ "attachment": { "id", "filename", "url" } }`. Put its `url` in the content (`![photo](/api/attachments/…)`) or in a file column. |
| `GET /api/attachments/:id` | Downloads it (`?download` to save it under its name). |

## Search

`GET /api/search?q=words&limit=20` searches titles, content and attached files (PDFs, scans) of the token's
spaces: `{ "results": [{ "id", "title", "kind", "path", "snippet", "file"? }] }`.

## Examples

Add a row to a to-do database, with a note in its page:

```sh
curl -X POST https://nootion.example.com/api/databases/$DB/rows \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "values": { "Name": "Change the boiler filter", "Status": "To do", "Due": { "start": "2026-11-15" } },
        "markdown": "Model **X200**, filter ref. F-12." }'
```

Append a line to a journal page:

```sh
curl -X POST https://nootion.example.com/api/pages/$PAGE/content \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "markdown": "- 21:30 Front door opened" }'
```

The open tasks due this week, in Python:

```python
import requests

API = "https://nootion.example.com/api"
headers = {"Authorization": "Bearer nt_…"}
res = requests.post(f"{API}/databases/{db}/query", headers=headers, json={
    "filters": [
        {"propertyId": "Status", "operator": "is_not", "value": "Done"},
        {"propertyId": "Due", "operator": "within", "value": "next_week"},
    ],
    "sorts": [{"propertyId": "Due", "direction": "asc"}],
})
for row in res.json()["rows"]:
    print(row["title"])
```
