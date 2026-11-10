# Deploying Nootion

Nootion runs in **a single container** (API + web interface), with no database server or Redis next to it.
All data lives in the folder mounted on `/data`:

| Path in `/data` | Content |
|---|---|
| `nootion.db` (+ `-wal`, `-shm` while the app runs) | The SQLite database: accounts, pages, databases, shares |
| `uploads/` | Files attached to pages and database rows (images, PDFs…). One file per attachment, named by its id. |
| `avatars/` | Profile pictures |
| `icons/` | Page icons uploaded by people |
| `vapid.json` | The keys that sign notifications sent to phones and computers (made at the first start) |
| `plugins/` | Plugins installed by hand (see [PLUGINS.md](PLUGINS.md)) |
| `plugin-data/` | Files kept by plugins |

**Backing up Nootion = backing up this folder**, with any backup tool, or with periodic snapshots if it sits on
ZFS or Btrfs. Markdown exports (pages) and CSV/JSON exports (databases) can be
downloaded from the interface; they give you your data in a readable format, they don't replace backups.
The admin can also download a full backup from **Administration › Backup** (a .zip to unzip into `/data`, with the container stopped, to restore).

**Automatic backups** (Administration › Automatic backups) make that same .zip every day or every week, at a set
time, and keep the last copies (`nootion-backup-YYYY-MM-DD-HHMM.zip`; other files in the folder are left alone).
They go to:

- a folder of the server: mount one in the container, for example a NAS share, with
  `-v /volume1/backups/nootion:/backups`, and type `/backups`;
- a WebDAV folder, such as a Nextcloud one: its WebDAV address (Files › Settings › WebDAV in Nextcloud, followed by
  the folder, e.g. `https://cloud.example.com/remote.php/dav/files/boris/Backups/Nootion`), a user name and an app
  password (stored encrypted with `APP_SECRET`).

"Back up now" tries the destination at once; the page shows the next run and how the last one went.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `APP_URL` | yes | Address typed in the browser, without a trailing `/` (e.g. `http://<yourLocalIp>:3000` or `https://mynootion.example.com`). Used for invitation links, iCal links and CSRF protection: always open Nootion at this address. |
| `APP_SECRET` | yes | Random string of at least 16 characters (`openssl rand -hex 32`). Generate it once and never change it: it encrypts the secrets kept in the database (plugin settings and accounts, the SSO client secret, the e-mail and backup passwords) and signs cookies. Changing it means typing those secrets again. With [`docker-compose.yml`](../docker-compose.yml), it is read from a `.env` file next to it (see [`.env.example`](../.env.example), which also gives the PowerShell command for Windows); Docker refuses to start without it, and the server refuses the examples of older versions of the file. |
| `TZ` | no | Time zone (e.g. `Europe/Paris`). |
| `PORT` | no | Port the server listens on inside the container (default `3000`). To change the port on the host, change `ports:` instead. |
| `MAX_UPLOAD_MB` | no | Maximum size of an attached file, in MB (default `50`). |
| `DEMO_PAGE` | no | `false` to stop giving new users a demo page on their first visit (default: given). |
| `UPDATE_CHECK` | no | `false` to stop looking for new releases (default: the server asks GitHub twice a day, sending nothing about your server, and tells administrators). |
| `OCR_LANGS` | no | Languages read in images and scanned PDFs, joined by `+` (default `fra+eng`). The image ships French and English; other languages need their `tesseract-ocr-<lang>` package. |
| `TRUST_PROXY` | no | Which reverse proxies are believed about the visitor's address (`X-Forwarded-For`, `X-Forwarded-Proto`). Default: proxies on the server itself or its private network (10.x, 172.16–31.x, 192.168.x, fc00::/7). `true` trusts any, `false` none, or give a list of addresses and ranges (`203.0.113.4, 198.51.100.0/24`). See [Securing your instance](#securing-your-instance). |
| `CONTENT_SECURITY_POLICY` | no | `off` to stop sending the Content-Security-Policy with the interface (only needed for a hand-installed plugin that loads scripts from another site). |
| `API_RATE_LIMIT` | no | Requests a personal API token can make per minute (default `300`). See [API.md](API.md). |

