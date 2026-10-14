# Contrat HTTP de lecture

L'API est servie sur le même domaine que l'interface. Aucune route ne signe, ne diffuse ni ne modifie une transaction. Le schéma dans `shared/model.ts` est la référence exécutable.

## Routes

| Route                                        | Réponse                                                                  | Portée                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `GET /api/health`                            | `{ "status": "ok", "service": "blockchain-observer", "readOnly": true }` | Le serveur répond ; ne certifie pas les fournisseurs ni la fraîcheur |
| `GET /api/snapshot?chain=bitcoin&mode=live`  | Instantané normalisé                                                     | Données Bitcoin directes                                             |
| `GET /api/snapshot?chain=ethereum&mode=live` | Instantané normalisé                                                     | Données Ethereum directes                                            |
| `GET /api/snapshot?chain=bitcoin&mode=demo`  | Instantané pédagogique                                                   | Simulation annoncée, sans appel upstream                             |

`chain` accepte `bitcoin` ou `ethereum`, avec `bitcoin` par défaut. `mode` accepte `live` ou `demo`, avec `live` par défaut. Une chaîne invalide, un paramètre inconnu ou un paramètre répété est rejeté. Seul `GET` est accepté sur l'API.

La réponse d'instantané reste HTTP 200 lorsqu'une source est indisponible : l'état métier se lit dans `status`. Les erreurs de requête utilisent notamment 400, les méthodes interdites 405, les dépassements de débit 429 avec `Retry-After`, et les erreurs internes 500. Les réponses JSON ne sont pas mises en cache par le navigateur ; le serveur mutualise lui-même les appels upstream.

La limite API est de 120 requêtes par minute par client par défaut, configurable côté serveur. Derrière un proxy fiable explicitement déclaré, l'adresse cliente peut provenir de `X-Real-IP` ; les détails et précautions figurent dans `SECURITY.md`. Un consommateur doit respecter `Retry-After` et éviter des relances rapprochées.

## Instantané

| Champ          | Type / unités                  | Signification                                                                               |
| -------------- | ------------------------------ | ------------------------------------------------------------------------------------------- |
| `chain`        | `bitcoin` / `ethereum`         | Réseau représenté                                                                           |
| `mode`         | `live` / `demo`                | Provenance réelle ou pédagogique                                                            |
| `status`       | `ok` / `stale` / `unavailable` | Fraîcheur du résultat                                                                       |
| `source`       | Texte borné                    | Libellé de provenance ; aucune URL privée ni clé                                            |
| `observedAt`   | Millisecondes Unix             | Date de collecte ; conservée pour un résultat ancien                                        |
| `coverage`     | Texte borné                    | Limites de la vue fournie                                                                   |
| `pendingCount` | Entier sûr ou `null`           | Total du mempool local du fournisseur observé, lorsque disponible ; `null` signifie inconnu |
| `mempool`      | Objet facultatif ou `null`     | Détail du comptage local Ethereum, avec sa propre date et fraîcheur                         |
| `feeRate`      | Nombre ou `null`               | Mesure ou estimation décrite dans l'interface                                               |
| `feeUnit`      | `sat/vB` / `Gwei`              | Unité correspondant à la chaîne                                                             |
| `usdQuote`     | Objet facultatif ou `null`     | Cours de conversion USD indépendant de la source blockchain                                 |
| `transactions` | Tableau, maximum 120           | Échantillon ; jamais une liste exhaustive promise                                           |
| `blocks`       | Tableau, maximum 3             | Blocs récents observés                                                                      |
| `inclusions`   | Tableau facultatif, maximum 16 | Journal roulant des inclusions vérifiées d'identifiants suivis                              |
| `message`      | Texte facultatif               | Explication d'une limite ou d'un incident                                                   |

Une transaction possède un identifiant, sa chaîne, une taille, un taux de frais, `pending` ou `confirmed`, un type `transfer` ou `contract`, et une valeur textuelle. Les nombres doivent être finis et non négatifs. Les transactions d'un instantané doivent appartenir à sa chaîne. Le champ facultatif `blockHash` porte une preuve d'inclusion dans ce bloc ; une transaction `pending` ne peut pas le porter. Une ancienne confirmation sans hash reste lisible, mais ne prouve pas l'appartenance au départ animé.

