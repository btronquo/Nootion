# Install the desktop app

The desktop app runs on Windows, macOS and Linux. It connects to one or more Nootion servers, or keeps a space on the
computer with no server at all. Spaces of a server can be synced to the computer to work on them without a
connection; changes from both sides are merged.

## Download

The installers are attached to each [release on GitHub](https://github.com/btronquo/Nootion/releases/latest), and
the [download section of the home page](../../#download) picks the right one for your system.

| System | Files | Requires |
| --- | --- | --- |
| Windows | `…_x64-setup.exe` (installs for the current user, no administrator rights needed), `.msi` | Windows 10 or 11, 64-bit |
| macOS | `…_aarch64.dmg` for Apple chips (M1 and later), `…_x64.dmg` for Intel | macOS 11 or later |
| Linux | `.AppImage` (any distribution), `.deb` (Debian, Ubuntu), `.rpm` (Fedora, openSUSE) | 64-bit |

## Install

### Windows

Run the `.exe` and follow the steps. If Windows shows "Windows protected your PC", click **More info**, then
**Run anyway**. The `.msi` package is meant for deployment tools.

### macOS

Open the `.dmg` and drag Nootion into Applications. If macOS says that the app can't be opened the first time,
right-click it and choose **Open**, or allow it in **System Settings › Privacy & Security › Open Anyway**.

### Linux

- **AppImage**: make it executable (`chmod +x Nootion_*.AppImage`), then run it.
- **Debian, Ubuntu**: `sudo apt install ./Nootion_*_amd64.deb`
- **Fedora, openSUSE**: `sudo dnf install ./Nootion-*.x86_64.rpm`

## First launch

The first window offers two choices:

- **Connect to a server**: type its address (`notes.example.org`, `http://192.168.1.20:3000`). The app checks that a
  Nootion server answers there before saving it, then shows the usual sign-in page. Several servers can be kept;
  **Nootion › Switch server…** (Ctrl/Cmd+Shift+O) goes back to the list.
- **On this computer**: Nootion starts on the computer itself, with no server and no account to create.

On this computer, **Sync** at the bottom of the sidebar links spaces of a server: sign in there, pick the spaces, and
they come to the computer, attached files and comments included.

## Updating

Download the new version from the releases and install it over the old one: your servers, spaces and settings are
kept.

## More

[How the desktop app works](../../docs/DESKTOP.md) explains the sync, building the installers from the code and signing.
