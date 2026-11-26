# Install with Docker

Nootion runs in **one container** (the API and the web interface), with no database server or Redis next to it.
The image is published for amd64 and arm64:

```text
ghcr.io/btronquo/nootion
```

| Tag | What it is |
| --- | --- |
| `latest` | The last release. |
| `4.3.0`, `4.3` | A precise version, or the last patch of a minor version: use one to choose when you update. |
| `develop` | The development version, to try what's coming. Not for data you care about. |

## With Docker Compose

This is the recommended way. In an empty folder:

```bash
curl -O https://raw.githubusercontent.com/btronquo/Nootion/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/btronquo/Nootion/main/.env.example
```

Then fill in `.env`:

```bash
# A random string of at least 16 characters, generated once and kept.
#   Linux, macOS:  openssl rand -hex 32
#   Windows (PowerShell):  -join ((1..32) | % { '{0:x2}' -f (Get-Random -Max 256) })
APP_SECRET=

# The address where you open Nootion, without a trailing /.
APP_URL=http://localhost:3000

TZ=Europe/Paris
```

And start it:

```bash
docker compose up -d
```

Open `APP_URL` in the browser to create the administrator account.

> **Keep `APP_SECRET`.** It encrypts the secrets stored in the database (single sign-on, e-mail, backups, plugin
> accounts) and signs sessions. Changing it later means typing those secrets again.

## With docker run

```bash
docker run -d --name nootion --restart unless-stopped \
  -p 3000:3000 \
  -e APP_URL=http://localhost:3000 \
  -e APP_SECRET=$(openssl rand -hex 32) \
  -e TZ=Europe/Paris \
  -v nootion-data:/data \
  ghcr.io/btronquo/nootion:latest
```

Note the generated `APP_SECRET` (`docker inspect nootion` shows it): the same one must be given again when the
container is recreated.

## Where the data lives

Everything is in the folder mounted on `/data`: the SQLite database (`nootion.db`), attached files, profile pictures
and plugins. **Backing up Nootion is backing up this folder.**

The compose file keeps it in a named Docker volume, `nootion-data`. To use a folder of the host instead, which is
easier to back up, replace the volume with a path:

```yaml
    volumes:
      - /path/to/nootion-data:/data
```

The container runs as UID 1000: give it the folder (`chown -R 1000:1000 /path/to/nootion-data`), or run it as the
folder's owner with `user: "UID:GID"`.

Administrators can also download a full backup, or set automatic backups to a folder or a WebDAV share such as
Nextcloud, from Administration. See [backups in the deployment reference](../../docs/DEPLOYMENT.md#deploying-nootion).

## On a NAS

Any NAS that runs Docker containers works, TrueNAS SCALE, Synology and Unraid included: create a dataset or a shared
folder for the data, give it to UID 1000 (or set `user:`), and install the compose file above through the NAS's
interface ("Install via YAML" on TrueNAS, "Project" in Synology's Container Manager).

## HTTPS and a domain name

To reach Nootion from outside, or to install it as an app on a phone, put it behind an HTTPS reverse proxy (Caddy,
Nginx Proxy Manager, Traefik, or a Tailscale or Cloudflare tunnel) and set `APP_URL` to the `https://…` address.
The proxy must let **WebSockets** through on `/collab`, used by real-time editing.
The [deployment reference](../../docs/DEPLOYMENT.md#securing-your-instance) gives examples for Caddy and Nginx.

## Updating

```bash
docker compose pull && docker compose up -d
```

Database migrations run by themselves at startup. Back up the data folder before a major update and read the
[changelog](../../CHANGELOG.md). Administrators see a notice in Administration when a new release is out.

## Going further

The [deployment reference](../../docs/DEPLOYMENT.md) covers every variable, security, attached files in S3-compatible
storage, single sign-on, passkeys, e-mail, imports and the activity log.