Un bloc possède une hauteur, un hash, un `timestamp` en **secondes Unix**, un nombre de transactions, une capacité et une utilisation. La capacité s'exprime en octets virtuels pour Bitcoin et en gas pour Ethereum. L'utilisation ne peut pas dépasser la capacité déclarée. Ne pas confondre `timestamp` et `observedAt` lors d'une conversion de date.

Un instantané `unavailable` n'a ni bloc, ni transaction, ni entrée d'inclusion à animer, ni objet `mempool` non nul. Une démonstration a le statut `ok` et ne représente jamais la disponibilité upstream. L'adaptateur Ethereum distingue les transactions du bloc en attente de celles des blocs confirmés ; le client ne doit pas modifier cette sémantique pour les faire apparaître comme des voyageurs en attente.

## Comptage du mempool du fournisseur

En direct Bitcoin, `pendingCount` reprend le compteur validé de `/mempool` du fournisseur configuré. Ce total local ne se déduit pas du nombre de voyageurs visibles. En direct Ethereum, il vaut la somme **pending + queued** renvoyée par la méthode facultative `txpool_status` du RPC configuré. Les transactions `queued` sont conservées pour une exécution future et ne sont pas nécessairement admissibles au prochain bloc. Ce champ n'annonce jamais un total mondial du réseau. Un bloc candidat `pending` et son échantillon ne servent jamais de remplacement à un comptage indisponible.

Le champ facultatif nullable `mempool` détaille une observation Ethereum :

| Champ        | Type / borne                               | Signification                                                    |
| ------------ | ------------------------------------------ | ---------------------------------------------------------------- |
| `pending`    | Entier sûr non négatif                     | Transactions localement en attente d'inclusion                   |
| `queued`     | Entier sûr non négatif                     | Transactions localement en file pour une exécution future        |
| `observedAt` | Entier sûr non négatif, millisecondes Unix | Heure de réception du comptage, distincte de la collecte du bloc |
| `status`     | `ok` / `stale`                             | Comptage reçu ou dernière valeur conservée                       |
| `method`     | `txpool_status`                            | Capacité RPC à l'origine de ce comptage                          |

La somme doit elle aussi rester un entier sûr et correspondre exactement à `pendingCount`. Le contrat réserve un objet `mempool` non nul à Ethereum en mode `live` ; les instantanés Bitcoin, les anciennes versions du contrat et la démonstration peuvent l'omettre. Le total pédagogique de démonstration ne devient pas une observation RPC.

Le service lance la collecte en arrière-plan après validation de la chaîne principale et du dernier bloc, sur le même RPC serveur. Une seule requête peut être en cours, avec **30 secondes minimum après chaque tentative**, délai de huit secondes et réponse limitée à **64 Kio**. Les compteurs RPC doivent être des quantités hexadécimales complètes et valides, puis sont convertis en entiers sûrs ; une réponse invalide, un refus ou une méthode non prise en charge ne produit aucun zéro inventé. Une lecture utilise immédiatement un dernier comptage utilisable ou `null`, sans attendre cette méthode facultative ; le prochain instantané peut récupérer une collecte terminée depuis.

La dernière valeur est signalée `stale` après un échec ou lorsqu'elle dépasse 30 secondes. Elle reste utilisable au plus **120 secondes depuis `mempool.observedAt`**, puis `mempool` et `pendingCount` deviennent `null`. La fraîcheur de ce comptage est indépendante de `Snapshot.observedAt` et `Snapshot.status` : une panne de cette capacité ne rend pas les blocs anciens ou indisponibles. Un consommateur doit également tenir compte de l'âge propre du comptage, notamment lorsque l'instantané blockchain conservé vieillit. Le cache est partagé entre les visiteurs d'une même instance, volatile et distinct de la collecte blockchain de trois secondes. Le transport et l'horloge injectés dans l'adaptateur s'appliquent aussi à cette méthode ; les futures fixtures doivent simuler son résultat ou son indisponibilité, sans dépendre d'un RPC public.

