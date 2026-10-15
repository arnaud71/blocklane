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

| Champ              | Type / unités                  | Signification                                                                               |
| ------------------ | ------------------------------ | ------------------------------------------------------------------------------------------- |
| `chain`            | `bitcoin` / `ethereum`         | Réseau représenté                                                                           |
| `mode`             | `live` / `demo`                | Provenance réelle ou pédagogique                                                            |
| `status`           | `ok` / `stale` / `unavailable` | Fraîcheur du résultat                                                                       |
| `source`           | Texte borné                    | Libellé de provenance ; aucune URL privée ni clé                                            |
| `observedAt`       | Millisecondes Unix             | Date de collecte ; conservée pour un résultat ancien                                        |
| `coverage`         | Texte borné                    | Limites de la vue fournie                                                                   |
| `pendingCount`     | Entier sûr ou `null`           | Total du mempool local du fournisseur observé, lorsque disponible ; `null` signifie inconnu |
| `mempool`          | Objet facultatif ou `null`     | Détail du comptage local Ethereum, avec sa propre date, méthode et fraîcheur                |
| `sampling`         | Objet facultatif ou `null`     | Provenance et date d’une lecture complète utilisée pour sélectionner le top frais local     |
| `feeRate`          | Nombre ou `null`               | Mesure ou estimation décrite dans l'interface                                               |
| `feeUnit`          | `sat/vB` / `Gwei`              | Unité correspondant à la chaîne                                                             |
| `usdQuote`         | Objet facultatif ou `null`     | Cours de conversion USD indépendant de la source blockchain                                 |
| `latestBlockValue` | Objet facultatif ou `null`     | Agrégat natif du dernier bloc complet, lié à son hash et à sa hauteur                       |
| `transactions`     | Tableau, maximum 504           | Échantillon ; jamais une liste exhaustive promise                                           |
| `blocks`           | Tableau, maximum 3             | Blocs récents observés                                                                      |
| `inclusions`       | Tableau facultatif, maximum 16 | Journal roulant des inclusions vérifiées d'identifiants suivis                              |
| `message`          | Texte facultatif               | Explication d'une limite ou d'un incident                                                   |

Une transaction possède un identifiant, sa chaîne, une taille, un taux de frais, `pending` ou `confirmed`, un type `transfer` ou `contract`, et une valeur textuelle. Les nombres doivent être finis et non négatifs. Les transactions d'un instantané doivent appartenir à sa chaîne. Le champ facultatif `blockHash` porte une preuve d'inclusion dans ce bloc ; une transaction `pending` ne peut pas le porter. Une ancienne confirmation sans hash reste lisible, mais ne prouve pas l'appartenance au départ animé.

`Tx.size` s'exprime en **vBytes pour Bitcoin** et en **limite de gas déclarée pour Ethereum**. Le champ Ethereum n'est ni une taille en octets, ni le gas réellement consommé, y compris pour les transactions confirmées : le consommateur ne doit pas additionner ces limites en prétendant mesurer l'utilisation réelle d'un bloc. Le gas consommé du bloc complet est disponible séparément dans `Block.used`. La capacité mesurée concerne le gas d'exécution ; le contrat ne mesure pas les ressources de blobs.

La limite partagée du tableau `transactions` passe de 264 à **504 objets** le 15 octobre 2026. Les adaptateurs retiennent jusqu'à **480 transactions en attente** aux frais les plus élevés dans la vue disponible du fournisseur et réservent jusqu'à **24 confirmations** séparément, sans les compter dans cette sélection. Le journal d'inclusions garde ses propres bornes. Un effectif inférieur fourni en amont reste inférieur : aucun complément simulé ni parcours supplémentaire ne remplit la limite en direct. La démonstration contient 480 transactions en attente et 12 confirmations fictives par chaîne, soit 492 transactions. L'augmentation seule n'ajoute aucun appel fournisseur ; le mode complet facultatif décrit ci-dessous ajoute sa propre collecte en arrière-plan. Le cache blockchain reste à trois secondes. Cette modification de borne et ses consommateurs restent non validés pendant la suspension demandée des tests et contrôles ; les anciennes fixtures devront être adaptées à leur reprise.

