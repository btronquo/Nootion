# Nootion

Application de prise de notes open source façon Notion, auto-hébergeable, dont le point fort est les **databases**
(relations, rollups, formules, filtres, agrégations).

> Statut : en développement (V1, étape 2 sur 10 : espaces et permissions). Voir [PLAN.md](PLAN.md).

## Ce qui marche aujourd'hui

- Premier lancement : création du compte administrateur.
- Connexion / déconnexion, sessions sécurisées (cookie httpOnly, mots de passe argon2).
- Invitations par lien (7 jours, optionnellement réservées à un email), rôles admin / membre, désactivation de comptes.
- Un espace personnel privé par utilisateur, et des espaces partagés avec rôles (propriétaire, éditeur, commentateur, lecteur).
- Arborescence de pages (sous-pages, glisser-déposer, icônes), corbeille avec restauration.
- Pages privées par défaut : partage d'une page à un utilisateur (hérité par les sous-pages), lien public en lecture seule révocable.
  Toutes les vérifications d'accès sont faites côté serveur (`apps/server/src/permissions.ts`) et couvertes par des tests.
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
