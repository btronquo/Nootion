# Nootion : plan technique et périmètre V1

> Statut : **proposition v2 à valider**. Aucun code n'est écrit tant que ce plan n'est pas validé.
> Mis à jour le 28/10/2026 avec les retours de Boris : multi-utilisateur, pages privées et partage, relations/rollups, plugins, AGPL-3.0, GitHub.

## 1. Vision

Une app de prise de notes open source, façon Notion/Docmost, auto-hébergeable sur un NAS (TrueNAS) via Docker,
dont la fonctionnalité phare est **les databases** : tableaux typés, relations entre databases, formules, filtres, tris, groupements et agrégations
(ex. : journal de factures lié à une database de fournisseurs, total TTC par fournisseur et par année).

Principes :
- **Simple à héberger** : un seul conteneur, un seul volume `/data`, pas de Redis ni de serveur de base séparé.
- **Données à soi** : export `.md` des pages, export CSV/JSON des databases, sauvegarde = copier un dossier.
- **Multi-utilisateur et privé par défaut** : personne ne voit une page qui ne lui a pas été partagée, comme dans Notion.
- **Extensible** : un système de plugins pour brancher Nextcloud, Google Calendar, etc.
- **Licence AGPL-3.0**, code sur GitHub.

## 2. L'existant

| Projet | Databases | Pourquoi ça ne suffit pas forcément |
|---|---|---|
| Docmost | Non | Base de départ appréciée, mais pas de databases ; stack lourde (NestJS + Postgres + Redis) |
| AFFiNE | Oui (basiques) | Formules/agrégations limitées, self-host plus lourd |
| AppFlowy | Oui (grid, board, calendar) | Self-host complexe (plusieurs services), formules limitées |
| Outline / BookStack / Wiki.js | Non | Orientés wiki |
| NocoDB / Baserow | Oui, très complètes | Ce sont des "Airtable", pas des outils de notes |

Le créneau de Nootion : **la simplicité de Docmost + des databases sérieuses (relations, rollups, formules, agrégations), le tout en un seul conteneur.**

## 3. Stack technique proposée

Tout en **TypeScript**, en monorepo (front, back, moteur de formules et SDK de plugins partagent les mêmes types).

