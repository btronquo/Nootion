# Connecting AI agents (MCP)

Nootion has a built-in [MCP](https://modelcontextprotocol.io) server, so that Claude or another AI assistant can
search, read and write your pages and databases, as you, within the spaces you choose.

- [Connecting Claude (claude.ai, desktop and mobile apps)](#connecting-claude)
- [Connecting Claude Code or another agent](#connecting-claude-code-or-another-agent)
- [What an agent can do](#what-an-agent-can-do)
- [Keeping an eye on agents](#keeping-an-eye-on-agents)
- [For developers](#for-developers)

The server's address is `APP_URL` followed by `/mcp`, e.g. `https://mynootion.example.com/mcp`. It is shown in
**My account › AI agents (MCP)**.

## Connecting Claude

Claude's custom connectors work on claude.ai and in the desktop and mobile apps.

1. Nootion must be **reachable from the internet over HTTPS**: Claude connects from Anthropic's servers, not from your
   computer. Put Nootion behind an HTTPS reverse proxy or a tunnel (Cloudflare Tunnel, Tailscale Funnel…) and set
   `APP_URL` to that public `https://…` address (see [DEPLOYMENT.md](DEPLOYMENT.md)). The proxy must pass on `/mcp`,
   `/oauth/…`, `/api/…` and `/.well-known/…`, which it does when it forwards everything to Nootion.
2. In Claude, open **Settings › Connectors**, choose **Add custom connector**, give it a name and paste the server's
   address. No client id or secret is needed.
3. Claude opens a Nootion page (sign in if asked). Choose the spaces Claude may reach and whether it may only read or
   also write, then **Allow**.

The connection then shows in **My account › API tokens** as a *connected app*. Revoke it there to disconnect Claude at
once. Signing in again from Claude asks you again.

Behind the scenes this is OAuth 2.1 with PKCE and dynamic client registration: Claude registers itself, gets a code
once you allow it, and exchanges it for an access token that lasts an hour and that it renews by itself.

## Connecting Claude Code or another agent

Agents that let you set a header (Claude Code, scripts, most MCP clients) can use a **personal token** instead, and
work on your local network too, without HTTPS:

1. In **My account › API tokens**, create a token for the spaces the agent should reach, read only or read and
   write.
2. Add the server with the token. For Claude Code:

   ```sh
   claude mcp add --transport http nootion https://mynootion.example.com/mcp --header "Authorization: Bearer nt_…"
   ```

Agents that only know OAuth connect as Claude does above.

## What an agent can do

| Tool | What it does |
| --- | --- |
| `search` | Searches titles, content and attached files (PDFs, scans). |
| `list_spaces`, `list_pages` | The spaces it can reach, and the tree of pages and databases of one. |
| `read_page` | A page as Markdown, with its place in the tree; for a database row, its cell values too. |
| `list_databases`, `get_database` | Databases, and a database's columns, select options and views. |
| `query_database` | Rows filtered and sorted, with their values by column name. |
| `create_page` | A new page, with its content in Markdown. |
| `append_to_page`, `replace_page_content` | Adds to a page, or rewrites it (the previous content stays in its history). |
| `update_page`, `move_page`, `trash_page` | Renames, moves, or moves to the trash (from which you can restore it). |
| `create_database` | A new database with the columns asked for. |
| `add_database_row`, `update_database_row` | Adds a row (with its page content), or changes cells. |

With read-only access, an agent only gets the reading tools. It acts as you: it can't reach what you can't, and its
changes show at once to people who have the page open. It can't delete anything for good, change sharing, public
links, your account or the administration.

## Keeping an eye on agents

- Every version of a page written by an agent is kept in the page's **history**, marked *via Claude* (the token's
  name).
- **My account › API tokens** lists what apps and agents changed, latest first (the last 1000 changes): which page
  they created, completed, rewrote, which rows they added or changed.

## For developers

The server speaks MCP's Streamable HTTP transport, without sessions: `POST /mcp` with a JSON-RPC message and an
`Authorization: Bearer` header. Without a valid token it answers `401` with a `WWW-Authenticate` header pointing to
`/.well-known/oauth-protected-resource/mcp`, from which clients discover the OAuth server
(`/.well-known/oauth-authorization-server`): registration at `/api/oauth/register`, consent page at
`/oauth/authorize`, tokens at `/api/oauth/token` (`authorization_code` with S256 PKCE, `refresh_token`), revocation at
`/api/oauth/revoke`. Redirect addresses must be `https://…` or on `localhost`.

The tools call the [REST API](API.md) as the token's user, so they follow the same permissions and the same rate
limit (300 requests a minute, `API_RATE_LIMIT`).
