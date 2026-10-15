# BlockLane — observatoire blockchain HEG

Une ville animée pour comprendre Bitcoin et Ethereum : les transactions deviennent des voyageurs, les blocs des transports. Une interprétation originale de l'esprit de [TxStreet](https://github.com/txstreet/txstreet), avec des voyageurs en Canvas 2D natif, une ville SVG, une interface française et un socle conçu pour rester maintenable.

L'application démarre en mode **direct**. Bitcoin et Ethereum sont visibles ensemble dans une ville qui occupe la fenêtre. La démonstration pédagogique est un mode séparé, annoncé à l'écran. Une source indisponible ne déclenche jamais une simulation présentée comme réelle.

La composition utilise toute la largeur du desktop : une seule rangée de maisons et de bâtiments HEG au centre, Bitcoin à gauche et Ethereum à droite. De chaque bord vers le centre, les colonnes sont **arrivées, file d'attente, couloir de déplacement, wagons, puis maisons communes**. Les nouveaux voyageurs entrent horizontalement par le bord gauche pour Bitcoin et le bord droit pour Ethereum. Les portes sont du côté des quais extérieurs, à gauche des wagons Bitcoin et à droite des wagons Ethereum ; les trajets ne traversent jamais la chaussée.

L'espace supplémentaire élargit les quais et leurs colonnes, avec des wagons et des personnages gardant leurs proportions. Les grands panneaux restent au-dessus des scènes et la hauteur de leurs lignes est partagée entre les deux réseaux. Le campus se compacte sur les petits écrans. Cette disposition reste non validée pendant la suspension des contrôles décrite dans [docs/validation.md](docs/validation.md).

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

| Réseau   | Source initiale                         | Ce que l'on peut montrer honnêtement                                                                                                                     |
| -------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bitcoin  | API publique mempool.space, remplaçable | Blocs récents, statistiques du mempool observé et échantillon de transactions en attente                                                                 |
| Ethereum | JSON-RPC public PublicNode, remplaçable | Blocs récents, échantillon `pending` lorsqu'il est disponible et compte du pool local si le fournisseur expose `txpool_status` ; sinon compte non mesuré |

Les sources publiques sont partagées et n'offrent ici aucune garantie de disponibilité. Une application publique durable devrait utiliser un contrat fournisseur adapté ou des nœuds administrés. Les données Ethereum ne constituent **pas un mempool mondial exhaustif** : les nœuds ont une vue locale et certaines transactions suivent des canaux privés. Voir les explications de [consensus Ethereum](https://ethereum.org/developers/docs/consensus-mechanisms/pos/) et le contrat [JSON-RPC](https://ethereum.org/developers/docs/apis/json-rpc/).

La scène représente un échantillon borné, pas toutes les transactions du réseau. L'animation illustre les mécanismes ; elle ne prédit pas l'ordre exact d'inclusion ni le prochain bloc. Les frais indiqués sont des observations ou des estimations, jamais une garantie d'inclusion.

Depuis la correction du 15 octobre 2026, les projections utilisent la **taille des transactions et la capacité du bloc**, et non un budget de 96 unités. Bitcoin additionne les tailles virtuelles en vBytes face à une capacité de 1 000 000 vBytes. Ethereum additionne les limites de gas déclarées face au `gasLimit` du dernier bloc observé : c'est une estimation prudente, distincte du gas effectivement consommé. Une capacité Ethereum absente reste inconnue. Les 96 emplacements dessinés, sur huit colonnes et douze rangées, servent uniquement à répartir les personnages ; ils peuvent se superposer et ne limitent plus le nombre de transactions embarquées.

