# Journal des versions

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et les numéros de version suivent
[Semantic Versioning](https://semver.org/lang/fr/).

## [1.0.0] - à publier

Première version publique.

### Comptes et partage

- Création du compte administrateur au premier lancement, invitations par lien, rôles admin / membre.
- Espace personnel privé par utilisateur et espaces partagés (propriétaire, éditeur, commentateur, lecteur).
- Pages privées par défaut, partage d'une page à un utilisateur, lien public en lecture seule révocable.

### Pages

- Éditeur façon Notion avec commandes « / », édition à plusieurs en temps réel, fichiers joints, liens entre pages.
- Arborescence avec glisser-déposer, icônes, corbeille avec restauration.
- Recherche plein texte dans les titres et le contenu (Ctrl+K ou ⌘K), sans tenir compte des accents.

### Databases

- Colonnes typées (texte, nombre, montant, pourcentage, date, sélections, case à cocher, lien, email, personne,
  fichiers, dates et auteur automatiques).
- Calculs sous les colonnes, relations dans un sens ou dans les deux, rollups.
- Formules façon Notion avec vérification en direct.
- Vues tableau et Kanban, avec filtres, tris, groupes et colonnes propres à chaque vue.

### Plugins

- SDK pour ajouter des blocs, des routes API, des tâches planifiées et des fonctions de formule.
- Plugin « Intégrations » livré (`/embed` : YouTube, Vimeo, Spotify, Google Maps, Figma, aperçu de liens).

### Données

- Export en Markdown (.zip), CSV et JSON, import de CSV, sauvegarde complète téléchargeable.
- Une seule image Docker (amd64 et arm64), données dans `/data`, migrations appliquées au démarrage.

[1.0.0]: ../../releases/tag/v1.0.0
