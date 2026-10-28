# Déployer Nootion

Nootion tourne dans **un seul conteneur**. Toutes les données sont dans le dossier monté sur `/data` :

- `nootion.db` (+ `nootion.db-wal`, `nootion.db-shm`) : la base SQLite ;
- plus tard `uploads/` (fichiers joints) et `plugins/`.

**Sauvegarder Nootion = sauvegarder ce dossier** (un snapshot ZFS du dataset sur TrueNAS est idéal).

## Variables d'environnement

| Variable | Obligatoire | Description |
|---|---|---|
| `APP_URL` | oui | Adresse utilisée dans le navigateur, sans `/` final (ex. `http://192.168.1.10:3000` ou `https://notes.mondomaine.fr`). Sert aux liens d'invitation et à la protection CSRF. |
| `APP_SECRET` | oui | Chaîne aléatoire d'au moins 16 caractères (`openssl rand -hex 32`). À garder : elle servira aussi à chiffrer les identifiants des plugins. |
| `PORT` | non | Port d'écoute dans le conteneur (défaut `3000`). |
| `TZ` | non | Fuseau horaire (ex. `Europe/Paris`). |

Si Nootion est derrière un reverse proxy en HTTPS, mettez l'URL `https://…` dans `APP_URL` : le cookie de session devient alors `Secure`.

## TrueNAS SCALE (24.10 « Electric Eel » et plus)

Tant que l'image n'est pas publiée sur GitHub (prévu à la release V1), on la construit sur le NAS à partir du code source.

1. Créez deux datasets, par exemple `tank/apps/nootion` (données) et `tank/apps/nootion-src` (code).
2. Copiez le contenu du dépôt dans `/mnt/tank/apps/nootion-src` (partage SMB, ou `git clone` plus tard), sans les dossiers `node_modules`.
3. Donnez le dataset de données à l'utilisateur `apps` (UID 568) : *Datasets > nootion > Edit Permissions*, ou en shell `chown 568:568 /mnt/tank/apps/nootion`.
4. *Apps > Discover Apps > ⋮ > Install via YAML*, nom `nootion`, et collez :

```yaml
services:
  nootion:
    image: nootion:latest
    build:
      context: /mnt/tank/apps/nootion-src
      dockerfile: docker/Dockerfile
    container_name: nootion
    restart: unless-stopped
    user: "568:568"
    ports:
      - "3000:3000"
    environment:
      APP_URL: "http://IP-DU-NAS:3000"
      APP_SECRET: "collez-ici-une-longue-chaine-aleatoire"
      TZ: "Europe/Paris"
    volumes:
      - /mnt/tank/apps/nootion:/data
```

5. Ouvrez `http://IP-DU-NAS:3000` : la page de création du compte administrateur s'affiche.

Mise à jour : copiez le nouveau code dans `nootion-src`, puis reconstruisez l'app (*Apps > nootion > Edit > Save*, ou `docker compose up -d --build`). Les migrations de base s'appliquent toutes seules au démarrage.

Après la release V1, la section `build:` sera remplacée par `image: ghcr.io/<compte>/nootion:<version>`.

## Docker classique (PC, autre NAS)

```bash
docker compose up -d --build
```

Dans `docker-compose.yml`, supprimez la ligne `user: "568:568"` (propre à TrueNAS) et adaptez le chemin du volume.