La plaque **`N TX · ≈P %` à l'arrière** donne le nombre d'identifiants uniques représentés à bord et la part de capacité consommée par leurs seules tailles estimées ; les réservations encore hors du wagon sont exclues du pourcentage. Pendant la préparation et le départ du premier wagon, le pourcentage devient celui du **bloc réel complet**, calculé par `Block.used / Block.capacity` et lié au hash du départ, y compris pour un bloc intermédiaire retrouvé dans le journal. Le compteur `N TX` reste celui des voyageurs de notre échantillon : les deux valeurs ont alors des périmètres distincts, annoncés dans l'infobulle et le libellé accessible. Une donnée absente affiche `—`, jamais une fausse capacité ni un faux zéro ; un bloc attendu sans métadonnées ne reçoit pas de repli sur les limites de gas des personnages. Le pied de chaque projection montre les ressources et le pourcentage réservés en vBytes ou en gas, avec somme et capacité dans son infobulle. Ce changement reste non validé pendant la suspension des contrôles décrite dans [docs/validation.md](docs/validation.md).

Depuis le 15 octobre 2026, chaque chaîne peut afficher jusqu'à **480 voyageurs en attente**, contre 240 auparavant. La collecte privilégie jusqu'à 480 transactions aux frais élevés et réserve séparément jusqu'à 24 confirmations vérifiées : la réponse reste bornée à 504 transactions. La file comprend seize colonnes et 30 rangées, en conservant les places déjà attribuées ; les observations précédentes peuvent toujours se superposer ou rejoindre le groupe d'attente. Un fournisseur qui expose moins de candidates produit un échantillon plus petit, sans voyageur fictif ajouté en direct. La démonstration utilise 480 transactions en attente et 12 confirmations simulées par chaîne, soit 492 transactions. Le cache reste à trois secondes et cette augmentation n'ajoute aucun appel fournisseur. Le coût de rendu et les nouvelles bornes restent non validés pendant la suspension des tests décrite dans [docs/validation.md](docs/validation.md).

Les voyageurs individuels sont dessinés sur un **Canvas 2D transparent par rue**, à la place de leurs nombreux éléments SVG. Les panneaux et contrôles restent en React ; les bus, portes, phares, textes, maisons et groupes collectifs statiques restent en SVG. Un cache borné de petites images préparées réutilise les têtes, torses et icônes ; les membres et flèches gardent leurs gestes et orientations. Les couleurs des frais et la taille des têtes restent conservées ; les couleurs sont actualisées directement, sans l'ancienne transition CSS de 300 ms. La même horloge pilote la scène, sans boucle d'animation supplémentaire et sans nouvelle dépendance.

Le départ réutilise aussi une image préparée de tous les occupants du premier wagon, avec leurs découpes intérieures, puis déplace cette image avec le véhicule. Il évite ainsi de redessiner chaque voyageur embarqué à chaque image du trajet. Ce cache ajoute au plus une surface d'un million de pixels par rue, limitée à 2 048 pixels par dimension ; il est libéré après le départ ou au démontage. Si sa création échoue, tous les occupants gardent leur dessin individuel. Les voyageurs du quai et du wagon suivant continuent leurs déplacements ordinaires. La préparation d'au moins une seconde, les portes et les preuves d'inclusion gardent leurs règles. Cette optimisation locale reste non validée et son gain n'est pas mesuré pendant la suspension des contrôles.

La sélection reste possible au pointeur et par une commande HTML pour parcourir les transactions, choisir un identifiant et afficher ses détails au clavier. Les voyageurs historiques non suivis restent distincts des transactions sélectionnables. Le dessin reproduit les portes, les zones intérieures et le miroir Bitcoin ; l'échantillon de 480 voyageurs, la grille visuelle de 96 emplacements et les bornes de résidents et d’archives sont conservés. La résolution du Canvas est plafonnée à un ratio de pixels de 2, quatre millions de pixels et 8 192 pixels par dimension ; une indisponibilité de Canvas est annoncée explicitement et les informations HTML restent accessibles.

