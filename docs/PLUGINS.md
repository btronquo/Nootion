# Writing a Nootion plugin

A plugin adds editor **blocks** (`/` command), **database column types**, **API routes**, **scheduled tasks** and
**formula functions** to Nootion. The administrator turns it on and off and fills in its settings in **Administration › Plugins**.

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
  "propertyTypes": [
    { "id": "stars", "name": "Rating", "description": "One to five stars", "icon": "⭐" }
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
| `userSecrets.get / set / delete(userId, value)` | data kept for one user (an account on another service, a token…), any JSON, stored encrypted with `APP_SECRET` and deleted with the user |
| `attachments.create({ userId, pageId, filename, mimeType, data })` | attaches a file to a page as if the user had uploaded it: they must be able to edit the page, and `MAX_UPLOAD_MB` applies. `data` is a Buffer or a stream (e.g. a `fetch` response's `body`). Returns `{ id, filename, mimeType, size, url }`. |
| `request(userId, method, path, body)` | calls Nootion's API (`/databases/…`, `/pages/…`, see [API.md](API.md)) as a user, with their rights, as if they had made the request. Resolves with the JSON answer, throws an `HttpError` on an error. |
| `connectedAccount({ describe, disconnect })` | lists the user's account on another service in **My account › Connected services**: `describe(userId)` returns what to show ("ada@gmail.com") or null when not connected, `disconnect(userId)` forgets and revokes it. |
| `redirect(url)` | return it from a route to send the browser elsewhere (a sign-in page of another service…) |
| `appUrl` | Nootion's address (`APP_URL`), e.g. to build an OAuth redirect address |
| `binary(data, contentType)` | return it from a route to send a file instead of JSON. PNG, JPEG, GIF, WebP and AVIF images are shown in the browser; anything else is downloaded. |

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

### Database column types

A column type declared in `propertyTypes` is offered with the others when adding a column to a database. Its cells
keep a **text** (up to 20,000 characters): the plugin decides what it holds (a number, a code, JSON…) and how it
looks and is edited. Nootion filters, sorts, groups, searches and exports it as a text, so pick a text that reads
well in a CSV.

```js
nootion.registerPropertyType("stars", {
  // value: the text, or null when empty. setValue(text or null) saves it. editable: false for readers.
  // variant: "table" (a compact, one-line cell) or "panel" (an opened row's properties, a card).
  Cell: ({ value, setValue, editable, variant }) => h(Stars, { value, setValue, editable }),
});
```

The component handles clicks and typing itself (stop the click's propagation if it opens something). When the plugin
is off, its columns stay and their cells show and edit the plain text. The **Ratings** plugin that ships with Nootion
is a small example: [`apps/server/plugins/rating`](../apps/server/plugins/rating).

### Other places to pick files from

A plugin can offer files from somewhere else (a cloud drive…). They are offered as a `/` command and as
"From …" under "Add a file" in "File" columns:

```js
nootion.registerFileSource({
  label: "My drive",
  icon: "🗂️",
  keywords: "drive cloud",
  // Let the user choose, attach copies to the page (with attachments.create on the server), and resolve with
  // what that returned: [{ id, filename, mimeType, size, url }]. Resolve with nothing when they cancel.
  pick: ({ pageId, multiple }) => nootion.ui.showDialog((close) => h(MyPicker, { pageId, multiple, close })),
});
```

### The app's interface

`nootion.ui` gives a few pieces of Nootion's interface, so that a plugin looks like the rest of the app (light and
dark themes included):

- `ui.showDialog((close) => element)`: draws `element` above the page, outside its content, until `close(value)` is
  called; returns a promise of that value.
- `ui.Modal`: a dialog box, `{ title, onClose, wide, children }`.
- `ui.Button`: a button, `{ variant: "primary" | "ghost" | "danger", ...button props }`.

The **Nextcloud** plugin uses all of these: [`apps/server/plugins/nextcloud`](../apps/server/plugins/nextcloud).