Sources : [méthode Geth `txpool_status`](https://geth.ethereum.org/docs/interacting-with-geth/rpc/ns-txpool#txpool-status), [implémentation Geth des compteurs hexadécimaux](https://github.com/ethereum/go-ethereum/blob/master/internal/ethapi/api.go).

## Journal d'inclusions

Chaque entrée facultative `inclusions` possède la forme `BlockInclusions = { block: Block, transactionIds: string[] }`. Elle contient uniquement des identifiants déjà observés par le service, dont la présence a été vérifiée dans ce hash de bloc. Une entrée vide signifie que le bloc a été vérifié sans retrouver d'identifiant suivi ; l'absence d'une entrée ne signifie pas que la vérification a réussi. Le journal ne remplace pas les tableaux `transactions` et `blocks` et ne fournit pas la liste exhaustive des transactions du bloc.

Le contrat limite le journal à **16 blocs et 2 048 identifiants au total**, avec au plus 2 048 identifiants dans une entrée. Les identifiants sont uniques dans chaque entrée, les hashes et les hauteurs de blocs sont uniques dans le journal. Si une hauteur existe aussi dans `blocks`, son hash doit être identique ; les autres blocs historiques restent autorisés. En direct, hashes et identifiants d'inclusion suivent les formats de la chaîne : 64 caractères hexadécimaux pour Bitcoin, `0x` suivi de 64 caractères hexadécimaux pour Ethereum. Aucun identifiant pédagogique `demo-` ne peut apparaître dans le direct.

Le serveur suit au plus 2 048 identifiants pendant 30 minutes depuis leur dernière observation. Pendant une collecte, il peut conserver temporairement 2 048 observations anciennes et 96 nouvelles avant de vérifier puis ramener le suivi à sa limite. Le rattrapage examine au plus huit blocs par collecte. Une lacune dont la vérification échoue reste à réessayer ; elle n'est pas déclarée confirmée par défaut. Les mêmes preuves peuvent être renvoyées à plusieurs rafraîchissements et plusieurs visiteurs : le consommateur doit dédupliquer par hash et identifiant, sans consommer le journal pour les autres clients.

Le suivi et le journal sont volatiles. Un redémarrage, une expiration, une éviction ou une interruption dépassant les bornes peut empêcher de retrouver une observation ancienne. Les preuves incompatibles avec une réorganisation sont invalidées ; une inclusion observée n'est pas une garantie de finalité. Le client initialise le journal reçu au premier chargement sans rejouer les départs historiques. Une preuve complémentaire illustrée après un départ est un rattrapage pour ce même hash, pas un nouveau bloc.

Les sources de lecture sont documentées par [Esplora](https://github.com/Blockstream/esplora/blob/master/API.md#get-blockhashtxids), les [routes Bitcoin mempool.space](https://github.com/mempool/mempool/blob/master/backend/src/api/bitcoin/bitcoin.routes.ts) et l'[API JSON-RPC Ethereum](https://ethereum.org/developers/docs/apis/json-rpc/).

## Cours facultatif et affichage USD

`usdQuote` peut être absent ou `null` lorsqu'aucun cours utilisable n'est disponible. Lorsqu'il est présent :

| Champ        | Type / borne                                 | Signification                                                                          |
| ------------ | -------------------------------------------- | -------------------------------------------------------------------------------------- |
| `usdPerCoin` | Nombre positif fini, au plus `1_000_000_000` | Dollars américains pour un BTC ou un ETH selon `chain`                                 |
| `observedAt` | Entier sûr non négatif, millisecondes Unix   | Heure de réception du cours, distincte de la collecte blockchain et du temps de marché |
| `source`     | `Coinbase`                                   | Provenance de la conversion                                                            |
| `status`     | `ok` / `stale`                               | Cours reçu ou ancien cours conservé                                                    |

Le serveur utilise les routes publiques fixes Coinbase BTC/USD et ETH/USD, avec cache partagé de 60 secondes après chaque tentative, une requête simultanée au plus par chaîne, délai de huit secondes et réponse limitée à 16 Kio. Il valide la devise USD, la base attendue et un montant décimal borné avant conversion. La collecte s'effectue en arrière-plan : la réponse utilise immédiatement un cours valide déjà disponible ou `null`, sans attendre le renouvellement. Une lecture suivante peut fournir le nouveau cours. Un cours ancien ne reste utilisable que cinq minutes depuis sa réception, puis `usdQuote` devient `null`. Une erreur de cours ne modifie pas `Snapshot.status`, qui concerne la blockchain ; même une chaîne indisponible peut porter un cours valide. La démonstration ne collecte aucun cours et le contrat rejette un cours non nul en mode `demo`.

`feeRate` et `feeUnit` restent natifs : le switch de l'interface n'altère pas le contrat ou le classement des transactions. Ce champ d'instantané conserve son sens de taux conseillé Bitcoin ou de base fee du dernier bloc Ethereum ; il ne devient pas une médiane. La conversion d'un taux donne des USD/vB pour Bitcoin et des USD/gas pour Ethereum. En USD, les détails et infobulles de transaction donnent un total estimé marqué `≈` :

- Bitcoin : `feeRate * size * usdPerCoin / 100_000_000`, avec `size` en vB.
- Ethereum : `feeRate * size * usdPerCoin / 1_000_000_000`, avec `size` comme limite de gas déclarée.

La formule Ethereum ne fournit pas le gas consommé ni les frais réellement payés ; aucun reçu d'exécution n'est ajouté. La conversion utilise le cours relevé, jamais un cours supposé à la date du bloc. La source, la date et la conservation d'un cours ancien sont signalées ; un cours absent, invalide ou trop ancien rend la conversion indisponible, sans zéro inventé. Le mode démonstration n'utilise aucun prix fictif. Sources : [cours spot Coinbase](https://docs.cdp.coinbase.com/coinbase-app/track-apis/prices), [gas et Gwei Ethereum](https://ethereum.org/developers/docs/gas/).

## Frais médians par transaction dans l'interface

La métrique des en-têtes et de la page Réseau est calculée côté interface sur les seules transactions `pending` du tableau `transactions` reçu, appartenant à la chaîne affichée. Les identifiants sont dédupliqués et les valeurs non finies, négatives ou de taille nulle sont exclues. Les transactions `confirmed`, le journal d'inclusions et les observations historiques conservées dans la scène ne participent pas au calcul. Aucun champ d'API ni appel fournisseur supplémentaire n'est nécessaire.

Le calcul porte sur le **coût estimé de chaque transaction**, puis sur la médiane des coûts triés :

- Bitcoin : `feeRate * size / 100_000_000` BTC, avec `size` en vB.
- Ethereum : `feeRate * size / 1_000_000_000` ETH, avec `size` comme limite de gas déclarée.
- Effectif impair : valeur centrale ; effectif pair : moyenne des deux valeurs centrales.
- Conversion USD : médiane en BTC ou ETH multipliée par le cours `usdPerCoin` valide de cette chaîne.

Ce calcul n'est pas le produit de la médiane des taux et de la médiane des tailles. Le prix Ethereum propre à chaque transaction inclut le pourboire lorsqu'il fait partie du prix observé ; la mention « sans pourboire » ne s'applique qu'à la base fee du bloc, conservée comme détail secondaire. L'utilisation de la limite de gas et des taux arrondis interdit de présenter cette métrique comme des frais réellement payés.

L'effectif retenu accompagne la métrique. L'échantillon priorise jusqu'à 96 transactions aux frais élevés dans la projection du fournisseur, ou les seules transactions récentes dans le repli Bitcoin. Cette sélection est biaisée : sa médiane n'est ni celle du mempool entier ni celle de tous les blocs du réseau. L'interface affiche `≈` avec BTC/ETH par transaction ou USD par transaction selon le switch. Un échantillon vide ou absent donne `—` ; un cours absent ou expiré ne produit pas une médiane USD fictive à zéro. Les états ancien, indisponible et démonstration restent distincts.

## Évolution du contrat

Toute modification affectant une unité, le sens d'un champ, un état ou les capacités d'une chaîne doit mettre à jour schéma, fixtures, tests adaptateur, tests HTTP, interface et documentation dans la même proposition. Ajouter un champ facultatif peut être compatible ; changer silencieusement des secondes en millisecondes ou remplacer `null` par un zéro inventé ne l'est pas.

L'API actuelle est interne à l'application, sans engagement de stabilité externe. Avant d'en faire une API publique documentée pour des tiers, définir son versionnement, ses règles de débit et la durée de compatibilité des consommateurs.
