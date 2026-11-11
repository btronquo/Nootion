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

The window first shows `launcher/`, then loads the chosen server's address. **Pages from a server get no access to the
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
GitHub Actions and attaches them to a draft release.

```sh
git tag desktop-v3.4.0 && git push github desktop-v3.4.0
```

| System  | Files                                    |
| ------- | ---------------------------------------- |
| Windows | `.exe` (installs for the user), `.msi`   |
| macOS   | `.dmg`, one app for Intel and Apple chips |
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

See the plan: a local mode (a Nootion space on the computer, no server needed), then continuous sync between that
local space and a server, then system notifications for reminders, a global shortcut for quick capture and automatic
updates.
