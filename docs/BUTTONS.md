# Buttons, automations and forms

A **button** runs a list of steps when it is clicked: add a row to a database, change the current row, create a page,
open a page or a link, call a webhook. It can first open a **form**, whose answers the steps use. A form can also get a
**public link**, to collect answers from people without an account.

- In a page: type `/button` (`/bouton`). Its settings open from the gear next to it.
- In a database: add a column of type **Button**, then **Set up the button** in the column's menu. Each row has its
  button, and its steps can change that row.

Steps run on the server, in order, with the rights of the person clicking: a step that writes where they can't write
fails, and the button stops there, saying which step failed.

## Steps

| Step | What it does |
| --- | --- |
| Add a row to a database | A value per column (empty leaves the column empty), page content in Markdown, and optionally opens the row. |
| Change this row | For a button column, or a button in a row's page: the columns to change. |
| Create a page | Inside this page or another one, from a page template or not, with a title and content; optionally opens it. |
| Open a page or a link | A page of Nootion, or an address (`https://…`, or a variable such as `{{created.url}}`). |
| Call a webhook | Sends a POST request with JSON: the body you write, or by default the button, user, page, row, form answers and what the steps created. Home Assistant, n8n, Zapier… |

### Webhooks and the local network

A webhook only calls addresses on the internet. An address of the server's own network (`http://192.168.1.20:8123`,
`http://homeassistant.local`, `localhost`…) is refused, with a message saying so, unless an administrator ticks
**Administration › Security › Let button webhooks call the local network**. The button editor tells, under the
address, which applies on your server.

The reason: steps run on the server, so a webhook can reach what the server can reach. With the option on, anyone
who can edit a page can make the server send requests to devices of the local network. Turn it on for a family or
a team you trust; leave it off if people you don't fully trust have an account.

Redirections are followed (three at most) and checked the same way. The call must be answered within 10 seconds
with a 2xx status, or the step fails.

### Values

Each column takes a text, converted to its type: a number (`12,5`), `true`/`false` for a checkbox, a date
(`2026-11-15`, `{{today}}`, or in plain words: `tomorrow`, `next friday`, `in 3 days`), the name of an option for a
select (names separated by commas for a multi-select), `me`, a name or an email for a person, row ids for a relation.

### Variables

Texts may hold variables between double braces, inserted by clicking them under the settings:

| Variable | Value |
| --- | --- |
| `{{today}}`, `{{now}}` | The date (and time) of the person clicking. |
| `{{user}}`, `{{user.email}}`, `{{me}}` | Their name, email, and id (for person columns). |
| `{{page.title}}`, `{{page.url}}` | The page the button is in (for a button column: the row). |
| `{{row.title}}`, `{{row.<column>}}`, `{{row.id}}` | The current row's values, by column name. |
| `{{form.<field>}}` | An answer to the form, by field name. |
| `{{created.title}}`, `{{created.url}}`, `{{created.id}}` | The last page or row a step created. |

## Forms

Fields are text, long text, number, date, choice, checkbox or person, each possibly required. The form opens when the
button is clicked; its answers then fill the steps' `{{form.<field>}}`.

### Public link

In a page's button with a form, **Create a public link** gives an address (`/f/…`) anyone can open, without an account,
for instance to collect expenses or ideas from family members. Their answers run the button's **Add a row** and
**Call a webhook** steps with the rights of the person who made the link (the other steps don't run, and `{{user}}` and
`{{me}}` are empty). Answers are limited to 10 a minute from one address. Remove the link to close the form.

On a public form, the answers can go in a webhook's body or in its path (`https://example.com/hook/{{form.Name}}`),
but never choose the server called: a webhook whose host comes from an answer doesn't run. And when a webhook fails,
people without an account aren't told why.

Buttons show on public pages, without what they do, and do nothing there.
