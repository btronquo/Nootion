# Deploying Nootion

Nootion runs in **a single container** (API + web interface), with no database server or Redis next to it.
All data lives in the folder mounted on `/data`:

| Path in `/data` | Content |
|---|---|
| `nootion.db` (+ `-wal`, `-shm` while the app runs) | The SQLite database: accounts, pages, databases, shares |
| `uploads/` | Files attached to pages and database rows (images, PDFs…). One file per attachment, named by its id. |
| `avatars/` | Profile pictures |
| `plugins/` | Plugins installed by hand (see [PLUGINS.md](PLUGINS.md)) |
| `plugin-data/` | Files kept by plugins |

**Backing up Nootion = backing up this folder**, with any backup tool, or with periodic snapshots if it sits on
ZFS or Btrfs. Markdown exports (pages) and CSV/JSON exports (databases) can be
downloaded from the interface; they give you your data in a readable format, they don't replace backups.
The admin can also download a full backup from **Administration › Backup** (a .zip to unzip into `/data`, with the container stopped, to restore).

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `APP_URL` | yes | Address typed in the browser, without a trailing `/` (e.g. `http://<yourLocalIp>:3000` or `https://mynootion.example.com`). Used for invitation links, iCal links and CSRF protection: always open Nootion at this address. |
| `APP_SECRET` | yes | Random string of at least 16 characters (`openssl rand -hex 32`). Generate it once and never change it: it encrypts the passwords stored in plugin settings. |
| `TZ` | no | Time zone (e.g. `Europe/Paris`). |
| `PORT` | no | Port the server listens on inside the container (default `3000`). To change the port on the host, change `ports:` instead. |
| `MAX_UPLOAD_MB` | no | Maximum size of an attached file, in MB (default `50`). |
| `OCR_LANGS` | no | Languages read in images and scanned PDFs, joined by `+` (default `fra+eng`). The image ships French and English; other languages need their `tesseract-ocr-<lang>` package. |
| `API_RATE_LIMIT` | no | Requests a personal API token can make per minute (default `300`). See [API.md](API.md). |

If Nootion sits behind an HTTPS reverse proxy, put the `https://…` URL in `APP_URL`: the session cookie then becomes `Secure`.
To connect Claude's connectors to Nootion, that address must be reachable from the internet (see [MCP.md](MCP.md)).
The proxy must let **WebSockets** through on `/collab` (real-time collaborative editing): in Nginx Proxy Manager, tick *Websockets Support*.
Also check its upload size limit (`client_max_body_size` in Nginx) for attached files.

## Installing with Docker

The image is published on GitHub's registry for amd64 and arm64: `ghcr.io/btronquo/nootion`.
Tags: `latest` (last release), `1.2.0`, `1.2` (last 1.2.x), and `develop` (development version, to try what's coming;
not for data you care about).

### With Docker Compose (recommended)

```bash
mkdir nootion && cd nootion
curl -O https://raw.githubusercontent.com/btronquo/Nootion/main/docker-compose.yml
# Edit APP_URL and APP_SECRET in docker-compose.yml (openssl rand -hex 32 gives a good secret), then:
docker compose up -d
```

Open `APP_URL` in the browser: the page that creates the administrator account shows up, with a choice of language.

[`docker-compose.yml`](../docker-compose.yml) keeps the data in a named Docker volume, `nootion-data`.
To keep it in a folder of the host instead (easier to back up), replace the volume with
`- /path/to/nootion-data:/data`. The container runs as UID 1000: give it the folder (`chown -R 1000:1000 /path/to/nootion-data`),
or run it as the folder's owner with `user: "UID:GID"`. Otherwise it stops at startup with a message explaining why.

### With docker run

```bash
docker run -d --name nootion --restart unless-stopped \
  -p 3000:3000 \
  -e APP_URL=http://localhost:3000 \
  -e APP_SECRET=$(openssl rand -hex 32) \
  -e TZ=Europe/Paris \
  -v nootion-data:/data \
  ghcr.io/btronquo/nootion:latest
```

Keep the generated `APP_SECRET` (`docker inspect nootion` shows it): the same one must be given again when the
container is recreated.

### Updating

```bash
docker compose pull && docker compose up -d
```

Database migrations are applied automatically at startup. Back up the data folder before a major update, and
read the [CHANGELOG](../CHANGELOG.md). To stay on a version, use its tag (`ghcr.io/btronquo/nootion:1.2.0`)
instead of `latest`.

### Building the image from the source code

```bash
git clone https://github.com/btronquo/Nootion.git nootion && cd nootion
```

Then build and start it with the `docker-compose.build.yml` overlay (a plain `docker compose up --build` keeps
using the published image):

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

To update: `git pull`, then the same command. To try the `develop` branch, `git checkout develop` first.