| Couche | Choix proposé | Pourquoi | Alternatives |
|---|---|---|---|
| Éditeur | **TipTap** (ProseMirror) | Éditeur bloc mature, utilisé par Docmost, extensible (indispensable pour les plugins), export Markdown faisable | BlockNote, Lexical |
| Édition à plusieurs | **Yjs + Hocuspocus** | Avec le multi-utilisateur, deux personnes peuvent éditer la même page partagée : sans ça, l'un écrase l'autre. Bien plus simple à intégrer dès le départ qu'après coup | Verrou "page en cours d'édition" (plus simple, moins confortable) |
| Front | **React + Vite** | Écosystème le plus riche pour TipTap et les tableaux | SvelteKit |
| Vue tableau | **TanStack Table** + virtualisation | Tri/filtre/groupement headless, gère des milliers de lignes | AG Grid |
| UI | Tailwind + shadcn/ui (Radix) | Rapide, accessible | Mantine (utilisé par Docmost) |
| Back | **Node.js + Fastify** | Léger, système de plugins natif (pratique pour nos plugins serveur) | NestJS, Hono |
| ORM | **Drizzle ORM** | Typé, migrations simples, supporte SQLite et Postgres | Prisma, Kysely |
| Base de données | **SQLite** (mode WAL, fichier dans `/data`) | Zéro service à gérer, sauvegarde = un fichier. Tient très bien pour une famille ou une petite équipe (quelques dizaines d'utilisateurs) | PostgreSQL : possible plus tard via Drizzle si besoin de beaucoup d'utilisateurs simultanés |
| Recherche | SQLite **FTS5**, filtrée par permissions | Rien à installer | Meilisearch |
| Formules | **Moteur maison** (parser + évaluateur, package partagé) | Sûr (pas d'`eval`), syntaxe proche de Notion, gère `prop()` sur relations et rollups | mathjs |
| Fichiers | Dossier `/data/uploads`, servis uniquement après contrôle des droits | Simple, inclus dans la sauvegarde | S3/MinIO plus tard |
| Auth | Comptes locaux (mot de passe hashé argon2) + session cookie | Suffisant en self-hosted | OIDC (Authentik, Nextcloud...) en V2, sous forme de plugin |
| Déploiement | **Image Docker unique** + `docker-compose.yml` | Déployable en "Custom App" YAML sur TrueNAS SCALE | |

## 4. Utilisateurs, espaces et permissions (V1)

Modèle calqué sur Notion :

- **Espace personnel** : chaque utilisateur a un espace privé. Ses pages ne sont visibles que par lui.
- **Espaces de travail partagés** (ex. "Maison", "Asso") : un espace a des membres avec un rôle (**propriétaire, éditeur, commentateur, lecteur**). Toutes les pages de l'espace sont visibles par ses membres, selon leur rôle.
- **Partage d'une page à un utilisateur** : le propriétaire peut partager une page précise avec un utilisateur donné et un rôle (lecture / édition). Le partage **s'applique aux sous-pages** (héritage), sauf si une sous-page a ses propres restrictions.
- **Lien public** : le propriétaire peut publier une page (et ses sous-pages, au choix) en **lecture seule** via un lien non devinable, révocable à tout moment.
- **Privé par défaut, vérifié côté serveur** : connaître l'URL d'une page ne suffit jamais. Chaque requête (page, ligne de database, fichier joint, recherche, export, relation, formule) passe par le même contrôle de droits. Une relation vers une ligne qu'on ne peut pas voir s'affiche comme "élément restreint".
- **Administration** : un compte admin (créé au premier lancement) gère les utilisateurs (invitation par lien ou création directe, désactivation). Inscription publique désactivée par défaut.

Ce contrôle d'accès sera **testé automatiquement** (tests qui vérifient que l'utilisateur 2 obtient bien une erreur sur chaque ressource de l'utilisateur 1).

## 5. Système de plugins

Oui, c'est tout à fait faisable, et tes deux exemples ont du sens :
- **Nextcloud** : sélectionner un fichier de ton Nextcloud (via WebDAV) et l'insérer dans une page sous forme de lien ou d'aperçu, ou dans une propriété "fichier" d'une database (ex. le PDF de la facture reste dans Nextcloud, Nootion garde juste le lien). Plus tard : connexion avec ton compte Nextcloud (OIDC).
- **Google Calendar** : un bloc "agenda" dans une page, et/ou synchroniser une database qui a une propriété date avec un calendrier (ex. échéances de paiement des factures).

### Ce que la V1 prévoit
La V1 pose **l'architecture** et le **SDK** des plugins, et les fonctionnalités internes seront construites avec ce même SDK quand c'est pertinent (c'est la meilleure garantie qu'il fonctionne). Les plugins Nextcloud et Google Calendar eux-mêmes sont prévus juste après la V1.

Un plugin est un package (dossier dans `/data/plugins` ou intégré à l'image) avec un manifeste qui déclare :
- **Côté éditeur** : nouveaux blocs TipTap et commandes `/` (ex. `/nextcloud`, `/agenda`).
- **Côté databases** : nouveaux types de propriétés, nouvelles fonctions de formule.
- **Côté serveur** : routes API, tâches planifiées (synchro), webhooks.
- **Connexions** : identifiants par utilisateur (OAuth Google, compte Nextcloud), stockés chiffrés.
- **Réglages** : page de configuration générée depuis le manifeste ; l'admin active ou désactive chaque plugin.

Garde-fous : les plugins passent par l'API interne et donc par le contrôle des droits (un plugin ne voit que ce que l'utilisateur voit). Pas de "marketplace" en V1 : on installe les plugins en confiance, comme sur un serveur perso.

## 6. Modèle de données (simplifié)

- `users`, `sessions`.
- `workspaces` (espace perso ou partagé), `workspace_members` (rôle).
- `pages` : id, workspace_id, parent_id, propriétaire, titre, icône, contenu (Yjs + JSON TipTap), ordre, dates.
- `page_permissions` : page_id, user_id, rôle, héritage.
- `public_links` : page_id, jeton, sous-pages incluses, date de révocation.
- `databases` : id, page_id (pleine page ou bloc dans une page), nom.
- `properties` : id, database_id, nom, type, config (JSON : options, devise, formule, database cible d'une relation, config de rollup...).
- `rows` : id, database_id, valeurs (JSON), page de contenu optionnelle.
- `relations` : row_id source, property_id, row_id cible (table dédiée pour des requêtes rapides dans les deux sens).
- `views` : id, database_id, type, filtres, tris, groupement, colonnes visibles, agrégations.
- `attachments`, `plugins`, `plugin_connections` (identifiants chiffrés par utilisateur).

## 7. Périmètre V1

### Comptes et partage
- Comptes multiples, invitation, rôle admin.
- Espace perso privé + espaces partagés avec rôles.
- Partage d'une page à un utilisateur (lecture/édition), avec héritage aux sous-pages.
- Lien public en lecture seule, révocable.
- Édition simultanée d'une page à plusieurs (curseurs visibles).

### Pages et éditeur
- Arborescence de pages (sidebar, glisser-déposer, sous-pages), section "Partagé avec moi".
- Éditeur bloc : titres, listes, to-do, citation, code, tableau simple, séparateur, callout, image, fichier joint, lien vers une autre page (`@`).
- Slash-commands (`/`), Markdown à la volée.
- Sauvegarde automatique, corbeille.
- Recherche plein texte (limitée à ce que l'utilisateur peut voir).
- Thème clair/sombre.

### Databases (le cœur)
- Database en pleine page ou en bloc dans une page.
- Types de propriétés : texte, nombre, **devise**, pourcentage, date, select, multi-select, case à cocher, URL, email, **fichier**, personne (utilisateur), date de création/modification, créé par.
- **Relations** entre databases (une ou plusieurs lignes liées, lien bidirectionnel optionnel). Ex. : Facture -> Fournisseur.
- **Rollups** : agréger une propriété des lignes liées (somme, moyenne, min, max, compte, liste...). Ex. : sur Fournisseur, "Total facturé" = somme du TTC des factures liées.
- **Formules** : arithmétique, `if`, comparaisons, fonctions texte/date/nombre, accès aux relations et rollups. Ex. : `prop("HT") * (1 + prop("TVA"))`.
- **Vue tableau** : édition en ligne, colonnes redimensionnables/masquables/réordonnables.
- **Filtres** combinables (ET/OU, groupes imbriqués), **tris** multiples.
- **Groupement** par select/date (mois, année)/relation, avec sous-totaux.
- **Agrégations en pied de colonne** sur les lignes filtrées : somme, moyenne, min, max, compte, vides/non-vides.
- Plusieurs vues enregistrées par database.
- Chaque ligne s'ouvre comme une page.

### Import / export
- Export d'une page ou d'un espace en **`.md`** (zip qui reproduit l'arborescence, fichiers inclus, métadonnées en front-matter).
- Export d'une database en **CSV** et **JSON** (formules et rollups calculés inclus).
- Import **CSV** dans une database.
- Sauvegarde complète par l'admin : dossier `/data` (`nootion.db` + `uploads/`), téléchargeable depuis l'app.

### Plugins
- Architecture, manifeste, SDK et page d'administration des plugins.
- Un plugin d'exemple simple pour valider le SDK (ex. bloc "embed" d'URL).

### Hébergement
- Image Docker unique, `docker-compose.yml` fourni, testé en Custom App sur TrueNAS SCALE.
- Configuration par variables d'environnement.

## 8. Après la V1

- **V1.1** : plugin **Nextcloud** (fichiers), plugin **Google Calendar**.
- **V2** : vues Board (kanban), Calendrier, Galerie, Graphique ; connexion OIDC (Authentik, Nextcloud...) ; export `.md` automatique planifié vers un dossier du NAS ; import Notion / Markdown ; commentaires ; historique de versions ; templates ; OCR des factures ; PWA mobile.

## 9. Exemple de `docker-compose.yml` (cible)

```yaml
services:
  nootion:
    image: ghcr.io/<toi>/nootion:latest
    container_name: nootion
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      APP_URL: "http://nas.local:3000"
      APP_SECRET: "change-me-long-random-string"   # sert aussi à chiffrer les identifiants des plugins
      TZ: "Europe/Paris"
    volumes:
      - /mnt/tank/apps/nootion:/data   # dataset TrueNAS : db, uploads, plugins
```

## 10. Structure du dépôt (prévue)

```
nootion/
  apps/
    web/          # React + Vite + TipTap
    server/       # Fastify + Drizzle + SQLite + Hocuspocus
  packages/
    shared/       # types, schémas de validation (zod)
    formula/      # parser + évaluateur de formules
    permissions/  # règles d'accès, testées à part
    plugin-sdk/   # API publique des plugins
  plugins/
    embed/        # plugin d'exemple
  docker/
    Dockerfile
  docker-compose.yml
  LICENSE         # AGPL-3.0
  docs/
```

## 11. Étapes de développement

1. **Socle** : monorepo, Fastify + SQLite, comptes, sessions, Docker qui tourne sur le NAS.
2. **Espaces et permissions** : espaces, rôles, partage, liens publics, avec tests d'accès dès le départ.
3. **Pages** : arborescence, éditeur TipTap, édition simultanée (Yjs).
4. **Databases** : propriétés typées, vue tableau, édition en ligne.
5. **Relations et rollups**.
6. **Moteur de formules** (avec tests unitaires).
7. **Filtres, tris, groupements, agrégations**, vues enregistrées.
8. **Plugins** : SDK, chargement, administration, plugin d'exemple.
9. **Export/import** : `.md`, CSV/JSON, sauvegarde.
10. Recherche, finitions, doc de déploiement TrueNAS, première release GitHub.

La V1 a grossi (multi-utilisateur, partage, relations, plugins) : c'est faisable, mais elle sera livrée par étapes, chaque étape étant utilisable sur le NAS.

## 12. Décisions prises

- Multi-utilisateur en V1, pages privées par défaut, partage à un utilisateur ou par lien public.
- Relations et rollups en V1.
- Plugins : architecture en V1, Nextcloud et Google Calendar juste après.
- Licence **AGPL-3.0**.
- Code sur **GitHub**. Commits au nom de Boris uniquement, **sans ligne de co-auteur Claude**.

## 13. Reste à confirmer

1. **SQLite** (recommandé, un seul conteneur) ou **PostgreSQL** (un conteneur en plus) ? Avec le multi-utilisateur, SQLite reste adapté pour une famille ou une petite équipe.
2. Nom du dépôt GitHub (ex. `nootion`) : tu le crées et je m'y branche.
