#!/bin/sh
# Checks that the data volume is writable before starting Nootion,
# to show a clear message rather than a SQLite error.
set -e

DATA_DIR="${DATA_DIR:-/data}"
if ! mkdir -p "$DATA_DIR" 2>/dev/null || ! touch "$DATA_DIR/.nootion-write-test" 2>/dev/null; then
  echo "ERROR: Nootion can't write to $DATA_DIR (the container runs as UID:GID $(id -u):$(id -g))." >&2
  echo "Give this folder to that user. On TrueNAS: chown -R $(id -u):$(id -g) /mnt/<pool>/apps/nootion" >&2
  echo "(or Datasets > nootion > Edit Permissions). See docs/DEPLOYMENT.md." >&2
  exit 1
fi
rm -f "$DATA_DIR/.nootion-write-test"

exec "$@"