Un bloc possède une hauteur, un hash, un `timestamp` en **secondes Unix**, un nombre de transactions, une capacité et une utilisation. La capacité s'exprime en octets virtuels pour Bitcoin et en gas pour Ethereum. L'utilisation ne peut pas dépasser la capacité déclarée. Ne pas confondre `timestamp` et `observedAt` lors d'une conversion de date.

Depuis la correction du 15 octobre 2026, le consommateur utilise ces ressources pour les wagons. Une projection Bitcoin additionne les tailles virtuelles face à **1 000 000 vBytes** ; une projection Ethereum additionne les limites de gas déclarées face au `Block.capacity` du dernier bloc disponible, qui reprend son `gasLimit`. Cette capacité n'annonce pas celle du prochain bloc ; absente, elle reste inconnue, sans budget artificiel de repli. Une taille nulle n'est pas admise dans la projection. Le pourcentage projeté concerne les seuls voyageurs embarqués de l'échantillon et porte le signe `≈`. Dès la préparation d'un départ vérifié, son pourcentage utilise au contraire `Block.used / Block.capacity` du **bloc complet associé au hash de ce départ**, qu'il vienne de `blocks` ou de `inclusions[].block`. Son compteur de transactions conserve le périmètre de l'échantillon. Un journal plus récent ne doit pas substituer son dernier bloc à celui du véhicule en départ ; des métadonnées absentes pour ce bloc donnent un pourcentage indisponible, sans repli sur les tailles des voyageurs. Cette interprétation réutilise les champs existants, sans changement de schéma, reçu Ethereum ni requête supplémentaire, et reste non validée pendant la suspension des contrôles.

Un instantané `unavailable` n'a ni bloc, ni transaction, ni entrée d'inclusion à animer, ni objet `mempool`, `sampling` ou `latestBlockValue` non nul. Une démonstration a le statut `ok`, ne représente jamais la disponibilité upstream et ne peut porter un agrégat réel `latestBlockValue` non nul. L'adaptateur Ethereum distingue les transactions du bloc en attente de celles des blocs confirmés ; le client ne doit pas modifier cette sémantique pour les faire apparaître comme des voyageurs en attente.

## Provenance du classement complet des frais

Le 15 octobre 2026, `Snapshot.sampling` ajoute un objet **facultatif nullable**, réservé au direct exploitable, pour distinguer un classement issu d'une observation complète du fournisseur des replis sur une projection ou des transactions récentes :

| Champ          | Type / borne                                         | Signification                                                                                   |
| -------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `method`       | `getrawmempool` / `txpool_content`                   | Lecture Bitcoin ou Ethereum ; méthode cohérente avec `chain`                                    |
| `source`       | Texte de 1 à 100 caractères                          | Libellé du fournisseur du pool, sans URL privée ni secret                                       |
| `observedAt`   | Entier sûr non négatif, millisecondes Unix           | Date propre du relevé complet ou du dernier inventaire Bitcoin réconcilié avec succès           |
| `pendingCount` | Entier sûr de 0 à 100 000 Bitcoin ou 50 000 Ethereum | Nombre complet d'entrées `pending` observées avant sélection                                    |
| `queuedCount`  | Requis pour Ethereum, entier sûr non négatif         | Entrées `queued` Ethereum, exclues des voyageurs ; somme `pending + queued` ≤ 50 000            |
| `update`       | Requis pour Bitcoin : `full` / `incremental`         | Chargement complet du pool ou réconciliation d'identifiants avec métadonnées des seuls nouveaux |