## Installing the app on a phone or computer

Nootion is a web app that can be installed (PWA): it then opens in its own window, with its icon on the home screen.
Browsers only offer this over **HTTPS** (or on `localhost`), so put Nootion behind an HTTPS reverse proxy first
(Nginx Proxy Manager, Caddy, Traefik, or a Tailscale / Cloudflare tunnel) and set `APP_URL` to the `https://…` address.

- **Android (Chrome, Edge, Samsung Internet)**: open Nootion, then menu › *Install app* (or *Add to home screen*).
- **iPhone / iPad (Safari)**: Share button › *Add to Home Screen*.
- **Computer (Chrome, Edge)**: the install icon at the right of the address bar.

On a phone the sidebar opens from the ☰ button, a toolbar above the keyboard gives the "/" menu, formatting,
lists, indentation and moving blocks, and database tables show as cards (tap one to edit the row).
A new version of Nootion reaches installed apps the next time they open.

### Offline

Pages and databases already opened on a device stay available without network, in the installed app or in the browser
(the service worker needs HTTPS here too, except on `localhost`):

- **Page content** is kept on the device and can be edited offline. When the connection comes back it is merged with
  the changes others made meanwhile, with no conflict (the editor is built on Yjs).
- **Database cells, page titles and icons** changed offline wait in a queue and are sent in order when the connection
  comes back. If someone changed the same cell meanwhile, the last change sent wins.
- Creating or deleting pages and rows, and changing columns, views or sharing need the connection.
- A badge shows when the app is offline, how many changes are waiting, and the changes the server refused
  (for example a row deleted meanwhile).
- Signing out removes everything kept on the device for that account.

### Notifications

Reminders set on dates in pages ("@remind tomorrow 9am") show as notifications. While Nootion is open, the app shows
them itself. To receive them with the app closed, open **Reminders** in the sidebar on each device and choose *Get
notifications on this device*. This uses Web Push, which also needs **HTTPS**; on iPhone and iPad, Nootion must first
be added to the home screen (iOS 16.4 or later). The server makes its push keys on first use and keeps them in
`/data/vapid.json` (part of the backup): if that file is lost, each device has to turn notifications on again.
The server must be able to reach the browsers' push services (Google, Mozilla, Apple) over HTTPS.

## Importing from Notion

*My account › Import › Import from Notion* copies a Notion workspace into a Nootion space
(the personal space or a shared space you can edit). It reads Notion through its API, so the server needs
internet access to `api.notion.com` and to Notion's file storage.

1. In Notion, open *Settings › Connections › Develop or manage integrations* and create an **internal** integration.
   In its capabilities, allow reading content and reading user information **with email addresses**.
2. On each top-level page to import, open the **•••** menu › *Connections* and add the integration: its subpages
   and databases follow.
3. Copy the integration's secret, paste it on the import screen and start the import. It runs on the server:
   the screen can be closed meanwhile.

What is imported:

- the page tree, emoji icons and page content: text formatting, headings, lists, to-dos, quotes, callouts, code,
  tables, dividers, images and files (copied to Nootion), bookmarks, mentions and links between pages;
- databases (inline or full page) with their columns, select and status options, number formats, rows and the content
  of rows, people (matched to Nootion accounts by email), two-way relations, rollups and formulas, translated to
  Nootion's formula language.

What is not, or differently:

- Notion's API doesn't give the views: each database gets a table view.
- Formulas using what Nootion's formulas don't have (lists, `map`, `let`…) keep their values in a text column.
- Comments, image icons and page history are left out. Toggles, columns and covers are kept.

The report at the end lists these cases. **Importing again** uses the saved secret: pages and rows changed in Notion
since the last import are updated (their content is replaced, edits made in Nootion included), the others are left
as they are, and nothing is duplicated. *Forget the secret* removes it from the server; what was imported stays.

Notion allows about three requests per second, so a large workspace takes a few minutes.

## Publishing a new version of the image

Branches follow git flow (see [CONTRIBUTING.md](../CONTRIBUTING.md#branches-and-releases)).
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs the tests on every pull request and on pushes to
`main` and `develop`, and publishes the image to GitHub's registry as `ghcr.io/btronquo/nootion` (no setup needed:
it uses the token provided by GitHub Actions):

- on every push to `develop`: tags `develop` and `develop-<commit>`;
- on every git tag `vX.Y.Z` (put on `main` when a release is merged): tags `X.Y.Z`, `X.Y` and `latest`.

On GitHub, the first published image is private: *Packages > nootion > Package settings > Change visibility > Public*.
For each version, also create the release (*Releases > Draft a new release*) with the version's CHANGELOG section.

To try the image locally before publishing: `docker build -f docker/Dockerfile -t nootion:local .`
