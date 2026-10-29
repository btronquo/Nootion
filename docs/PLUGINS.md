# Writing a Nootion plugin

A plugin adds editor **blocks** (`/` command), **API routes**, **scheduled tasks** and **formula functions**
to Nootion. The administrator turns it on and off and fills in its settings in **Administration › Plugins**.

> Plugins are installed on trust, as on any personal server: their server code runs with the same rights
> as Nootion. Only install plugins whose source you know.

The **Embeds** plugin that ships with Nootion is a complete example: [`apps/server/plugins/embed`](../apps/server/plugins/embed).

## Installing a plugin

1. Copy the plugin's folder to `/data/plugins/<id>/` (Nootion's data volume).
2. Restart the container.
3. Turn it on in **Administration › Plugins**. Turning it on or off, or changing a setting, needs no restart.

## Structure

```
my_plugin/
├── manifest.json   required
├── server.js       server code (ES module), optional
└── client.js       browser code (ES module), optional
```

### manifest.json

```json
{
  "id": "my_plugin",
  "name": "My plugin",
  "version": "1.0.0",
  "description": "What the plugin does.",
  "author": "Me",
  "homepage": "https://example.org",
  "server": "server.js",
  "client": "client.js",
  "blocks": [
    { "id": "map", "title": "My map", "description": "Text of the / menu", "icon": "🗺️", "keywords": "map plan", "defaultData": {} }
  ],
  "settings": [
    { "key": "apiKey", "label": "API key", "type": "password", "help": "Encrypted on the server." },
    { "key": "mode", "label": "Mode", "type": "select", "default": "simple", "options": [{ "value": "simple", "label": "Simple" }] }
  ]
}
```

- `id`: lowercase letters, digits and `_` (2 to 40 characters). It appears in URLs and in page content.
- Setting types: `text`, `password`, `number`, `boolean`, `select`. Passwords are encrypted (with
  `APP_SECRET`) and never sent back to the browser.
- Blocks declared here stay known to the editor even when the plugin is off: pages keep them and show a
  "plugin turned off" placeholder. So don't rename a block's `id` from one version to the next.

### Translations

Every text of the manifest (`name`, `description`, block `title`, `description` and `keywords`, setting `label`,
`help` and option `label`) can be a plain string or one string per language:

```json
{ "name": { "en": "My plugin", "fr": "Mon plugin" } }
```

Each user sees the texts in their language, or in English when theirs is missing. Block keywords of every language
are searched in the `/` menu. In code, `nootion.locale` (browser) and `nootion.locale()` (server, during a request)
give the user's language (`"en"`, `"fr"`…) to pick the plugin's own texts.

## Server side (`server.js`)

```js
export function activate(nootion) {
  // GET /api/plugins/my_plugin/hello/Ada: for signed-in users only
  nootion.route("GET", "/hello/:name", ({ params, user, query, body }) => ({ message: `Hello ${params.name}, from ${user.name}` }));

  // Reachable without signing in (public pages): { public: true }
  nootion.route("GET", "/status", () => ({ ok: true }), { public: true });

  // Error with an HTTP status, in the user's language
  nootion.route("POST", "/refused", () => {
    throw new nootion.HttpError(403, "refused", nootion.locale() === "fr" ? "Pas autorisé." : "Not allowed.");
  });

  // Scheduled task (at least 1 second), stopped when the plugin is turned off
  nootion.every(15 * 60 * 1000, async () => nootion.log.info("syncing…"));

  // Formula function, usable in Formula columns: withTax(prop("Price"))
  nootion.formulaFunction("withTax", { min: 1, max: 1, help: "withTax(amount): amount × 1.2", run: ([x]) => x * 1.2 });

  // Before showing a page to a user, check their access:
  // nootion.pages.role(user.id, pageId) returns null, "viewer", "commenter", "editor" or "full".

  // Return a function: it is called when the plugin stops.
  return () => {};
}
```

What `activate` receives:

| Field | Purpose |
|---|---|
| `id` | the plugin's id |
| `settings` | setting values (passwords decrypted). The plugin restarts when they change. |
| `dataDir` | the plugin's own folder: `/data/plugin-data/<id>` |
| `log.info / warn / error` | server log |
| `route(method, path, handler, { public })` | route served under `/api/plugins/<id>/…` |
| `every(ms, task)` | repeated task |
| `formulaFunction(name, { min, max, help, run })` | formula function computed on the server. `run` receives the already evaluated arguments (numbers, texts, booleans, lists, dates). |
| `pages.role(userId, pageId)` | a user's role on a page |
| `HttpError` | error with an HTTP status |
| `locale()` | language of the user being served (`"en"`, `"fr"`…) |

A plugin must never send a user data they couldn't see themselves.

## Browser side (`client.js`)

The browser code is loaded by every page, public pages included. It receives the application's React:
don't bundle another one. No build tool needed, `React.createElement` is enough.

```js
export function activate(nootion) {
  const { React } = nootion;
  const h = React.createElement;
  const label = nootion.locale === "fr" ? "Choisir un lieu" : "Choose a place";

  function Map({ data, setData, editable }) {
    if (!data.place) {
      return editable ? h("button", { onClick: () => setData({ place: "Lyon" }) }, label) : null;
    }
    return h("div", null, `📍 ${data.place}`);
  }

  nootion.registerBlock("map", Map);
}
```

- `data`: the block's data, stored in the page (and shared live with other editors).
  Keep there what readers need to see, so public pages render without calling the server.
- `setData(object)`: replaces the block's data.
- `editable`: false for viewers and on public pages.
- `nootion.api(path, { method, body })`: calls one of the plugin's routes (`/api/plugins/<id><path>`).
- `nootion.locale`: the interface language. The page reloads when the user changes it.

The application's Tailwind classes aren't available to plugins: use inline styles.
An element with the `nootion-hover-only` class only shows when the block is hovered (handy for edit buttons).
If the component crashes, only the block shows an error; the rest of the page keeps working.
