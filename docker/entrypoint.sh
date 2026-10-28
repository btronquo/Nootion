#!/bin/sh
# Vérifie que le volume de données est accessible en écriture avant de lancer Nootion,
# pour afficher un message clair plutôt qu'une erreur SQLite.
set -e

DATA_DIR="${DATA_DIR:-/data}"
if ! mkdir -p "$DATA_DIR" 2>/dev/null || ! touch "$DATA_DIR/.nootion-write-test" 2>/dev/null; then
  echo "ERREUR : Nootion ne peut pas écrire dans $DATA_DIR (le conteneur tourne avec l'UID:GID $(id -u):$(id -g))." >&2
  echo "Donnez ce dossier à cet utilisateur. Sur TrueNAS : chown -R $(id -u):$(id -g) /mnt/<pool>/apps/nootion" >&2
  echo "(ou Datasets > nootion > Edit Permissions). Voir docs/DEPLOIEMENT.md." >&2
  exit 1
fi
rm -f "$DATA_DIR/.nootion-write-test"

exec "$@"