Les libellés de frais, les formats numériques et les médianes réutilisent leurs calculs lorsque leurs entrées sont inchangées. Les effectifs du panneau sont transmis au plus toutes les 250 ms, séparément des mouvements de la scène à environ 24 images par seconde. Des délais ponctuels conservent l'expiration du cours USD et du pool Ethereum même lorsque la scène reste immobile, sans intervalle ni appel réseau supplémentaire. Le cache API reste à trois secondes. Aucun profilage ni mesure de gain n'est effectué ; la migration Canvas et ces optimisations restent non validées pendant la suspension des contrôles.

Un **grand panneau d'informations** reste visible **en haut de chaque blockchain**, dans son en-tête à la place des métriques statiques, et change de rubrique toutes les **4 secondes** : Mempool, Frais médians, Bloc, Valeur et Voyageurs. Le même panneau se compacte selon l'écran ; il laisse le décor SVG, la chaussée et le quai disponibles pour la scène. Les rubriques et la pause du défilement restent accessibles manuellement. La pause générale, les mouvements réduits, une sélection, un onglet masqué ou une source ancienne ou indisponible arrêtent la rotation ; ils ne transforment pas les observations en données nouvelles. Le panneau de détails conserve également sa sélection et propose ses pages avec ce rythme de quatre secondes. Les lectures et le cache de l'API blockchain restent à **3 secondes**.

La rubrique **Valeur** affiche le total du dernier bloc en **BTC ou ETH**, indépendamment du switch des frais, avec un équivalent USD approximatif secondaire lorsqu'un cours utilisable est disponible. Ce total couvre le bloc complet, pas uniquement les voyageurs de l'échantillon. Bitcoin utilise `totalOutputAmt` des statistiques mempool.space : somme des sorties hors transaction coinbase, **monnaie rendue incluse**, sans mesurer un transfert économique net. Ethereum additionne les champs `value` déclarés de toutes les transactions du bloc : les tokens, mouvements internes et frais sont exclus, et la valeur d'une transaction échouée peut être incluse faute de lecture des reçus. Les sommes sont conservées exactement en satoshis ou wei, comme chaînes décimales calculées avec `BigInt`, et liées au hash, à la hauteur et au nombre de transactions du dernier bloc. Une donnée absente ou incohérente affiche **non mesurée**, jamais zéro par défaut ; la démonstration ne reçoit aucun total réel inventé. L'équivalent USD utilise le cours spot reçu, pas un cours historique du bloc. Cette mesure réutilise les fournisseurs existants sans nouveau service réseau.

La rubrique **Mempool** montre le nombre de transactions dans la vue locale du **fournisseur observé**, distinct du nombre de voyageurs de notre échantillon. Elle ne concerne pas un nœud installé sur le Mac et ne prétend pas donner un total mondial. Bitcoin utilise le compte communiqué par mempool.space. Ethereum demande facultativement `txpool_status` et additionne les catégories `pending` et `queued`, avec leur détail et une heure d'observation propre. Cette lecture se fait en arrière-plan, au plus une tentative toutes les 30 secondes après la précédente, sans attendre sa réponse pour servir les données blockchain. En cas de panne, le dernier compte est signalé comme ancien et conservé au plus 120 secondes ; passé ce délai, ou si la méthode n'est pas disponible, la valeur devient **non mesurée**. Un compte inconnu n'est jamais remplacé par la taille de l'échantillon ou par un faux zéro. La démonstration distingue ses valeurs simulées du direct. Voir [le contrat HTTP](docs/api.md) pour les champs et limites.