Bitcoin sélectionne les meilleurs taux `frais de base / (weight / 4)` de sa table de pool complète, indépendamment des ajustements de politique `vsize`. Une première lecture `getrawmempool(true)` construit cette table ; les suivantes utilisent `getrawmempool(false, true)`, avec identifiants et numéro de séquence validé sous huit Mio, retirent les identifiants disparus et demandent `getmempoolentry` uniquement pour les nouveaux. Au plus 500 ajouts sont traités par cycle, par lots de 25, deux simultanés au plus, réponses de 128 Kio maximum et budget total de huit secondes pour le cycle Bitcoin entier ; une lecture complète est refaite après dix minutes, ou après invalidité, mauvais réseau ou perte de la base validée. Erreur ou dépassement invalide le top complet public de cette tentative et déclenche le repli ; une donnée manquante ne peut être présentée comme un classement complet. Après échec incrémental réseau, HTTP, RPC, timeout ou de volume, l'index privé antérieur reste disponible jusqu'à l'échéance de dix minutes pour retenter les identifiants et nouveaux détails après 30 secondes. Aucune métadonnée partielle n'est retenue. Une donnée invalide, un mauvais réseau, une erreur de chargement initial, une horloge incohérente ou une base expirée effacent l'index et imposent une base complète à la tentative suivante. Les appels ne sont pas atomiques et la disparition d'un identifiant ne prouve aucune confirmation. Les blocs, frais conseillés et preuves restent issus séparément de mempool.space, ce que `source` et `coverage` doivent annoncer. `Snapshot.pendingCount` reprend alors le compte du même relevé RPC, avec sa date propre, distincte de celle du bloc.

Ethereum trie uniquement les transactions `pending` éligibles à la base fee observée, par prix effectif calculé exactement en wei avant arrondi en Gwei. Les `queued` sont comptées dans `sampling` mais ne sont pas admises aux wagons. Un simple filtre d'arrivées ne couvre pas les retraits, évictions et catégories `queued` : les lectures complètes `txpool_content` restent renouvelées, plutôt qu'un classement incrémental incomplet. Les comptes de `Snapshot.mempool` restent indépendants, issus de `txpool_status` à leur propre date. Les nonces, paquets, choix du producteur et changements depuis le relevé interdisent de promettre les prochaines inclusions. Le classement concerne le **taux natif par ressource**, jamais le montant total payé en dollars.

Le serveur transmet seulement le top 480, ses comptes et ses métadonnées après classement. Bitcoin conserve une table compacte bornée à 100 000 entrées pour les réconciliations ; Ethereum conserve au plus 30 secondes une forme compacte des candidates `pending` pour reclasser leurs prix effectifs à la base fee courante, sous un plafond de 50 000 entrées `pending + queued` reçues. Le corps RPC original n'est ni exposé aux visiteurs ni conservé durablement comme inventaire. Une seule collecte facultative peut être en cours par chaîne ; elle s'exécute en arrière-plan avec **30 secondes minimum après sa fin**, huit secondes de délai maximal par requête et **32 Mio** au plus. Le plafond ordinaire de deux Mio des autres routes upstream, le cache blockchain de trois secondes et les 504 transactions maximales de la réponse restent inchangés. Bitcoin espace les réessais de 30 secondes après un échec ; Ethereum attend 60 secondes, ou cinq minutes après un refus RPC. Le trafic, la désérialisation et la table en mémoire ajoutent un coût serveur, sans service, dépendance ou stockage durable supplémentaire.

Le champ ne permet de parler de classement complet que tant que le relevé est exploitable et âgé d'au plus **30 secondes** ; les consommateurs doivent comparer sa date propre à l'heure courante, même dans un instantané blockchain conservé. Une lecture invalide, trop volumineuse, tronquée, refusée ou expirée n'autorise pas un top complet partiel. Le champ devient absent ou `null` et la couverture décrit le repli : premier bloc projeté puis transactions récentes Bitcoin, bloc candidat `pending` Ethereum si disponible. L'absence ne signifie pas que le pool est vide. La démonstration et un instantané indisponible ne peuvent porter un relevé complet réel. Ce champ reste facultatif pour les anciens producteurs et consommateurs.

