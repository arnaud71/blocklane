# BlockLane — observatoire blockchain HEG

Une ville animée pour comprendre Bitcoin et Ethereum : les transactions deviennent des voyageurs, les blocs des transports. Une interprétation originale de l'esprit de [TxStreet](https://github.com/txstreet/txstreet), avec une scène vectorielle SVG, une interface française et un socle conçu pour rester maintenable.

L'application démarre en mode **direct**. Bitcoin et Ethereum sont visibles ensemble dans une ville qui occupe la fenêtre. La démonstration pédagogique est un mode séparé, annoncé à l'écran. Une source indisponible ne déclenche jamais une simulation présentée comme réelle.

## Démarrer

Prérequis : Node.js **24 LTS** et npm. La branche 24 est une version maintenue de Node ; consulter le [calendrier officiel](https://nodejs.org/en/about/previous-releases) avant une migration.

```sh
npm ci
cp .env.example .env
npm run dev
```

Ouvrir `http://localhost:5173`. Vite transmet les appels `/api` au serveur local sur le port `3001`. Les accès aux fournisseurs passent par ce serveur ; une clé RPC éventuelle reste hors du navigateur.

```sh
npm run build
npm start
```

Le serveur sert alors l'interface compilée et l'API sur `http://127.0.0.1:3001`. Le mode direct exige un accès réseau sortant vers les fournisseurs configurés.

## Données et portée

| Réseau   | Source initiale                         | Ce que l'on peut montrer honnêtement                                                                                                              |
| -------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bitcoin  | API publique mempool.space, remplaçable | Blocs récents, statistiques du mempool observé et échantillon de transactions en attente                                                          |
| Ethereum | JSON-RPC public PublicNode, remplaçable | Blocs récents et transactions d'un bloc `pending` lorsque le fournisseur le permet ; sinon transactions du dernier bloc, explicitement confirmées |

Les sources publiques sont partagées et n'offrent ici aucune garantie de disponibilité. Une application publique durable devrait utiliser un contrat fournisseur adapté ou des nœuds administrés. Les données Ethereum ne constituent **pas un mempool mondial exhaustif** : les nœuds ont une vue locale et certaines transactions suivent des canaux privés. Voir les explications de [consensus Ethereum](https://ethereum.org/developers/docs/consensus-mechanisms/pos/) et le contrat [JSON-RPC](https://ethereum.org/developers/docs/apis/json-rpc/).

La scène représente un échantillon borné, pas toutes les transactions du réseau. L'animation illustre les mécanismes ; elle ne prédit pas l'ordre exact d'inclusion ni le prochain bloc. Les frais indiqués sont des observations ou des estimations, jamais une garantie d'inclusion.

Les t-shirts passent du jaune pour les frais faibles à l'orange à la moyenne, puis au rouge à partir de deux fois la moyenne des voyageurs en attente affichés sur la même blockchain. Cette moyenne concerne notre échantillon visible, pas tout le réseau.

Une commande commune permet d'afficher les frais natifs ou leur conversion en **dollars américains**. Les taux des en-têtes restent des taux : USD/vB pour Bitcoin, USD/gas pour Ethereum. Le détail et l'infobulle d'un voyageur donnent un montant total estimé, marqué `≈`. Pour Ethereum, ce calcul utilise la limite de gas déclarée ; il ne représente ni le gas réellement consommé ni les frais réellement payés. Le classement et les couleurs utilisent toujours les taux natifs.

La conversion utilise un cours spot [Coinbase](https://docs.cdp.coinbase.com/coinbase-app/track-apis/prices) reçu côté serveur, avec sa source et son heure visibles. Ce cours possède un cache partagé de 60 secondes, distinct du cache blockchain de 3 secondes. La collecte du cours s'effectue en arrière-plan sans attendre sa réponse pour afficher les données blockchain : au premier chargement, la conversion peut rester indisponible jusqu'à une lecture suivante. En cas de panne, un cours conservé reste utilisable au plus cinq minutes, puis la conversion devient indisponible sans remplacer une valeur inconnue par zéro. La conversion se fait au cours relevé, pas au cours historique du bloc ; la démonstration ne reçoit aucun cours fictif. Cette extension reste non validée pendant la suspension des contrôles décrite dans [docs/validation.md](docs/validation.md).

Les anciennes observations regroupées conservent jusqu'à 512 identifiants pendant 30 minutes dans l'interface. Le serveur suit jusqu'à 2 048 identifiants observés pendant 30 minutes et vérifie les nouveaux blocs, avec un rattrapage limité à huit blocs par collecte. Un journal partagé de 16 blocs et 2 048 preuves au total permet de retrouver les inclusions des voyageurs conservés, qui quittent alors le groupe pour le départ correspondant. Au-delà des bornes ou après redémarrage, le suivi individuel reste inconnu ; le groupe ne représente pas un nombre exact de transactions encore en attente sur le réseau.

Le serveur mutualise les appels et attend au moins 3 secondes après chaque collecte avant de pouvoir en lancer une autre. Un dernier instantané valide peut être conservé jusqu'à 120 secondes en étant signalé comme ancien ; au-delà, la source devient indisponible. L'interface attend 3 secondes en direct et 5 secondes en démonstration après chaque réponse avant de consulter à nouveau l'API locale, sans chevaucher ses requêtes. Elle suspend ces lectures dans un onglet masqué. La durée de collecte s'ajoute à ces délais : une nouvelle donnée toutes les 3 secondes n'est pas garantie. Le rythme des blocs et la fréquence d'actualisation de l'interface sont deux choses différentes.

## Configuration

Les variables sont décrites dans [.env.example](.env.example). Ne jamais préfixer une clé fournisseur par `VITE_` : ces valeurs seraient intégrées au code client.

| Variable                    | Valeur initiale                       | Usage                                                         |
| --------------------------- | ------------------------------------- | ------------------------------------------------------------- |
| `PORT`                      | `3001`                                | Port du serveur HTTP                                          |
| `HOST`                      | `127.0.0.1`                           | Interface d'écoute ; `0.0.0.0` dans le conteneur              |
| `API_RATE_LIMIT_PER_MINUTE` | `120`                                 | Limite de requêtes API par client ; entier de 1 à 10000       |
| `TRUSTED_PROXY_IPS`         | Vide                                  | IP exactes des reverse proxies fiables, séparées par virgules |
| `BITCOIN_API_URL`           | `https://mempool.space/api`           | Base de l'API Bitcoin                                         |
| `ETHEREUM_RPC_URL`          | `https://ethereum-rpc.publicnode.com` | Point d'accès JSON-RPC Ethereum                               |

Les URL sont configurées par l'opérateur, jamais par les visiteurs. HTTPS est requis pour un fournisseur distant ; HTTP est accepté uniquement pour les adresses de boucle locale. Une clé dans une URL reste un secret : protéger `.env`, les journaux et la configuration de l'hébergeur.

La personnalisation HEG se fait dans `src/config/brand.ts` : nom, textes et lien FairOnChain facultatif. Le lien est désactivé par défaut. Le fonctionnement de BlockLane ne dépend pas de FairOnChain. L'identité visuelle actuelle est une proposition, à valider avant d'utiliser des marques ou logos institutionnels officiels.

## Qualité et versionnement

```sh
npm run check
npm run format:check
npx playwright install chromium
npm run test:e2e
npm audit --omit=dev --audit-level=high
```

`check` regroupe lint, TypeScript strict, tests unitaires et compilation. Les tests navigateur couvrent les parcours avec données contrôlées ; ils ne dépendent pas de la disponibilité des API publiques. La CI répète ces contrôles sur les propositions de changement. Dependabot ouvre des propositions hebdomadaires ; aucune fusion ni publication automatique n'est configurée.

Conserver `package-lock.json`, utiliser `npm ci`, travailler sur des branches `codex/...`, passer par une PR et mettre à jour [CHANGELOG.md](CHANGELOG.md). Les versions suivent SemVer ; une publication validée reçoit un tag `vX.Y.Z`. La CI et les protections de branche ne deviennent actives qu'après publication dans un dépôt GitHub et configuration de ses règles.

## Hébergement

```sh
docker compose up --build -d
```

Le conteneur écoute sur le port `3001`, publié seulement sur `127.0.0.1:3001` côté hôte. Il fonctionne sans privilèges et avec un système de fichiers en lecture seule. Pour une ouverture au public, placer un reverse proxy HTTPS devant, limiter les requêtes au niveau du proxy, surveiller le service et conserver une image de retour arrière. Ne pas utiliser le serveur Vite de développement pour héberger le site.

Pour utiliser la conversion USD sur l'infrastructure HEG, autoriser aussi les connexions HTTPS sortantes du serveur vers `api.coinbase.com:443`. Les deux URL de cours sont fixes ; aucune nouvelle variable d'environnement, clé ou dépendance n'est nécessaire.

Configurer `TRUSTED_PROXY_IPS` avec l'adresse du proxy réellement vue par le serveur, et faire remplacer `X-Real-IP` par le proxy. Sans cette configuration, les visiteurs d'un même proxy partagent la limite serveur. Les en-têtes d'un visiteur direct ne sont pas considérés comme une preuve d'adresse ; `X-Forwarded-For` est ignoré.

Recommandation initiale : **un petit serveur Linux ou une plateforme de conteneurs, un seul service Node et des fournisseurs de données remplaçables**. Sans base de données, Redis ni infrastructure blockchain à administrer au départ. Une infrastructure HEG peut héberger le même conteneur. Les options, leurs compromis et les conditions d'évolution figurent dans [docs/architecture.md](docs/architecture.md).

Ce dépôt contient le socle applicatif et les procédures. La mise en ligne publique, le domaine, TLS, les comptes fournisseurs, les alertes et les règles de branche restent à configurer dans l'environnement retenu. Aucune disponibilité de production n'est promise par cette version initiale.

## Maintenance

La version 0.2.0 ajoute les trajets vers les wagons, les retours en file selon la priorité illustrative, les têtes proportionnelles aux ressources des transactions et un panneau du quai dynamique. Voir [le fonctionnement des animations](docs/animation.md) pour les règles, les limites et les contrôles.

Les résultats et les limites de la première vérification sont consignés dans [docs/validation.md](docs/validation.md).

Une automatisation Codex est enregistrée pour ce chat : **Maintenance hebdomadaire BlockLane**, chaque lundi à **09 h, Europe/Zurich**. Elle contrôle les dépendances, les tests et les connecteurs, prépare des correctifs à revoir et signale les changements utiles. Aucune fusion ni mise en production automatique. Le Mac doit être éveillé, l'application ouverte et le projet accessible à l'heure prévue.

Le travail de maintenance de Codex doit rester traçable : examiner les alertes, proposer un correctif dans une branche, vérifier et présenter une PR. La périodicité effective dépend de l'automatisation enregistrée dans Codex ; les fichiers du dépôt ne réveillent pas l'agent à eux seuls. L'exécution dépend aussi de l'accès au projet, aux outils et aux comptes nécessaires.

Le [guide de maintenance](docs/maintenance.md) décrit les mises à jour, le diagnostic d'une source en panne, les livraisons et le retour arrière. [AGENTS.md](AGENTS.md) encadre les interventions futures. [SECURITY.md](SECURITY.md) décrit les limites et le traitement des vulnérabilités.

Le [contrat HTTP](docs/api.md) précise les routes, unités, dates et états de disponibilité pour les prochains adaptateurs et consommateurs.

Le code et les dessins de cette version sont originaux ; aucun code, sprite ou backend TxStreet n'est repris. Respecter les licences et les droits des ressources si de nouveaux éléments externes sont ajoutés.
