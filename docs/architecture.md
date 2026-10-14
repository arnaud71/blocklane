# Architecture et choix durables

## Recommandation

Construire une application web portable : **React + TypeScript + Vite, SVG/CSS pour la scène, petit serveur HTTP Node 24 et adaptateurs de données en lecture seule**. Un seul langage, un contrat explicite et aucun service de stockage pour la version initiale. Le serveur sert les fichiers compilés et l'API sur le même domaine.

TxStreet fournit la référence de métaphore. Son dépôt décrit Vue, Bulma, Phaser, des communications socket.io et un backend distinct historiquement accompagné de nœuds, MongoDB et Redis. Ce projet propose une implémentation originale avec une infrastructure plus petite ; il ne dépend ni du backend ni des ressources TxStreet. [Source : dépôt TxStreet](https://github.com/txstreet/txstreet).

## Options de rendu

| Option             | Atouts                                                                                               | Coût d'entretien                                                        | Décision                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------- |
| SVG/CSS avec React | Dessins nets, éléments inspectables, accessibilité, tests DOM, aucun moteur graphique supplémentaire | Limiter les objets animés et le travail React                           | Retenue pour l'échantillon pédagogique initial          |
| Canvas/PixiJS      | Adapté à des milliers d'objets et effets GPU                                                         | Cycle de rendu, hit testing, accessibilité et tests visuels spécifiques | À introduire seulement après profilage d'un besoin réel |
| Moteur de jeu / 3D | Grande liberté de caméra et de mise en scène                                                         | Assets, GPU, compatibilité mobile et dépendances supplémentaires        | Différé ; aucune nécessité pour comprendre les chaînes  |

Une belle scène ne nécessite pas une transaction visible pour chaque transaction du réseau. Le serveur limite les données et la scène regroupe les voyageurs. Le design privilégie la composition, les couleurs, les détails vectoriels et des mouvements sobres. Le texte et les statistiques restent utilisables lorsque les animations sont en pause ou réduites.

Les personnages absents du nouvel échantillon restent en attente visuelle sur le quai avec leur dernière observation, sans être déclarés encore en attente dans le réseau. Le moteur conserve normalement au plus 160 personnages résidents et 80 admissions différées par chaîne. Jusqu'à 80 anciennes observations immobiles restent individualisées ; les suivantes rejoignent une représentation collective. Une archive côté interface conserve jusqu'à 512 identifiants pendant 30 minutes depuis leur dernière présence dans l'échantillon. Les observations expirées ou évincées restent dans un compteur sans suivi individuel, distinct des identifiants encore suivis. Le total ne représente ni des transactions uniques ni un mempool actuel.

Une preuve retrouvée réserve l'identifiant suivi dans l'archive jusqu'à la préparation du départ correspondant. La réservation est protégée de l'expiration et de l'éviction, éventuellement au-delà de 30 minutes pendant une pause ou une file de départs, dans la même borne de 512 identifiants ; le délai de rétention concerne les observations encore sans preuve. À la préparation, le personnage est réadmis depuis la position du groupe et son compteur diminue. Une file de 16 départs traite les blocs intermédiaires ; le chargement initial ne rejoue pas l'ancien journal. Des preuves reçues après le départ de leur bloc portent le libellé RATTRAPAGE. En préparation, les limites temporaires sont de 912 résidents et 752 inclusions superposables ; ces nouvelles bornes et leur coût restent non validés pendant la suspension des tests et de la compilation. Le mode réduit marque les preuves statiquement et conserve les observations. Les réservations sont libérées après traitement, annulation ou règlement statique. Cette mémoire reste volatile et n'ajoute aucun service de stockage.

## Flux et responsabilités

```mermaid
flowchart LR
    B[Navigateur : interface et ville SVG] --> A[API Node : routes fixes]
    A --> C[Cache partagé et contrôle de fraîcheur]
    C --> V[Validation et normalisation]
    V --> BTC[Adaptateur Bitcoin]
    V --> ETH[Adaptateur Ethereum]
    BTC --> M[API mempool.space ou équivalent]
    ETH --> R[JSON-RPC Ethereum]
    A --> P[Cache indépendant des cours USD]
    P --> CB[Coinbase : cours spot BTC/USD et ETH/USD]
    B -. lien facultatif .-> F[FairOnChain]
```

- `src/` : interface, scène, textes et personnalisation ; aucune clé ni interprétation brute du RPC.
- `server/` : configuration, HTTP, appels upstream, cache, erreurs et adaptateurs.
- `shared/` : schéma Zod et types du contrat commun.
- Les données de démonstration sont identifiées comme telles et séparées des adaptateurs directs.

Le backend n'accepte aucune méthode blockchain fournie par les visiteurs. Il effectue les appels nécessaires à ses propres adaptateurs. La configuration du fournisseur appartient à l'opérateur. Tous les clients consomment des instantanés normalisés.

## Contrat et nouvelles chaînes

Le schéma partagé est la référence exacte. Un instantané associe une chaîne, une provenance, une date de collecte, un état de fraîcheur, des blocs, des transactions échantillonnées et les métriques disponibles. Les unités et la disponibilité des métriques doivent être explicites ; une absence est distincte de zéro.

Le champ facultatif `Tx.blockHash` associe une confirmation à un bloc vérifié. Bitcoin le renseigne après comparaison de l'identifiant avec les transactions du bloc ; Ethereum utilise le hash du bloc confirmé effectivement lu. Une transaction en attente ne peut pas porter ce champ. Les anciennes confirmations sans hash restent compatibles mais ne sont pas utilisées comme preuve d'appartenance au départ animé. Les deux wagons à l'arrêt projettent les blocs à venir ; à réception d'une preuve de bloc réel, le premier est ajusté aux inclusions connues puis part. Cette logique suit la métaphore de [TxStreet](https://github.com/txstreet/txstreet/blob/main/src/components/street.js#L677-L846), avec un échantillon et des budgets illustratifs bornés.

`Snapshot.inclusions` ajoute un journal facultatif de `BlockInclusions = { block, transactionIds }`. Il contient au plus 16 blocs et 2 048 identifiants au total, exclusivement des observations suivies dont l'inclusion a été vérifiée dans ce hash. Il reste séparé des 120 transactions et des trois blocs de l'instantané courant ; ses blocs historiques n'ont pas à appartenir aux trois derniers. Hashes et hauteurs y sont uniques ; à hauteur commune avec `blocks`, les hashes doivent être identiques. Les formats d'identifiants et de hashes sont propres à la chaîne en direct. Un instantané indisponible ne peut porter ce journal. Son caractère facultatif préserve les anciens consommateurs et les démonstrations sans ce suivi.

Pour ajouter une chaîne :

1. Décrire ses capacités : vue des transactions en attente, unités de frais, blocs, finalité et limites du fournisseur.
2. Étendre le registre de chaînes et le schéma commun si nécessaire, sans changer implicitement les unités existantes.
3. Créer un adaptateur qui valide les réponses externes puis les normalise ; limiter les données à la frontière serveur.
4. Fournir des fixtures valides, invalides, incomplètes et en panne. Tester la provenance et la distinction attente / confirmation.
5. Ajouter les textes pédagogiques, la couleur et les liens d'explorateur. Réutiliser la scène ; ne pas lui faire interpréter le RPC.
6. Vérifier l'affichage d'une métrique absente et le retour arrière de version. Documenter le fournisseur retenu.

## Ce que signifie « direct »

**Bitcoin.** Les blocs et le mempool proviennent du fournisseur configuré. Le mempool est une vue observée, et la scène un échantillon. Le minage fournit un rythme moyen, pas une heure de départ garantie ; ne pas afficher un compte à rebours exact du prochain bloc. [Source : protocole et difficulté Bitcoin](https://developer.bitcoin.org/devguide/block_chain.html).

**Ethereum.** `eth_getBlockByNumber` accepte notamment `latest` et `pending`. L'adaptateur essaie les données en attente disponibles puis présente les transactions du dernier bloc avec leur état confirmé si le fournisseur ne fournit pas de vue exploitable. Ce repli reste une donnée réelle, avec une sémantique différente et annoncée. [Source : API JSON-RPC](https://ethereum.org/developers/docs/apis/json-rpc/).

Pour échantillonner les frais élevés, Bitcoin utilise une connexion courte au WebSocket du fournisseur mempool.space compatible et demande les transactions du premier bloc projeté. La connexion suit les délais et limites de taille existants, puis ferme après réception de la liste. Une indisponibilité de cette capacité conduit à un repli explicitement annoncé sur l'échantillon récent. Ethereum trie le bloc `pending` validé par prix effectif du gas avant troncature ; ce classement reste local au fournisseur. Les inclusions vérifiées sont réservées séparément pour conserver leur provenance même avec des frais faibles.

Un slot Ethereum dure actuellement 12 secondes ; un slot peut manquer et ne garantit ni inclusion ni finalité. La vue en attente d'un fournisseur est locale et exclut potentiellement des flux privés. La version initiale n'annonce pas une mesure de mempool global. [Source : consensus Ethereum](https://ethereum.org/developers/docs/consensus-mechanisms/pos/).

Le cache serveur évite un appel upstream par visiteur : délai minimal de 3 secondes après chaque collecte, réussie ou en échec, une récupération en cours partagée, timeout de 8 secondes par requête HTTP externe, réponse limitée à 2 MiB, jusqu'à 120 transactions et 3 blocs courants par chaîne, plus le journal d'inclusions borné. Une réponse récente peut être signalée comme ancienne jusqu'à 120 secondes ; après, l'API annonce l'indisponibilité. Le client attend 3 secondes en direct et 5 secondes en démonstration après chaque réponse avant la prochaine lecture de l'API locale ; il ne chevauche pas ses requêtes et les suspend dans un onglet masqué. Une seule collecte reste en cours par chaîne ; sa durée et celle du rattrapage s'ajoutent au délai de cache et ne permettent pas de garantir de nouvelles données toutes les 3 secondes. Deux chaînes représentent au plus environ 40 requêtes locales par minute par onglet visible, sous la limite par défaut de 120 par adresse cliente ; plusieurs onglets ou une adresse partagée peuvent atteindre cette limite. Ces limites doivent être modifiées avec leurs tests et leur documentation.

Chaque adaptateur conserve jusqu'à 2 048 identifiants échantillonnés pendant 30 minutes depuis leur dernière observation, afin de les rapprocher des blocs réellement reçus. L'éviction attend la vérification : une collecte peut temporairement conserver 2 048 observations anciennes et 96 nouvelles, puis revient à 2 048 avant réponse. Le rattrapage examine au plus huit blocs par collecte et garde les lacunes à réessayer après un échec. Le journal est rejoué dans les réponses suivantes : la première lecture d'un visiteur ne consomme pas les preuves destinées aux autres. Côté scène, une preuve retrouvée réserve l'identifiant suivi jusqu'à la préparation de son bloc, puis le réadmet à la position du groupe. Une panne ne transforme pas une absence d'échantillon en confirmation. Une réorganisation invalide les preuves incompatibles avec les hashes reçus ; un recul du dernier bloc annule les départs supérieurs en file ou en préparation, en laissant finir un véhicule déjà en mouvement. La connaissance reste limitée aux blocs effectivement vérifiés et ne promet pas de finalité ni de reprise historique exhaustive. Sources : [route Esplora des identifiants de bloc](https://github.com/Blockstream/esplora/blob/master/API.md#get-blockhashtxids), [routes Bitcoin mempool.space](https://github.com/mempool/mempool/blob/master/backend/src/api/bitcoin/bitcoin.routes.ts), [JSON-RPC Ethereum](https://ethereum.org/developers/docs/apis/json-rpc/).

## Fournisseurs ou nœuds propres

| Approche                  | Avantages                                                 | Contraintes                                                                  | Usage proposé                                               |
| ------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------- |
| API publiques partagées   | Mise en route rapide, pas de nœud à gérer                 | Quotas, disponibilité variable, fonctionnalités partielles, aucun SLA local  | Première version et validation pédagogique                  |
| Fournisseur dédié         | Quota explicite, support et options de flux selon contrat | Budget, confidentialité, dépendance commerciale                              | Application publique avec trafic et disponibilité attendus  |
| Nœuds administrés par HEG | Contrôle de la provenance et de la politique de collecte  | Stockage, synchronisation, sécurité, supervision et expertise d'exploitation | Recherche ou autonomie lorsqu'une équipe peut les exploiter |

Un nœud propre observe lui aussi un mempool local. Aucun prestataire ne rend automatiquement exhaustive la connaissance des transactions privées. Pour le choix du fournisseur, vérifier le support `pending`, les quotas, l'emplacement des données, les règles d'utilisation et la rotation des clés. Ne pas figer des prix ou des promesses fournisseur dans le code.

## Conversion facultative des frais en USD

Le besoin est un changement d'unité d'affichage commun aux deux chaînes. `server/marketPrices.ts` ajoute un lecteur de cours dans le processus Node existant, sans dépendance, service déployé ou stockage supplémentaire. Il appelle uniquement les routes publiques fixes `https://api.coinbase.com/v2/prices/BTC-USD/spot` et `https://api.coinbase.com/v2/prices/ETH-USD/spot`. Aucun visiteur ne choisit une URL et aucune clé n'est requise. Le renouvellement du cours se lance en arrière-plan, sans bloquer la réponse blockchain ; le lecteur retourne immédiatement un ancien cours encore utilisable ou `null`, puis une lecture suivante récupère le nouveau cours.

Deux caches de cours, un par chaîne et partagés entre les visiteurs d'une même instance, limitent les tentatives à une toutes les 60 secondes après leur fin et dédupliquent les requêtes simultanées. Chaque appel garde un délai de huit secondes et une limite HTTP de 16 Kio. Le lecteur valide l'enveloppe, la paire BTC ou ETH, la devise USD et un montant décimal positif, fini et borné à un milliard. Après un échec, le dernier cours reste signalé comme ancien pendant au plus cinq minutes depuis sa réception ; ensuite il devient `null`. Sa disponibilité est indépendante de celle de la blockchain.

Le champ facultatif et nullable `Snapshot.usdQuote` porte `{ usdPerCoin, observedAt, source: 'Coinbase', status: 'ok' | 'stale' }`. Son horodatage en millisecondes est l'heure de réception, pas celle d'une transaction de marché. La source et l'heure restent visibles. Le mode démonstration n'appelle pas le lecteur et ne peut porter un cours live non nul. Les lecteurs de cours, transports et horloges sont injectables ; les fournisseurs blockchain injectés restent isolés des appels de cours sauf injection explicite du lecteur USD.

`src/lib/feeDisplay.ts` convertit uniquement la présentation : un taux Bitcoin en USD/vB vaut `feeRate * usdPerCoin / 100_000_000` ; un taux Ethereum en USD/gas vaut `feeRate * usdPerCoin / 1_000_000_000`. Le montant total estimé d'un voyageur multiplie ce taux par sa taille virtuelle Bitcoin ou sa limite de gas Ethereum et porte `≈`. Cette limite de gas n'est pas le gas consommé ni le montant réellement payé. Le cours relevé ne devient pas un cours historique de confirmation. Les champs natifs, le classement, les couleurs et les animations gardent leur sémantique. Une conversion invalide ou expirée affiche une absence ; les petits montants positifs ne sont pas arrondis en faux zéros.

L'hébergement doit autoriser `api.coinbase.com:443` en sortie si la conversion est souhaitée. Il n'y a aucun nouveau paramètre d'environnement ou appel navigateur direct. Le cache cours de 60 secondes reste distinct du cache blockchain de trois secondes. Sources : [API Coinbase des cours spot](https://docs.cdp.coinbase.com/coinbase-app/track-apis/prices), [unités et calcul des frais Ethereum](https://ethereum.org/developers/docs/gas/).

## Hébergement et évolution

| Option                                          | Coût opérationnel relatif                          | Portabilité          | Condition                                                                    |
| ----------------------------------------------- | -------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------- |
| Serveur Linux + conteneur + reverse proxy HTTPS | Faible infrastructure, administration à assurer    | Très bonne           | Recommandation avec un opérateur identifié                                   |
| Plateforme de conteneurs gérée                  | Moins d'administration système, budget fournisseur | Bonne avec image OCI | Vérifier accès sortant, secrets, processus actif, journaux et retour arrière |
| Infrastructure HEG                              | Selon les services déjà disponibles                | Très bonne           | Confirmer domaine, responsable, réseau sortant et sauvegardes                |

L'état du cache, du suivi d'identifiants et du journal d'inclusions est volatile ; un redémarrage demande un nouvel instantané et ne restaure pas les observations oubliées. L'archive de présentation disparaît également au rechargement du navigateur. Cela évite une base de données inutile pour le périmètre actuel. Ajouter SQLite ou un stockage d'historique seulement si une reprise durable, des analyses historiques, exports ou travaux de recherche le nécessitent. Ajouter un cache distribué uniquement si plusieurs instances doivent partager le budget d'appels ; actuellement chaque processus possède son propre cache et son propre suivi.

La publication doit avoir un domaine HTTPS, des limites au reverse proxy, une surveillance de santé et de fraîcheur des sources, un accès opérateur et une image précédente conservée. Le conteneur portable facilite une migration d'hébergeur. Aucune publication automatique n'est activée.

## HEG et FairOnChain

`src/config/brand.ts` centralise les paramètres de marque. La proposition de design HEG n'est pas une certification institutionnelle. Remplacer les textes ou intégrer un logo officiel après validation des droits et de la charte.

Le lien FairOnChain est optionnel et désactivé par défaut. Il ouvre une ressource externe ; aucun appel vers ce service n'est nécessaire à l'application. Une future intégration devra rester derrière une capacité facultative avec validation de données et état d'indisponibilité indépendant.

## Décisions initiales — 14 octobre 2026

- Retenir SVG et un échantillon limité pour réduire l'entretien et garder une interface accessible.
- Garder un backend HTTP natif et un contrat Zod, sans framework serveur, base ou broker initial.
- Démarrer sur des sources publiques remplaçables, en rendant leurs limites visibles.
- Conserver les clés et les appels fournisseur côté serveur.
- Séparer la démonstration des données directes et conserver la distinction Ethereum attente / confirmation.
- Préparer CI, Dependabot et maintenance Codex ; garder la revue et la livraison sous contrôle humain.
- Étendre le contrat par un journal facultatif d'inclusions vérifiées, avec suivi volatile de 2 048 identifiants, expiration de 30 minutes et rattrapage borné ; conserver une archive de présentation indépendante de 512 identifiants et rendre explicites les observations sans suivi.
- Colorer les t-shirts selon la moyenne des seuls voyageurs en attente affichés dans leur chaîne : jaune faible, orange à la moyenne, rouge à au moins deux fois la moyenne ; ce repère n'est pas une moyenne du réseau.
- Ajouter une conversion USD facultative par un cours Coinbase indépendant et borné, sans modifier les taux natifs ou prétendre mesurer les frais Ethereum réellement payés.
