# Nootion

Application de prise de notes open source façon Notion, auto-hébergeable, dont le point fort est les **databases**
(relations, rollups, formules, filtres, agrégations).

> Statut : version 1.0.0. Voir [CHANGELOG.md](CHANGELOG.md) pour le détail et [PLAN.md](PLAN.md) pour la suite.

## Fonctionnalités

- Premier lancement : création du compte administrateur.
- Connexion / déconnexion, sessions sécurisées (cookie httpOnly, mots de passe argon2).
- Invitations par lien (7 jours, optionnellement réservées à un email), rôles admin / membre, désactivation de comptes.
- Un espace personnel privé par utilisateur, et des espaces partagés avec rôles (propriétaire, éditeur, commentateur, lecteur).
- Arborescence de pages (sous-pages, glisser-déposer, icônes), corbeille avec restauration.
- Pages privées par défaut : partage d'une page à un utilisateur (hérité par les sous-pages), lien public en lecture seule révocable.
  Toutes les vérifications d'accès sont faites côté serveur (`apps/server/src/permissions.ts`) et couvertes par des tests.
- Éditeur de pages façon Notion (commandes « / », listes de tâches, tableaux, encadrés, images et fichiers joints,
  liens entre pages avec « @ »), édition à plusieurs en temps réel.
- Databases : colonnes typées (texte, nombre, montant en devise, pourcentage, date, sélection, sélection multiple,
  case à cocher, lien, email, personne, fichiers, date de création, dernière modification, créé par), vue tableau
  (ordre, largeur et masquage des colonnes), chaque ligne s'ouvre comme une page avec ses propriétés.
  Une database peut être une page à part ou intégrée dans une page (commande `/database`), et s'affiche
  en lecture seule sur les liens publics.
- Calculs sous les colonnes (somme, moyenne, médiane, min, max, nombre, pourcentage coché, dates…).
- Relations entre databases (dans un sens ou dans les deux, tenues à jour automatiquement) et rollups
  (ex. total des factures d'un fournisseur).
- Formules façon Notion : `prop("Montant") * 1.2`, `if(prop("Payé"), "OK", "À payer")`, `dateBetween(now(), prop("Échéance"), "days")`…
  Éditeur avec vérification en direct et aide sur les fonctions ; les formules marchent avec les relations, les rollups et les calculs.
- Plusieurs vues par database (tableau ou Kanban), chacune avec ses filtres (et / ou, dates relatives comme
  « la semaine à venir »), ses tris, ses groupes et ses colonnes affichées. Glisser-déposer entre colonnes du Kanban.
- Plugins : blocs pour l'éditeur, routes API, tâches planifiées et fonctions de formule, activés et réglés
  dans l'administration. Livré avec le plugin « Intégrations » (`/embed` : YouTube, Vimeo, Spotify, Google Maps,
  Figma, aperçu de liens). Voir [docs/PLUGINS.md](docs/PLUGINS.md) pour écrire le vôtre.
- Export d'une page ou d'un espace en Markdown (.zip : sous-pages, fichiers joints, databases en CSV et JSON),
  export d'une database en CSV (ou CSV pour Excel) et JSON avec les formules calculées, import de CSV dans une database
  (colonnes et options créées au besoin), sauvegarde complète téléchargeable par l'admin.
- Recherche plein texte dans les titres et le contenu des pages (Ctrl+K ou ⌘K), insensible aux accents,
  limitée aux pages que l'utilisateur peut lire.
- Page « Mon compte » : nom, email, mot de passe, photo de profil, thème clair / sombre / système.
- Option « Pleine largeur » par page.
- Image Docker unique (amd64 et arm64), données dans `/data`.

## Lancer avec Docker

Voir [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md) (TrueNAS SCALE et Docker classique).

```bash
docker compose up -d --build
```

## Développement

Prérequis : Node.js 22 et pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm dev          # serveur sur :3000, interface sur http://localhost:5173
pnpm test         # tests automatiques
pnpm typecheck
pnpm build
```

Après une modification de `apps/server/src/db/schema.ts` : `pnpm --filter @nootion/server db:generate` pour créer la migration.
Les migrations sont appliquées automatiquement au démarrage.

## Organisation

```
apps/server      API Fastify + Drizzle + SQLite
apps/web         Interface React + Vite + Tailwind
packages/shared  Types et schémas de validation partagés
docker/          Dockerfile
deploy/          Fichier d'installation TrueNAS
docs/            Documentation (déploiement…)
```

## Contribuer

Les bugs, idées et pull requests sont les bienvenus : voir [CONTRIBUTING.md](CONTRIBUTING.md).
Pour une faille de sécurité : [SECURITY.md](SECURITY.md).

## Licence

[AGPL-3.0](LICENSE)