Le suivi des 2 048 identifiants et les preuves d'inclusion restent limités aux transactions échantillonnées, sans promettre de suivi individuel du pool complet. Sources : [Bitcoin Core `getrawmempool`](https://bitcoincore.org/en/doc/30.0.0/rpc/blockchain/getrawmempool/), [`getmempoolentry`](https://bitcoincore.org/en/doc/30.0.0/rpc/blockchain/getmempoolentry/), [Geth `txpool_content`](https://geth.ethereum.org/docs/interacting-with-geth/rpc/ns-txpool#txpool-content), [abonnements Geth](https://geth.ethereum.org/docs/interacting-with-geth/rpc/pubsub). Ce nouveau contrat reste non validé pendant la suspension des contrôles ; un essai manuel autorisé ne valide ni sa robustesse ni son coût.

## Valeur native du dernier bloc

`latestBlockValue`, facultatif et nullable, décrit un agrégat du **dernier bloc complet `blocks[0]`**, indépendamment du nombre de passagers affichés :

| Champ              | Type / borne                                            | Signification                                                                                  |
| ------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `blockHash`        | Hash de chaîne                                          | 64 caractères hexadécimaux Bitcoin, ou `0x` suivi de 64 caractères hexadécimaux Ethereum       |
| `blockHeight`      | Entier sûr non négatif                                  | Hauteur du bloc agrégé                                                                         |
| `amount`           | Chaîne décimale entière canonique, 1 à 83 chiffres      | Montant exact non négatif en unités minimales ; aucun nombre flottant dans ce champ            |
| `unit`             | `sat` / `wei`                                           | Satoshis Bitcoin ou wei Ethereum                                                               |
| `method`           | `bitcoin-output-sum` / `ethereum-transaction-value-sum` | Définition propre à la chaîne, liée à `unit` par le schéma                                     |
| `transactionCount` | Entier sûr non négatif                                  | Nombre complet de transactions du bloc, coinbase Bitcoin comprise même si sa valeur est exclue |
| `observedAt`       | Entier sûr non négatif, millisecondes Unix              | Date de collecte de cet agrégat                                                                |

Le contrat lie strictement unité, méthode et chaîne, puis impose le même hash, la même hauteur et le même compte que `blocks[0]`. Le champ non nul est réservé au mode `live` et ne peut apparaître sur un instantané indisponible. Un instantané `stale` conserve cet agrégat du bloc observé et sa date ; il ne représente pas une collecte nouvelle. La forme facultative reste compatible avec les anciens producteurs et consommateurs.

**Bitcoin.** L'adaptateur reprend `extras.totalOutputAmt` du bloc enrichi déjà renvoyé par `/v1/blocks`. Ce champ vient de `getblockstats.total_out` : somme de toutes les sorties des transactions **hors coinbase**, donc hors récompense de bloc, et incluant la monnaie rendue aux expéditeurs. Ce montant brut n'est pas un volume économique net. Le nombre fourni doit être un entier sûr non négatif avant conversion exacte en chaîne ; absent, invalide ou hors de cette borne, il donne `latestBlockValue: null` sans rendre les autres données blockchain invalides. Aucun total n'est extrapolé depuis l'échantillon visible.

**Ethereum.** L'adaptateur additionne en `BigInt` les champs `value` de toutes les transactions du bloc `latest` complet validé, avant classement et limitation du tableau public. Il s'agit des **valeurs natives déclarées**, pas d'un relevé des transferts effectivement exécutés : sans reçus, la somme peut inclure des appels échoués. Les frais, les tokens ERC20, les transferts internes de contrats et les retraits des validateurs ne participent pas à cette somme. Les quantités d'entrée restent bornées à 256 bits et le bloc à 50 000 transactions, sous la limite HTTP existante de 2 MiB ; l'agrégat sérialisé est borné à 83 chiffres.

