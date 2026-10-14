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

| Champ          | Type / unités                  | Signification                                               |
| -------------- | ------------------------------ | ----------------------------------------------------------- |
| `chain`        | `bitcoin` / `ethereum`         | Réseau représenté                                           |
| `mode`         | `live` / `demo`                | Provenance réelle ou pédagogique                            |
| `status`       | `ok` / `stale` / `unavailable` | Fraîcheur du résultat                                       |
| `source`       | Texte borné                    | Libellé de provenance ; aucune URL privée ni clé            |
| `observedAt`   | Millisecondes Unix             | Date de collecte ; conservée pour un résultat ancien        |
| `coverage`     | Texte borné                    | Limites de la vue fournie                                   |
| `pendingCount` | Entier ou `null`               | Compte observé lorsque disponible ; `null` signifie inconnu |
| `feeRate`      | Nombre ou `null`               | Mesure ou estimation décrite dans l'interface               |
| `feeUnit`      | `sat/vB` / `Gwei`              | Unité correspondant à la chaîne                             |
| `transactions` | Tableau, maximum 120           | Échantillon ; jamais une liste exhaustive promise           |
| `blocks`       | Tableau, maximum 3             | Blocs récents observés                                      |
| `message`      | Texte facultatif               | Explication d'une limite ou d'un incident                   |

Une transaction possède un identifiant, sa chaîne, une taille, un taux de frais, `pending` ou `confirmed`, un type `transfer` ou `contract`, et une valeur textuelle. Les nombres doivent être finis et non négatifs. Les transactions d'un instantané doivent appartenir à sa chaîne.

Un bloc possède une hauteur, un hash, un `timestamp` en **secondes Unix**, un nombre de transactions, une capacité et une utilisation. La capacité s'exprime en octets virtuels pour Bitcoin et en gas pour Ethereum. L'utilisation ne peut pas dépasser la capacité déclarée. Ne pas confondre `timestamp` et `observedAt` lors d'une conversion de date.

Un instantané `unavailable` n'a ni bloc ni transaction à animer. Une démonstration a le statut `ok` et ne représente jamais la disponibilité upstream. L'adaptateur Ethereum distingue les transactions du bloc en attente de celles du dernier bloc confirmé ; le client ne doit pas modifier cette sémantique pour les faire apparaître comme des voyageurs en attente.

## Évolution du contrat

Toute modification affectant une unité, le sens d'un champ, un état ou les capacités d'une chaîne doit mettre à jour schéma, fixtures, tests adaptateur, tests HTTP, interface et documentation dans la même proposition. Ajouter un champ facultatif peut être compatible ; changer silencieusement des secondes en millisecondes ou remplacer `null` par un zéro inventé ne l'est pas.

L'API actuelle est interne à l'application, sans engagement de stabilité externe. Avant d'en faire une API publique documentée pour des tiers, définir son versionnement, ses règles de débit et la durée de compatibilité des consommateurs.
