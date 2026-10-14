# API et adaptateurs de lecture

`server/index.ts` lance le serveur HTTP natif Node 24. Importer `createApp` depuis `server/app.ts` construit le serveur sans ouvrir de port, pour les tests ou un autre point d’entrée. `npm start` utilise `tsx` et charge `.env` si présent.

## Contrat HTTP

- `GET /api/health` vérifie le processus HTTP et retourne `{ "status": "ok", "service": "blockchain-observer", "readOnly": true }`. Il ne garantit pas la disponibilité des fournisseurs externes.
- `GET /api/snapshot?chain=bitcoin&mode=live` retourne un `Snapshot` validé par `shared/model.ts`. Chaînes : `bitcoin`, `ethereum`. Modes : `live`, `demo`. Valeurs par défaut : `bitcoin`, `live`. Paramètres inconnus, dupliqués ou invalides : HTTP 400. Méthodes autres que GET : HTTP 405.
- Une panne de fournisseur produit un HTTP 200 avec `status: stale` ou `unavailable`, de façon à conserver un état réseau explicite. Une erreur interne inattendue produit un HTTP 500 expurgé.

Les blocs portent des secondes Unix (`timestamp`), les instantanés des millisecondes Unix (`observedAt`). Un instantané périmé conserve l’heure de sa dernière observation réussie. Les réponses HTTP n’exposent aucune URL de configuration ou réponse d’erreur du fournisseur.

## Sources et couverture

Bitcoin lit `/v1/blocks`, `/mempool/recent`, `/mempool` et `/v1/fees/recommended` sur une API compatible mempool.space. Le compteur représente le mempool de ce fournisseur, avec un échantillon de transactions récentes. Les frais de la carte sont l’estimation pour environ 30 minutes, ceux des passagers sont leur propre fee/vsize. Les blocs utilisent `weight / 4` en octets virtuels ; leur capacité est 1 million de vB.

Ethereum vérifie `eth_chainId = 0x1`, lit le dernier bloc complet et jusqu’à deux en-têtes antérieurs. Le tag `pending` est facultatif : un résultat égal au dernier bloc confirmé, invalide ou non pris en charge laisse les transactions confirmées visibles. Un bloc candidat distinct peut fournir des passagers en attente ; il ne représente jamais le mempool global et `pendingCount` reste `null`. Les transactions EIP1559 utilisent `min(maxFeePerGas, baseFeePerGas + maxPriorityFeePerGas)` en bigint avant conversion en Gwei. Le prix de la carte représente la base fee du dernier bloc, sans pourboire. Les tailles sont le gas des blocs et la limite de gas déclarée des transactions, jamais une estimation des reçus d’exécution.

La démonstration utilise une graine déterministe. Tous ses identifiants commencent par `demo-`, les données fictives sont identifiées, et aucun chemin de panne réseau ne substitue une démonstration aux données directes.

## Configuration et limites

| Variable                    | Défaut                                | Validation                                                             |
| --------------------------- | ------------------------------------- | ---------------------------------------------------------------------- |
| `HOST`                      | `127.0.0.1`                           | Hôte de liaison ; utiliser `0.0.0.0` dans Docker                       |
| `PORT`                      | `3001`                                | Entier 1 à 65535                                                       |
| `BITCOIN_API_URL`           | `https://mempool.space/api`           | URL serveur seulement, sans requête, identifiants ou fragment          |
| `ETHEREUM_RPC_URL`          | `https://ethereum-rpc.publicnode.com` | URL serveur seulement, sans identifiants ou fragment                   |
| `TRUSTED_PROXY_IPS`         | vide                                  | Au plus 64 adresses IPv4/IPv6 exactes séparées par virgules, sans CIDR |
| `API_RATE_LIMIT_PER_MINUTE` | `120`                                 | Entier 1 à 10000, par adresse cliente validée                          |

HTTPS est obligatoire pour les fournisseurs externes. HTTP est accepté uniquement vers `localhost`, `127.0.0.1` et `[::1]`. Les redirections sont refusées. Les URLs ne sont jamais reçues du navigateur. Une URL RPC peut contenir une clé dans son chemin ou sa requête, qui reste côté serveur.

Les requêtes externes ont un délai maximal de 8 secondes et une réponse maximale de 2 MiB, même sans `Content-Length`. Deux caches partagés, un par chaîne, dédupliquent les lectures simultanées de tous les visiteurs. Le délai minimal après chaque actualisation est 10 secondes ; un ancien instantané expire après 120 secondes. Les sorties affichent au plus 120 transactions et 3 blocs. Ethereum peut demander jusqu’à deux vagues successives de requêtes externes, soit environ 16 secondes au pire pour une première observation.

`X-Forwarded-For` est toujours ignoré. `X-Real-IP` est utilisé uniquement lorsque l’adresse socket du proxy figure explicitement dans `TRUSTED_PROXY_IPS` et que le header contient une seule IP valide. Le proxy doit remplacer ce header lui-même. En Docker, configurer l’adresse réellement observée sur le réseau Docker, pas automatiquement 127.0.0.1. Sans proxy de confiance configuré, les visiteurs derrière le même proxy partagent son quota. Ajouter aussi une limite au reverse proxy public.

Les fichiers de `dist/` sont servis avec CSP, refus des chemins cachés et de la traversée de répertoires, vérification des liens symboliques et fallback SPA réservé aux routes sans extension. Les routes API ne permettent aucune signature, connexion à un portefeuille ou diffusion de transaction.

## Vérification

Les tests `tests/unit/` couvrent les charges invalides, les unités, l’arithmétique EIP1559, le cache concurrent, les pannes et la récupération, les contrôles de routes, la limitation de requêtes, les headers de proxy falsifiés et les échappements des fichiers statiques. Ils simulent les fournisseurs ; les tests HTTP ouvrent seulement un port temporaire local. Les tests ne garantissent pas la disponibilité ou le SLA d’un fournisseur public.
