# Vérification initiale — 14 octobre 2026

## Vue immersive et transfert des wagons — en cours

Bitcoin et Ethereum sont désormais visibles simultanément. La disposition immersive a été contrôlée aux largeurs 1440, 983, 390 et 320 pixels : les deux scènes tiennent dans la fenêtre, sans défilement de la page. La série de 34 parcours navigateur de cette disposition a réussi avant l'ajout du transfert complet.

Le transfert du candidat vers le wagon observé et le suivi Bitcoin ont ensuite été ajoutés. Le propriétaire a demandé d'arrêter les tests : aucun nouveau lancement n'est prévu pour le moment. Cette dernière extension n'est donc pas présentée comme entièrement validée. Un parcours ciblé de réembarquement d'un voyageur encore en attente sur ordinateur reste à examiner lors de la reprise des validations. Les changements restent locaux, sans publication ni déploiement.

## Extension 0.2.0 — animations et panneau

Vérification locale de la version 0.2.0 : **42 tests unitaires et 32 tests navigateur réussis**, TypeScript strict, ESLint, Prettier et compilation Vite réussis. L'audit npm ne signale aucune vulnérabilité connue à la date du contrôle. Aucun ajout de dépendance ni modification des connecteurs.

Les nouveaux parcours testent la marche réelle des coordonnées SVG, l'embarquement, le retour pour frais faibles, l'éviction par un nouveau voyageur plus prioritaire, l'échelle de tête Bitcoin/Ethereum, la pause, les mouvements réduits, la rotation du panneau et la mise à jour d'une transaction sélectionnée. Ils vérifient explicitement qu'une animation ne transforme pas une transaction en attente en confirmation réseau. Le moteur pur vérifie aussi la disparition de l'échantillon, les données répétées, les limites, le temps de pause et une confirmation annulée par la source.

La scène a été inspectée sur ordinateur et mobile, ainsi que dans l'aperçu local avec les données Bitcoin en direct. Les règles d'animation sont documentées dans [animation.md](animation.md).

## Socle initial 0.1.0

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
