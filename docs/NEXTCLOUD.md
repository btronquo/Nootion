# Nextcloud

The **Nextcloud** plugin ships with Nootion. It lets each person pick files in their own Nextcloud and:

- insert a **copy** in a page (`/nextcloud`): images show inline, other files as a file block;
- add a copy to a **"File" column** of a database ("From Nextcloud" under "Add a file");
- insert a **link** to a file or folder (`/nextcloud link`, `/nextcloud lien` in French): a card that opens it in
  Nextcloud, for people who have access to it there.

Copies live in Nootion like uploaded files: they show on public links, are searched, exported and backed up with
the rest, and don't change when the file changes in Nextcloud. Links stay in Nextcloud and follow its sharing rules.

## Setting it up (administrator)

1. **Administration › Plugins › Nextcloud**: turn it on.
2. **Nextcloud address**: the address Nootion's server uses to reach Nextcloud, e.g. `https://cloud.example.org`
   or `http://192.168.1.20:8080`.
3. **Address in the browser**: only if people open Nextcloud at another address than the server does, e.g. the
   server reaches it at `http://nextcloud` on a Docker network while people use `https://cloud.example.org`. Links
   and the login page then use this one.

No app has to be installed in Nextcloud, and no client id or secret is needed.

## Connecting an account (everyone)

The first time someone opens the picker, Nootion asks them to connect their account:

- **Connect to Nextcloud** opens Nextcloud's own login page in a new tab ("Login Flow v2"). After logging in and
  allowing access, Nextcloud gives Nootion an **app password**, and the picker shows the files.
- Or **Use an app password instead**: a login and an app password created in Nextcloud
  (**Settings › Security › Devices & sessions**). Handy when Nextcloud's login page can't be opened.

Each person connects their own account: Nootion only shows them what their Nextcloud account can see, never
someone else's files. The app password is stored encrypted (with `APP_SECRET`). **Disconnect**, at the bottom
of the picker, removes it from Nootion and revokes it in Nextcloud. Changing the Nextcloud address in the
administration disconnects every account.

## What Nootion asks Nextcloud

All requests go from Nootion's server to Nextcloud, with the person's app password:

| Request | Use |
|---|---|
| `POST /index.php/login/v2` and its poll address | connecting an account |
| `GET /ocs/v1.php/cloud/user` | the account's id and name |
| `PROPFIND /remote.php/dav/files/<user>/<folder>` | a folder's files |
| `SEARCH /remote.php/dav/` | search by name |
| `GET /index.php/core/preview` | thumbnails |
| `GET /remote.php/dav/files/<user>/<file>` | copying a file (at most `MAX_UPLOAD_MB`, 20 files at a time) |
| `DELETE /ocs/v2.php/core/apppassword` | disconnecting |
