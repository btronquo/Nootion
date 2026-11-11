# The desktop app

Nootion for Windows, macOS and Linux, in `apps/desktop`. It is a [Tauri 2](https://tauri.app) app: a small native
program in Rust that shows the system's own web view (WebView2 on Windows, WebKit on macOS and Linux), so an
installer weighs a few megabytes.

- [What it does today](#what-it-does-today)
- [How it works](#how-it-works)
- [Running it from the code](#running-it-from-the-code)
- [Building the installers](#building-the-installers)
- [Signing](#signing)
- [What comes next](#what-comes-next)

## What it does today

- **Connect to a server.** The first window asks for the address of a Nootion server (`notes.example.org`,
  `http://192.168.1.20:3000`). The app checks that a Nootion server answers there (`/api/health`) before saving it.
  Without `https://` or `http://`, it tries HTTPS first, then HTTP; a server without HTTPS outside this computer gets
  a warning before connecting.
- **On this computer.** *Open* under "On this computer" starts Nootion on the computer itself, with no server and no
  connection needed, and signs in at once (no account to create, no password). It is the same Nootion as on a server,
  run in the background by the app; quitting the app stops it.
- **Sync with a server.** On this computer, *Sync* (bottom of the sidebar) links spaces of a Nootion server: type its
  address, sign in there and pick the spaces. They come to the computer, work without a connection, and changes made
  on either side are merged every few seconds when the server can be reached, attached files and comments included.
  Who has access to a space is still managed on the server.
- **Several servers.** Each one is kept with a name; *Nootion > Switch server…* (Ctrl/Cmd+Shift+O) goes back to the
  list. The last server opens by itself at start.
- **Like the browser, in its own window.** The interface is the server's own web app: sign-in (password, SSO, 2FA),
  updates of the server and the offline mode work as in a browser. Sessions are kept between launches.
- **Native touches.** Menus in French or English (from the system's language), copy and paste shortcuts on macOS,
  zoom (Ctrl/Cmd + = / - / 0), reload, one window only (launching again brings it to the front), size and position
  remembered, links that open a new tab go to the default browser.

## How it works

```
apps/desktop/
  launcher/           The server picker: plain HTML, CSS and JavaScript, no build step.
  src-tauri/
    src/lib.rs        The window, the commands the picker calls, links to the browser.
    src/profiles.rs   The saved servers (profiles.json in the app's config folder).
    src/probe.rs      Checking an address before saving it.
    src/menu.rs       The menu bar.
    capabilities/     What the picker may call.
    tauri.conf.json   Name, identifier, icons, installers. The version is read from apps/desktop/package.json.
```

The window first shows `launcher/`, then loads the chosen server's address.

**On this computer**, the app runs Nootion's own server (`apps/server`) with a Node binary it ships, in the
background (`src/local.rs`):

- It listens on `127.0.0.1` only, on a port chosen at the first launch and kept: the web app's session and offline
  data belong to that address.
- Its data (database and files) lives in `local/data` in the app's data folder (`%APPDATA%\app.nootion.desktop`,
  `~/Library/Application Support/app.nootion.desktop`, `~/.local/share/app.nootion.desktop`), next to its log
  (`local/server.log`) and its settings (`local/settings.json`: the port, and the `APP_SECRET` drawn at the first
  launch).
- Signing in needs no password: at each launch the app gives the server a random token (`NOOTION_DESKTOP_TOKEN`),
  asks it for a one-time ticket with that token, then opens `/api/desktop/session?ticket=…`, which signs in to the
  computer's account (created at the first launch). See `apps/server/src/routes/desktop.ts`. The token never reaches
  the web view; a server started without it has none of these routes.
- Quitting asks the server to close its database (`/api/desktop/quit`); if the app crashes, the server notices that
  its parent is gone and stops within 5 seconds.

### Sync

Any Nootion records, in `sync_changes`, every change made to the pages, database columns, views, attached files,
comment threads and comments of a space (SQLite triggers, `migrations/0034_sync.sql` and `0035_sync_comments.sql`),
with the time of each field and each cell; what existed before is recorded once by the migration. Two routes give and take
them, for the members of the space: `GET /api/sync/:space/changes?since=…` and `POST /api/sync/:space/push`
(`apps/server/src/routes/sync.ts`). Merging (`apps/server/src/sync.ts`) keeps the latest change of each field or cell,
and merges the text of pages as the live editor does (Yjs), so that two people writing in the same page both keep
what they wrote. A change is never sent back to where it came from. Files are uploaded before the push that adds
them (`PUT /api/sync/:space/attachments/:id`) and downloaded from `/api/attachments/:id`. A push can only add, change
or delete the pusher's own comments.

The people named by the changes come with them: the computer gets a disabled account, which can't sign in, for each
author it doesn't know, and the account the space was linked with on the server is taken as the computer's own.

The computer's Nootion links a space through the server's OAuth, as Claude's connectors do
(`apps/server/src/desktop-sync.ts`): it registers as an app, opens the server's consent page, and gets back a token
limited to the spaces picked there (stored encrypted with `APP_SECRET`). The space is created on the computer with the
same id, then synced every 20 seconds, and 4 seconds after a change made on the computer. *Stop syncing* forgets the
token on both sides and keeps the space, as it is, on the computer.

`scripts/prepare-local-server.mjs` gathers what is shipped, before each build: the server with its production
dependencies and the web app in `local-server/`, and Node (checked against its published checksum) in
`src-tauri/binaries/`. It runs by itself before `tauri build` and `tauri dev`. **Pages from a server get no access to the
app**: Tauri only lets the built-in picker call the app's commands (`capabilities/default.json` lists local pages
only), and a page from a server that tries is refused. A Nootion server, or a page pretending to be one, can't read
the list of servers or open anything on the computer.

Saved servers live in `profiles.json`, in `%APPDATA%\app.nootion.desktop` (Windows),
`~/Library/Application Support/app.nootion.desktop` (macOS) or `~/.config/app.nootion.desktop` (Linux). No password
is stored there: the session is the web view's cookie, as in a browser.

## Running it from the code

Rust (stable, 1.90 or newer) and, on Linux, the WebKitGTK libraries:

```sh
# Debian, Ubuntu
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev
```

Windows needs WebView2 (already there on Windows 10 and 11) and the Visual Studio C++ build tools; macOS needs the
Xcode command line tools. See [Tauri's prerequisites](https://tauri.app/start/prerequisites/).

```sh
pnpm install
pnpm --filter @nootion/desktop desktop:dev     # the app, with a server to connect to (pnpm dev runs one on :5173)
cd apps/desktop/src-tauri && cargo test        # tests of the Rust side
```

## Building the installers

`pnpm --filter @nootion/desktop desktop:build` builds the installers of the current system in
`apps/desktop/src-tauri/target/release/bundle/`.

For the three systems at once, push a tag: the [Desktop workflow](../.github/workflows/desktop.yml) builds them on
GitHub Actions. The tag of a Nootion release (`v3.5.0`) attaches them to that release on GitHub, created as a draft
if it doesn't exist yet. A `desktop-v…` tag builds them for a test, in a separate draft pre-release.

```sh
git tag desktop-v3.5.0-test && git push github desktop-v3.5.0-test
```

| System  | Files                                    |
| ------- | ---------------------------------------- |
| Windows | `.exe` (installs for the user), `.msi`   |
| macOS   | `.dmg`, one for Apple chips, one for Intel |
| Linux   | `.AppImage`, `.deb`, `.rpm`              |

"Run workflow" on the Actions tab builds them too, without a release: they are kept as the run's artifacts. On a
public repository, GitHub Actions runners (macOS included) cost nothing.

## Signing

The installers are not signed yet. Until they are, Windows shows a SmartScreen warning ("More info > Run anyway")
and macOS refuses to open the app at first: right-click > Open, or System Settings > Privacy & Security > Open Anyway.

- **macOS**: an Apple Developer account (99 USD a year), a "Developer ID Application" certificate, and the secrets
  listed in the workflow (`APPLE_CERTIFICATE`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`,
  `APPLE_TEAM_ID`…). The workflow then signs and notarizes the app.
- **Windows**: a code signing certificate. [SignPath](https://signpath.org) signs open source projects for free;
  otherwise, a certificate from a certificate authority or Azure Trusted Signing.

## What comes next

See the plan: system notifications for reminders, a global shortcut for quick capture and automatic
updates.