Ces calculs utilisent uniquement les réponses déjà collectées : aucun endpoint, reçu, trace, parcours paginé, dépendance ou requête réseau supplémentaire. Les délais, le cache blockchain et le polling direct restent à trois secondes. La page **Valeur** du grand panneau et le détail **Bloc** affichent le total en BTC ou ETH ; leur arrondi de présentation ne modifie pas l'entier exact de l'API. Un équivalent USD secondaire porte `≈` et utilise uniquement un cours actuel encore utilisable, jamais un cours historique du bloc. Une valeur ou un cours manquant reste explicitement indisponible, sans zéro inventé. La rotation des pages du panneau passe à **quatre secondes** et reste indépendante de la collecte des données.

Ce changement de contrat et son affichage restent **non validés** : les tests, TypeScript, la compilation, le lint, l'audit et la validation visuelle sont suspendus à la demande du propriétaire. Sources : [calcul des blocs enrichis Mempool](https://github.com/mempool/mempool/blob/master/backend/src/api/blocks.ts), [définition Bitcoin Core de `total_out`](https://bitcoincore.org/en/doc/30.0.0/rpc/blockchain/getblockstats/), [JSON-RPC Ethereum et valeur en wei](https://ethereum.org/developers/docs/apis/json-rpc/).

## Comptage du mempool du fournisseur

En direct Bitcoin, `pendingCount` reprend le compte du même relevé RPC que `sampling` lorsque la lecture complète est utilisée ; en repli, il reprend le compteur validé de `/mempool` du fournisseur configuré. Ce total local ne se déduit pas du nombre de voyageurs visibles. En direct Ethereum, il vaut la somme **pending + queued** renvoyée par la méthode facultative `txpool_status` du RPC configuré. Les comptes du relevé de classement `txpool_content` restent séparés dans `sampling`, avec leur date propre ; ils peuvent différer d'un comptage reçu à un autre instant. Les transactions `queued` sont conservées pour une exécution future et ne sont pas nécessairement admissibles au prochain bloc. Ce champ n'annonce jamais un total mondial du réseau. Un bloc candidat `pending` et son échantillon ne servent jamais de remplacement à un comptage indisponible.

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

Le serveur suit au plus 2 048 identifiants pendant 30 minutes depuis leur dernière observation. Pendant une collecte, il peut conserver temporairement 2 048 observations anciennes et 480 nouvelles, soit au plus 2 528 identifiants transitoires avant de vérifier puis ramener le suivi à sa limite. Le rattrapage examine au plus huit blocs par collecte. Une lacune dont la vérification échoue reste à réessayer ; elle n'est pas déclarée confirmée par défaut. Les mêmes preuves peuvent être renvoyées à plusieurs rafraîchissements et plusieurs visiteurs : le consommateur doit dédupliquer par hash et identifiant, sans consommer le journal pour les autres clients.

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

L'effectif retenu accompagne la métrique. L'échantillon priorise jusqu'à 480 taux de frais élevés du relevé complet du fournisseur lorsqu'il est disponible, sinon de sa projection ou des seules transactions récentes dans le repli Bitcoin. Cette sélection est biaisée : sa médiane n'est ni celle du mempool entier ni celle de tous les blocs du réseau. L'interface affiche `≈` avec BTC/ETH par transaction ou USD par transaction selon le switch. Un échantillon vide ou absent donne `—` ; un cours absent ou expiré ne produit pas une médiane USD fictive à zéro. Les états ancien, indisponible et démonstration restent distincts.

## Évolution du contrat

Toute modification affectant une unité, le sens d'un champ, un état ou les capacités d'une chaîne doit mettre à jour schéma, fixtures, tests adaptateur, tests HTTP, interface et documentation dans la même proposition. Ajouter un champ facultatif peut être compatible ; changer silencieusement des secondes en millisecondes ou remplacer `null` par un zéro inventé ne l'est pas.

L'API actuelle est interne à l'application, sans engagement de stabilité externe. Avant d'en faire une API publique documentée pour des tiers, définir son versionnement, ses règles de débit et la durée de compatibilité des consommateurs.
