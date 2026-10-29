# Contribuer à Nootion

Merci de votre intérêt ! Les bugs, les idées et les pull requests sont les bienvenus.

## Signaler un bug ou proposer une idée

Ouvrez une issue avec le modèle qui convient. Pour un bug, indiquez la version (en bas de la page Administration),
votre installation et les étapes pour le reproduire.

Pour une faille de sécurité, n'ouvrez pas d'issue publique : voir [SECURITY.md](SECURITY.md).

## Préparer l'environnement

Prérequis : Node.js 22 et pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm dev          # serveur sur :3000, interface sur http://localhost:5173
pnpm test         # tests automatiques
pnpm typecheck
```

Organisation du code :

```
apps/server      API Fastify + Drizzle + SQLite (tests dans apps/server/test)
apps/web         Interface React + Vite + Tailwind + TipTap
packages/shared  Types, validation, moteur de formules et de vues, partagés par les deux
apps/server/plugins  Plugins livrés avec l'application (voir docs/PLUGINS.md)
```

Après une modification de `apps/server/src/db/schema.ts`, créez la migration avec
`pnpm --filter @nootion/server db:generate`. Les migrations sont appliquées au démarrage.

## Proposer une modification

1. Pour un changement important, ouvrez d'abord une issue pour en discuter.
2. Créez une branche, gardez la pull request centrée sur un seul sujet.
3. Ajoutez des tests quand c'est possible, surtout pour les droits d'accès (`permissions.ts`) :
   toute route qui lit ou modifie une page doit vérifier le rôle de l'utilisateur côté serveur.
4. Vérifiez que `pnpm typecheck` et `pnpm test` passent (la CI les relance).
5. Ajoutez une ligne dans [CHANGELOG.md](CHANGELOG.md) sous une section « À venir ».

Le texte de l'interface est en français. Les commandes « / » de l'éditeur sont en anglais.

## Licence

En contribuant, vous acceptez que votre contribution soit publiée sous licence [AGPL-3.0](LICENSE).
