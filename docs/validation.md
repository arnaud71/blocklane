# Vérification initiale — 14 octobre 2026

Version concernée : **0.1.0**. Vérification locale avec Node **24.19.0**.

| Contrôle                            | Résultat                                                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| TypeScript strict et ESLint         | Réussite                                                                                                                   |
| Vitest                              | 32 tests réussis : validation, calculs, cache, erreurs, HTTP, fichiers, proxys et liens                                    |
| Playwright Chromium                 | 18 tests réussis : 9 parcours sur ordinateur et 9 sur mobile                                                               |
| Formatage Prettier                  | Réussite                                                                                                                   |
| Compilation Vite                    | Réussite                                                                                                                   |
| Audit npm de toutes les dépendances | Aucune vulnérabilité connue signalée à la date du contrôle                                                                 |
| Configuration Docker Compose        | Valide                                                                                                                     |
| Serveur local de production         | Page et santé HTTP 200 ; CSP présente ; accès à `/.env` rejeté                                                             |
| Bitcoin en direct                   | `mempool.space`, statut `ok`, trois blocs et dix transactions récentes reçus                                               |
| Ethereum en direct                  | `Ethereum PublicNode`, statut `ok`, trois blocs et échantillon borné à 120 transactions reçus ; mempool global non compté  |
| Revue du code                       | Deux agents ont relu les protections, la sémantique des données et les chemins de déploiement ; problèmes relevés corrigés |

Les tests navigateur utilisent des réponses contrôlées pour rester reproductibles. Les vérifications directes des fournisseurs sont séparées ; elles confirment une réponse au moment du test et ne constituent pas une garantie de disponibilité future.

Les parcours couvrent notamment la séparation direct/simulation, la sélection clavier, les liens d'explorateur, les erreurs, l'expiration pendant une requête bloquée, la mise à jour de l'état d'une transaction sélectionnée et un départ lié à un nouveau hash de bloc observé. Le rendu a été inspecté sur captures ordinateur et mobile.

L'image Docker n'a pas été construite : le daemon Docker du poste n'est pas disponible. Les fichiers de CI, d'audit et de Dependabot sont préparés ; leur exécution et les protections de branche nécessitent la publication du dépôt dans GitHub. Le domaine, le TLS, les règles du proxy, les fournisseurs avec engagement de disponibilité et la supervision restent à configurer pour une exploitation publique.