Une **file globale · fournisseur** reste visible en bas de chaque rue, sous la scène et au-dessus de sa couverture. Elle représente collectivement tout le compte local fourni, avec son total exact, sa provenance et le détail `pending + queued` pour Ethereum. « Globale » décrit ici la file complète de ce fournisseur, jamais l'ensemble du réseau. Jusqu'à 48 petites silhouettes sont dessinées par chaîne, avec une échelle commune Bitcoin/Ethereum choisie parmi `1, 2, 5 × 10ⁿ` pour contenir le plus grand total affiché ; la dernière silhouette représente seulement le reste éventuel. L'échelle est annoncée explicitement. Ces groupes statiques n'ont ni identifiants ni frais individuels et ne participent pas aux trajets ou confirmations des voyageurs. Un vrai zéro affiche une file vide ; un compte absent ou expiré reste indisponible, tandis que simulation et ancien relevé restent signalés. La scène garde son échantillon de 480 voyageurs et ses anciennes observations séparées. Cette présentation réutilise les données reçues, sans nouvelle API, horloge ou dépendance, et reste non validée pendant la suspension des contrôles.

Les t-shirts passent du jaune pour les frais faibles à l'orange à la moyenne, puis au rouge à partir de deux fois la moyenne des voyageurs en attente affichés sur la même blockchain. Cette moyenne concerne notre échantillon visible, pas tout le réseau.

Les wagons ont des phares avant blanc chaud qui s'allument avant le départ, dès la préparation, et des feux arrière rouges pendant la fin de l'arrivée. Ces lumières suivent les phases de l'animation ; la pause conserve leur état et les mouvements réduits restent statiques.

Avant le départ, le premier wagon attend **au moins une seconde de préparation à vitesse normale**. Les passages partagent cette échéance : sorties accélérées de 500 ms au maximum, puis embarquement avec le temps restant pour les voyageurs venant du second wagon. Une sortie déjà engagée est accélérée depuis sa position, sans recommencer son chemin. Le départ attend toujours que toutes les inclusions connues soient à bord et les autres voyageurs hors du premier wagon. Une preuve reçue tardivement garde un passage minimal de 50 ms et peut prolonger l'arrêt ; la pause et la vitesse s'appliquent à cette horloge d'animation.

Chaque chaîne affiche **« Depuis départ »** dans une ligne fixe sous le grand panneau de son en-tête, quelle que soit la rubrique affichée : le temps réel écoulé depuis le début du dernier départ animé dans cette session. Le compteur avance indépendamment de la pause et de la vitesse ; ce n'est ni l'âge du bloc ni un compte à rebours avant le suivant. Il reste à `—` avant le premier départ, y compris lorsque les mouvements réduits appliquent les confirmations sans trajet. Une animation de rattrapage remet aussi ce compteur à zéro. Une indisponibilité temporaire conserve le dernier départ connu ; un rechargement ou un changement direct / démonstration réinitialise le compteur. En démonstration, il concerne uniquement les départs simulés. Cette présentation n'ajoute aucune requête API et conserve le cache existant.

Les en-têtes et la page Réseau du panneau affichent les **frais médians par transaction** de l'échantillon courant en attente. Le coût estimé de chaque transaction est calculé d'abord, puis la médiane est prise sur ces montants ; avec un effectif pair, elle est la moyenne des deux valeurs centrales. Le nombre de transactions retenues est indiqué. Cette sélection priorise les frais élevés, avec jusqu'à 480 transactions par chaîne ou un repli Bitcoin sur les transactions récentes : elle ne représente pas la médiane du réseau. Les transactions confirmées et les anciennes observations conservées dans la scène sont exclues ; un échantillon absent affiche `—`.

Une commande commune permet d'afficher cette médiane en **BTC ou ETH par transaction**, ou en **dollars américains par transaction**, avec le signe `≈`. Les taux conseillés Bitcoin et la base fee Ethereum restent consultables dans les détails de la page Réseau. En USD, le détail et l'infobulle d'un voyageur donnent aussi un montant total estimé. Pour Ethereum, le calcul utilise le prix du gas observé, pourboire inclus lorsqu'il fait partie de ce prix, multiplié par la limite de gas déclarée ; il ne représente ni le gas réellement consommé ni les frais réellement payés. Les taux arrondis fournis par les adaptateurs rendent les coûts approximatifs. Le classement et les couleurs utilisent toujours les taux natifs.

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