If Nootion sits behind an HTTPS reverse proxy, put the `https://…` URL in `APP_URL`: the session cookie then becomes `Secure`
(examples for Caddy and Nginx in [Securing your instance](#securing-your-instance)).
To connect Claude's connectors to Nootion, that address must be reachable from the internet (see [MCP.md](MCP.md)).
The proxy must let **WebSockets** through on `/collab` (real-time collaborative editing): in Nginx Proxy Manager, tick *Websockets Support*.
`/api/events` is a long-lived stream (server-sent events) that keeps the sidebar up to date when others add pages: Nootion asks Nginx not to buffer it; other proxies may need buffering turned off for it.
Also check its upload size limit (`client_max_body_size` in Nginx) for attached files.

## Installing with Docker

The image is published on GitHub's registry for amd64 and arm64: `ghcr.io/btronquo/nootion`.
Tags: `latest` (last release), `3.4.0`, `3.4` (last 3.4.x), and `develop` (development version, to try what's coming;
not for data you care about).

### With Docker Compose (recommended)

```bash
mkdir nootion && cd nootion
curl -O https://raw.githubusercontent.com/btronquo/Nootion/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/btronquo/Nootion/main/.env.example
# Set APP_SECRET (openssl rand -hex 32) and APP_URL in .env, then:
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
read the [CHANGELOG](../CHANGELOG.md). To stay on a version, use its tag (`ghcr.io/btronquo/nootion:2.0.1`)
instead of `latest`.

The version running shows at the bottom of the sidebar and of the Administration page. When a newer release is
out, administrators see a ⚠ next to "Administration" and a notice at the top of that page, which they can hide
until the next release.

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

## Securing your instance

Nootion is made to be reached from the internet, but a few choices are yours.

**Use HTTPS.** Put Nootion behind a reverse proxy that holds the certificate, and set `APP_URL` to the `https://…`
address: the session cookie then becomes `Secure` and browsers are told to stay on HTTPS (HSTS). With Caddy, the
whole configuration is:

```
notes.example.com {
    reverse_proxy nootion:3000
}
```

With Nginx (Nginx Proxy Manager does the same with *Websockets Support* ticked):

```nginx
server {
    listen 443 ssl;
    server_name notes.example.com;
    # ssl_certificate and ssl_certificate_key here
    client_max_body_size 50m;                  # MAX_UPLOAD_MB

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;   # /collab (live editing)
        proxy_set_header Connection "upgrade";
        proxy_buffering off;                      # /api/events
    }
}
```

**The visitor's address.** Sign-in attempts are limited per address (10 a minute) and per account (20 wrong
passwords in 15 minutes). Behind a proxy, the address comes from the `X-Forwarded-For` header, which Nootion only
believes from a proxy on the same machine or private network. If your proxy has a public address (another
server, a CDN), give it in `TRUST_PROXY`; if Nootion is reached directly, with no proxy, set `TRUST_PROXY=false`.
Have the proxy *replace* `X-Forwarded-For` (as above) rather than add to what the visitor sent.

**What is off by default**, and administrators can turn on:

| Setting | Where | Turn it on when |
|---|---|---|
| Webhooks to the local network | Administration › Security | Buttons must call a service at home or in the company (Home Assistant, n8n…). Anyone who can edit a page can then make the server call local addresses. |
| Previews of local network links | Administration › Plugins › Embeds | People paste links to local services and want their preview. |

And what is on by default and may be turned off: **Link existing accounts by their e-mail address** in the SSO
settings (see [SSO.md](SSO.md#linking-existing-accounts)).

**Who can do what.** Keep these in mind when you invite people:

- An **administrator** can read every backup, install plugins and change every setting: it is full control of the data.
- A **plugin** installed in `/data/plugins` runs with the server's rights (see [PLUGINS.md](PLUGINS.md#trust)).
- A **member** sees the pages of their spaces and those shared with them, and, in the people lists, only those they
  work with. They can create shared spaces, API tokens for their own spaces, and public links to pages they can edit.
- A **public link** shows a page (and its subpages if chosen) read-only to anyone who has the address; a **public
  form** lets them add rows. Both are revoked from where they were made.
- The step of a **button** runs with the rights of the person who clicks it, not of who wrote it: look at what a
  button does before clicking one in a page someone else edits.

Browsers get a Content-Security-Policy with the interface: only scripts served by Nootion run, and Nootion can't be
shown inside another site (public pages and forms can). Attached files that a browser could run (HTML, SVG) are
always downloaded, never displayed.

To report a vulnerability, see [SECURITY.md](../SECURITY.md).

## Single sign-on (SSO)

People can sign in with their company account (Microsoft Entra ID, Google Workspace, Okta, Keycloak… any OpenID
Connect provider), set in **Administration > Single sign-on (SSO)**, and SCIM lets the provider disable those who
leave. The server must reach the provider over HTTPS. See [SSO.md](SSO.md) for the steps in Entra ID.

## Sending e-mail

Nootion sends nothing by e-mail until an administrator sets it up in **Administration > E-mail**:

- **SMTP**: any mail server or service (your host's, Gmail with an app password, Brevo, Mailgun, Amazon SES…).
  Usually port 587 with STARTTLS, or 465 with SSL/TLS.
- **Resend**: an API key with the right to send, and the sender's domain verified in Resend.

"Send a test e-mail" checks the settings. The password or key is stored encrypted with `APP_SECRET`. Once set up,
reminders, mentions and replies are also e-mailed (each user can turn them off in My account), invitations with an
address are sent to it, and the sign-in page offers "Forgot your password?".

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
