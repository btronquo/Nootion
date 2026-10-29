# Nootion

Application de prise de notes open source façon Notion, auto-hébergeable, dont le point fort est les **databases**
(relations, rollups, formules, filtres, agrégations).

> Statut : en développement (V1, étape 5 sur 10 : relations et rollups). Voir [PLAN.md](PLAN.md).

## Ce qui marche aujourd'hui

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
- Page « Mon compte » : nom, email, mot de passe, photo de profil, thème clair / sombre / système.
- Option « Pleine largeur » par page.
- Image Docker unique, données dans `/data`.

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
docs/            Documentation (déploiement…)
```

## Licence

[AGPL-3.0](LICENSE)
