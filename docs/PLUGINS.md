# Écrire un plugin Nootion

Un plugin ajoute à Nootion des **blocs** pour l'éditeur (commande `/`), des **routes API**, des **tâches planifiées**
et des **fonctions de formule**. L'administrateur l'active, le désactive et remplit ses réglages dans
**Administration › Plugins**.

> Les plugins s'installent en confiance, comme sur un serveur perso : leur code serveur tourne avec les mêmes droits
> que Nootion. N'installez que des plugins dont vous connaissez la source.

Le plugin **Intégrations (embed)**, livré avec Nootion, sert d'exemple complet : [`apps/server/plugins/embed`](../apps/server/plugins/embed).

## Installer un plugin

1. Copiez le dossier du plugin dans `/data/plugins/<id>/` (le volume de données de Nootion).
2. Redémarrez le conteneur.
3. Activez-le dans **Administration › Plugins**. Activer, désactiver ou changer un réglage ne demande pas de redémarrage.

## Structure

```
mon_plugin/
├── manifest.json   obligatoire
├── server.js       code serveur (module ES), optionnel
└── client.js       code navigateur (module ES), optionnel
```

### manifest.json

```json
{
  "id": "mon_plugin",
  "name": "Mon plugin",
  "version": "1.0.0",
  "description": "Ce que fait le plugin.",
  "author": "Moi",
  "homepage": "https://exemple.org",
  "server": "server.js",
  "client": "client.js",
  "blocks": [
    { "id": "carte", "title": "Ma carte", "description": "Texte du menu /", "icon": "🗺️", "keywords": "map plan", "defaultData": {} }
  ],
  "settings": [
    { "key": "apiKey", "label": "Clé d'API", "type": "password", "help": "Chiffrée sur le serveur." },
    { "key": "mode", "label": "Mode", "type": "select", "default": "simple", "options": [{ "value": "simple", "label": "Simple" }] }
  ]
}
```

- `id` : minuscules, chiffres et `_` (2 à 40 caractères). Il apparaît dans les URL et dans le contenu des pages.
- Types de réglages : `text`, `password`, `number`, `boolean`, `select`. Les mots de passe sont chiffrés (avec
  `APP_SECRET`) et ne sont jamais renvoyés au navigateur.
- Les blocs déclarés ici restent connus de l'éditeur même quand le plugin est désactivé : les pages les gardent et
  affichent un emplacement « plugin désactivé ». Ne renommez donc pas l'`id` d'un bloc d'une version à l'autre.

## Côté serveur (`server.js`)

```js
export function activate(nootion) {
  // GET /api/plugins/mon_plugin/bonjour/Boris : réservé aux utilisateurs connectés
  nootion.route("GET", "/bonjour/:nom", ({ params, user, query, body }) => ({ message: `Bonjour ${params.nom}, de la part de ${user.name}` }));

  // Accessible sans être connecté (pages publiques) : { public: true }
  nootion.route("GET", "/statut", () => ({ ok: true }), { public: true });

  // Erreur avec un code HTTP
  nootion.route("POST", "/refus", () => {
    throw new nootion.HttpError(403, "refus", "Pas autorisé.");
  });

  // Tâche planifiée (au moins 1 seconde), arrêtée quand le plugin est désactivé
  nootion.every(15 * 60 * 1000, async () => nootion.log.info("synchro…"));

  // Fonction de formule, utilisable dans les colonnes Formule : ttc(prop("Montant HT"))
  nootion.formulaFunction("ttc", { min: 1, max: 1, help: "ttc(montant) : montant × 1,2", run: ([x]) => x * 1.2 });

  // Avant de montrer une page à un utilisateur, vérifiez son droit d'accès :
  // nootion.pages.role(user.id, pageId) renvoie null, "viewer", "commenter", "editor" ou "full".

  // Retourner une fonction : appelée à l'arrêt du plugin.
  return () => {};
}
```

Ce que reçoit `activate` :

| Champ | Rôle |
|---|---|
| `id` | identifiant du plugin |
| `settings` | valeurs des réglages (mots de passe déchiffrés). Le plugin redémarre quand elles changent. |
| `dataDir` | dossier propre au plugin : `/data/plugin-data/<id>` |
| `log.info / warn / error` | journal du serveur |
| `route(méthode, chemin, handler, { public })` | route servie sous `/api/plugins/<id>/…` |
| `every(ms, tâche)` | tâche répétée |
| `formulaFunction(nom, { min, max, help, run })` | fonction de formule calculée sur le serveur. `run` reçoit les arguments déjà évalués (nombres, textes, booléens, listes, dates). |
| `pages.role(userId, pageId)` | rôle d'un utilisateur sur une page |
| `HttpError` | erreur avec code HTTP |

Un plugin ne doit jamais renvoyer à un utilisateur des données qu'il ne pourrait pas voir lui-même.

## Côté navigateur (`client.js`)

Le code navigateur est chargé par toutes les pages, y compris les pages publiques. Il reçoit le React de
l'application : n'en embarquez pas un autre. Pas besoin d'outil de compilation, `React.createElement` suffit.

```js
export function activate(nootion) {
  const { React } = nootion;
  const h = React.createElement;

  function Carte({ data, setData, editable }) {
    if (!data.lieu) {
      return editable ? h("button", { onClick: () => setData({ lieu: "Lyon" }) }, "Choisir un lieu") : null;
    }
    return h("div", null, `📍 ${data.lieu}`);
  }

  nootion.registerBlock("carte", Carte);
}
```

- `data` : les données du bloc, enregistrées dans la page (et partagées en direct avec les autres éditeurs).
  Gardez-y ce que les lecteurs doivent voir, pour que les pages publiques s'affichent sans appel au serveur.
- `setData(objet)` : remplace les données du bloc.
- `editable` : faux pour les lecteurs et sur les pages publiques.
- `nootion.api(chemin, { method, body })` : appelle une route du plugin (`/api/plugins/<id><chemin>`).

Les classes Tailwind de l'application ne sont pas disponibles pour les plugins : utilisez des styles en ligne.
Un élément avec la classe `nootion-hover-only` n'apparaît qu'au survol du bloc (pratique pour des boutons d'édition).
Si le composant plante, seul le bloc affiche une erreur ; le reste de la page continue de fonctionner.
