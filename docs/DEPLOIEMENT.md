# Déployer Nootion

Nootion tourne dans **un seul conteneur** (API + interface web), sans base de données ni Redis à côté.
Toutes les données sont dans le dossier monté sur `/data` :

| Chemin dans `/data` | Contenu |
|---|---|
| `nootion.db` (+ `-wal`, `-shm` quand l'app tourne) | La base SQLite : comptes, pages, databases, partages |
| `uploads/` | Fichiers joints aux pages (images, PDF…) et plus tard aux databases. Un fichier par pièce jointe, nommé par son identifiant. |
| `avatars/` | Photos de profil des comptes |
| `plugins/` | Plugins installés à la main (voir [PLUGINS.md](PLUGINS.md)) |
| `plugin-data/` | Fichiers gardés par les plugins |

**Sauvegarder Nootion = sauvegarder ce dossier.** Sur TrueNAS, un snapshot ZFS périodique du dataset suffit
(*Data Protection > Periodic Snapshot Tasks*). Les exports `.md` (pages) et CSV/JSON (databases) se téléchargent
depuis l'interface ; ils servent à récupérer ses données dans un format lisible, pas à remplacer la sauvegarde.
L'admin peut aussi télécharger une sauvegarde complète depuis **Administration › Sauvegarde** (un .zip à décompresser dans `/data`, conteneur arrêté, pour restaurer).

## Variables d'environnement

| Variable | Obligatoire | Description |
|---|---|---|
| `APP_URL` | oui | Adresse tapée dans le navigateur, sans `/` final (ex. `http://192.168.1.10:3000` ou `https://notes.mondomaine.fr`). Sert aux liens d'invitation et à la protection CSRF : ouvrez toujours Nootion à cette adresse. |
| `APP_SECRET` | oui | Chaîne aléatoire d'au moins 16 caractères (`openssl rand -hex 32`). Générez-la une fois et ne la changez plus : elle chiffre les mots de passe des réglages des plugins. |
| `TZ` | non | Fuseau horaire (ex. `Europe/Paris`). |
| `PORT` | non | Port d'écoute dans le conteneur (défaut `3000`). Pour changer le port côté NAS, modifiez plutôt `ports:`. |
| `MAX_UPLOAD_MB` | non | Taille maximale d'un fichier joint, en Mo (défaut `50`). |

Si Nootion est derrière un reverse proxy en HTTPS, mettez l'URL `https://…` dans `APP_URL` : le cookie de session devient alors `Secure`.
Le proxy doit laisser passer les **WebSockets** sur `/collab` (édition à plusieurs en temps réel) : dans Nginx Proxy Manager, cochez *Websockets Support*.
Pensez aussi à sa limite de taille d'envoi (`client_max_body_size` dans Nginx) pour les fichiers joints.

## TrueNAS SCALE (24.10 « Electric Eel » et plus)

### 1. Préparer le dataset de données

1. *Datasets* : créez `tank/apps/nootion` (adaptez `tank` au nom de votre pool), preset **Apps**.
2. Donnez-le à l'utilisateur `apps` (UID/GID 568) : *Datasets > nootion > Edit Permissions*, ou en shell
   `chown -R 568:568 /mnt/tank/apps/nootion`.
   Si ce n'est pas fait, le conteneur s'arrête au démarrage avec un message qui l'explique (visible dans les logs de l'app).

### 2a. Installer avec l'image publiée (recommandé)

L'image est construite automatiquement par la CI et publiée pour amd64 et arm64 :

- sur GitHub : `ghcr.io/<utilisateur-github>/nootion` (publique dès que le dépôt l'est) ;
- sur GitLab : `registry.gitlab.com/btronquoy/nootion`.

Les exemples ci-dessous utilisent l'adresse GitLab ; remplacez-la par celle de GitHub si vous préférez.

1. *Apps > Discover Apps > ⋮ > Install via YAML*, nom `nootion`.
2. Collez le contenu de [`deploy/truenas.yaml`](../deploy/truenas.yaml) et remplacez les trois valeurs marquées `<--`
   (`APP_URL`, `APP_SECRET`, chemin du dataset).
3. Enregistrez, attendez que l'app passe à *Running*, puis ouvrez `APP_URL` : la page de création du compte administrateur s'affiche.

> Tant que le projet GitLab est **privé**, son registre d'images l'est aussi et TrueNAS ne peut pas télécharger l'image
> sans identifiants. Deux solutions : rendre le projet public (c'est prévu, licence AGPL), ou utiliser la méthode 2b.

**Mettre à jour** : *Apps > nootion > Edit > Save* (avec `pull_policy: always`, l'image `latest` est retéléchargée).
Les migrations de base s'appliquent toutes seules au démarrage. Faites un snapshot du dataset avant une mise à jour majeure.
Pour figer une version, remplacez `latest` par un numéro (ex. `registry.gitlab.com/btronquoy/nootion:1.0.0`).

### 2b. Construire l'image sur le NAS depuis le code source

1. Créez un second dataset `tank/apps/nootion-src` et copiez-y le dépôt (partage SMB ou `git clone`), sans les dossiers `node_modules`.
2. *Apps > Discover Apps > ⋮ > Install via YAML*, nom `nootion`, et collez :

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
      APP_URL: "http://IP-DU-NAS:3000"
      APP_SECRET: "collez-ici-une-longue-chaine-aleatoire"
      TZ: "Europe/Paris"
    volumes:
      - /mnt/tank/apps/nootion:/data
```

Mettre à jour : copiez le nouveau code dans `nootion-src`, puis *Apps > nootion > Edit > Save* (reconstruction).

## Docker classique (PC, autre NAS)

```bash
docker compose up -d --build
```

Le [`docker-compose.yml`](../docker-compose.yml) du dépôt construit l'image depuis les sources et range les données
dans un volume Docker nommé `nootion-data`. Pour utiliser l'image publiée à la place, remplacez `build:` par
`image: registry.gitlab.com/btronquoy/nootion:latest`.

## Publier une nouvelle version de l'image

Deux pipelines font la même chose, chacun sur son registre : [`.gitlab-ci.yml`](../.gitlab-ci.yml) pour GitLab et
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) pour GitHub (ghcr.io, sans configuration : il utilise le
jeton fourni par GitHub Actions). Ils lancent les tests puis construisent et publient l'image :

- à chaque push sur la branche principale : tags `main` et `main-<commit>` (pour essayer la dernière version de dev) ;
- à chaque tag git `vX.Y.Z` : tags `X.Y.Z` et `latest` (et `X.Y` sur GitHub).

```bash
git tag v1.0.0
git push origin v1.0.0
```

Sur GitHub, la première image publiée est privée : *Packages > nootion > Package settings > Change visibility > Public*.
Pensez aussi à mettre à jour [CHANGELOG.md](../CHANGELOG.md) et à créer la release (*Releases > Draft a new release*, tag `v1.0.0`).

Pour tester l'image localement avant de publier : `docker build -f docker/Dockerfile -t nootion:local .`
