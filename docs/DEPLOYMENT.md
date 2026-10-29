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

**Backing up Nootion = backing up this folder.** On TrueNAS, a periodic ZFS snapshot of the dataset is enough
(*Data Protection > Periodic Snapshot Tasks*). Markdown exports (pages) and CSV/JSON exports (databases) can be
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

## TrueNAS SCALE (24.10 "Electric Eel" and later)

### 1. Prepare the data dataset

1. *Datasets*: create `tank/apps/nootion` (replace `tank` with your pool name), preset **Apps**.
2. Give it to the `apps` user (UID/GID 568): *Datasets > nootion > Edit Permissions*, or in a shell
   `chown -R 568:568 /mnt/tank/apps/nootion`.
   Otherwise the container stops at startup with a message explaining why (visible in the app's logs).

### 2a. Install with the published image (recommended)

The image is built automatically by CI and published for amd64 and arm64:

- on GitHub: `ghcr.io/<github-user>/nootion` (public once the repository is);
- on GitLab: `registry.gitlab.com/btronquoy/nootion`.

The examples below use the GitLab address; replace it with the GitHub one if you prefer.

1. *Apps > Discover Apps > ⋮ > Install via YAML*, name `nootion`.
2. Paste the content of [`deploy/truenas.yaml`](../deploy/truenas.yaml) and replace the three values marked `<--`
   (`APP_URL`, `APP_SECRET`, dataset path).
3. Save, wait for the app to be *Running*, then open `APP_URL`: the page that creates the administrator account shows up,
   with a choice of language.

> While the GitLab project is **private**, its image registry is private too and TrueNAS can't download the image
> without credentials. Two ways out: make the project public (planned, AGPL license), or use method 2b.

**Updating**: *Apps > nootion > Edit > Save* (with `pull_policy: always`, the `latest` image is downloaded again).
Database migrations are applied automatically at startup. Take a snapshot of the dataset before a major update.
To pin a version, replace `latest` with a version number (e.g. `registry.gitlab.com/btronquoy/nootion:1.0.0`).

### 2b. Build the image on the NAS from the source code

1. Create a second dataset `tank/apps/nootion-src` and copy the repository into it (SMB share or `git clone`), without the `node_modules` folders.
2. *Apps > Discover Apps > ⋮ > Install via YAML*, name `nootion`, and paste:

```yaml
services:
  nootion:
    image: nootion:local
    build:
      context: /mnt/tank/apps/nootion-src
      dockerfile: docker/Dockerfile
    container_name: nootion
    restart: unless-stopped
    user: "568:568"
    ports:
      - "3000:3000"
    environment:
      APP_URL: "http://NAS-IP:3000"
      APP_SECRET: "paste-a-long-random-string-here"
      TZ: "Europe/Paris"
    volumes:
      - /mnt/tank/apps/nootion:/data
```

Updating: copy the new code into `nootion-src`, then *Apps > nootion > Edit > Save* (rebuild).

## Plain Docker (PC, other NAS)

```bash
docker compose up -d --build
```

The repository's [`docker-compose.yml`](../docker-compose.yml) builds the image from source and keeps the data
in a named Docker volume, `nootion-data`. To use the published image instead, replace `build:` with
`image: registry.gitlab.com/btronquoy/nootion:latest`.

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

## Publishing a new version of the image

Two pipelines do the same job, each on its own registry: [`.gitlab-ci.yml`](../.gitlab-ci.yml) for GitLab and
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) for GitHub (ghcr.io, no setup needed: it uses the token
provided by GitHub Actions). They run the tests, then build and publish the image:

- on every push to the default branch: tags `main` and `main-<commit>` (to try the latest development version);
- on every git tag `vX.Y.Z`: tags `X.Y.Z` and `latest` (and `X.Y` on GitHub).

```bash
git tag v1.0.0
git push origin v1.0.0
```

On GitHub, the first published image is private: *Packages > nootion > Package settings > Change visibility > Public*.
Also remember to update [CHANGELOG.md](../CHANGELOG.md) and to create the release (*Releases > Draft a new release*, tag `v1.0.0`).

To try the image locally before publishing: `docker build -f docker/Dockerfile -t nootion:local .`
