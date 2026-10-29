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
| `APP_URL` | yes | Address typed in the browser, without a trailing `/` (e.g. `http://192.168.1.10:3000` or `https://notes.example.com`). Used for invitation links and CSRF protection: always open Nootion at this address. |
| `APP_SECRET` | yes | Random string of at least 16 characters (`openssl rand -hex 32`). Generate it once and never change it: it encrypts the passwords stored in plugin settings. |
| `TZ` | no | Time zone (e.g. `Europe/Paris`). |
| `PORT` | no | Port the server listens on inside the container (default `3000`). To change the port on the host, change `ports:` instead. |
| `MAX_UPLOAD_MB` | no | Maximum size of an attached file, in MB (default `50`). |

If Nootion sits behind an HTTPS reverse proxy, put the `https://…` URL in `APP_URL`: the session cookie then becomes `Secure`.
The proxy must let **WebSockets** through on `/collab` (real-time collaborative editing): in Nginx Proxy Manager, tick *Websockets Support*.
Also check its upload size limit (`client_max_body_size` in Nginx) for attached files.

## Running with Docker Compose

A prebuilt image will be published with the first public release; until then, the image is built from the source code.

```bash
git clone https://github.com/btronquo/Nootion.git nootion
cd nootion
# Edit APP_URL and APP_SECRET in docker-compose.yml, then:
docker compose up -d --build
```

Open `APP_URL` in the browser: the page that creates the administrator account shows up, with a choice of language.

The repository's [`docker-compose.yml`](../docker-compose.yml) keeps the data in a named Docker volume,
`nootion-data`. To keep it in a folder of the host instead (easier to back up), replace the volume with
`- /path/to/nootion-data:/data`. The container runs as UID 1000: give it the folder (`chown -R 1000:1000 /path/to/nootion-data`),
or run it as the folder's owner with `user: "UID:GID"`. Otherwise it stops at startup with a message explaining why.

**Updating**: get the new code (`git pull`), then `docker compose up -d --build`. Database migrations are applied
automatically at startup. Back up the data folder before a major update.

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
- Toggles are shown open, columns are put one under the other, comments, covers, image icons and page history are left out.

The report at the end lists these cases. **Importing again** uses the saved secret: pages and rows changed in Notion
since the last import are updated (their content is replaced, edits made in Nootion included), the others are left
as they are, and nothing is duplicated. *Forget the secret* removes it from the server; what was imported stays.

Notion allows about three requests per second, so a large workspace takes a few minutes.

## Publishing a new version of the image

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) publishes the image to GitHub's registry as `ghcr.io/btronquo/nootion` (no setup
needed: it uses the token provided by GitHub Actions); [`.gitlab-ci.yml`](../.gitlab-ci.yml) does the same on GitLab. They run the tests, then build and publish the image:

- on every push to the default branch: tags `main` and `main-<commit>` (to try the latest development version);
- on every git tag `vX.Y.Z`: tags `X.Y.Z`, `X.Y` (GitHub only) and `latest`.

```bash
git tag v1.0.0
git push origin v1.0.0
```

On GitHub, the first published image is private: *Packages > nootion > Package settings > Change visibility > Public*.
Also remember to update [CHANGELOG.md](../CHANGELOG.md) and to create the release (*Releases > Draft a new release*, tag `v1.0.0`).

To try the image locally before publishing: `docker build -f docker/Dockerfile -t nootion:local .`
