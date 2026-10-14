# État des vérifications — 14 octobre 2026

## Conversion des frais natifs / USD — non validé

**Les tests, le lint, TypeScript, la compilation, l'audit et les validations automatiques ou visuelles restent suspendus à la demande du propriétaire.** Aucun de ces contrôles n'a été lancé pour cette extension. Seuls une lecture statique, le formatage et un aperçu normal de remise sont prévus ; ils ne constituent pas une validation. Les résultats historiques ci-dessous ne couvrent pas ce changement.

La commande commune modifie l'unité de présentation pour les deux chaînes. Les en-têtes donnent des taux USD/vB et USD/gas ; les détails et infobulles donnent un montant total estimé `≈`, avec taille virtuelle Bitcoin ou limite de gas Ethereum. Cette dernière n'est pas le gas consommé ni le montant réellement payé. La conversion utilise le cours reçu, pas un cours historique du bloc. Les taux natifs, le classement, les couleurs et les animations sont préservés.

Le contrat facultatif nullable `usdQuote` porte un prix positif fini borné, sa source Coinbase, son heure de réception et son état `ok` ou `stale`. Le serveur appelle uniquement deux routes spot publiques fixes, avec cache partagé de 60 secondes par chaîne, déduplication des requêtes simultanées, délai de huit secondes et limite de 16 Kio. La collecte de cours fonctionne en arrière-plan : une réponse retourne immédiatement un cours conservé utilisable ou `null`, puis une lecture suivante peut fournir le nouveau cours sans bloquer les données blockchain. Un cours ancien reste utilisable au plus cinq minutes puis devient `null`, sans changer le statut de la blockchain. Le mode démonstration ne reçoit aucun cours fictif. Aucun manifeste, lockfile, paramètre d'environnement ou secret n'est ajouté.

À la reprise autorisée, couvrir avec des fixtures isolées la paire ou devise incorrecte, les montants invalides et hors bornes, les pannes, le délai, la taille de réponse, la déduplication, le cache après échec, la rétention et l'expiration. Vérifier aussi les unités, les petites valeurs sans faux zéro, les montants Ethereum clairement estimés, la source et l'heure visibles, la démonstration, le clavier et la disposition du switch sur petits écrans. Aucun appel réel ne doit remplacer ces fixtures.

## File par arrivée et flèches directionnelles — non validé

À la demande du propriétaire, les places des voyageurs déjà présents sont conservées selon l'arrivée observée dans l'application. Les nouveaux identifiants d'une même collecte sont classés par frais pour occuper les seules places restantes ; un identifiant historique retrouvé reçoit une place courante. Les arrivées et retours gardent leur trajet capturé. Les petites flèches suivent le segment réellement parcouru, avec segments nuls ignorés. La stabilité sur rafraîchissement, les nouvelles admissions, les retours, les angles de flèche et les compteurs restent à valider lors de la reprise. Aucun test, lint, contrôle de compilation ni validation automatique n'a été lancé ; lecture statique, formatage et aperçu de remise uniquement.

## Suivi des inclusions, archive et couleurs — non validé

**Les tests, la compilation, le lint et les contrôles automatiques restent suspendus à la demande du propriétaire.** Aucun de ces contrôles n'a été lancé pour le changement ci-dessous. Les lectures statiques, le formatage et un aperçu normal de remise ne constituent pas une validation. Les résultats historiques conservés dans ce document portent sur les anciennes versions.

Le changement ajoute un suivi serveur par chaîne de 2 048 identifiants pendant 30 minutes, temporairement 2 144 pendant la vérification avant éviction, et un journal facultatif de 16 blocs avec 2 048 identifiants d'inclusion au total. Jusqu'à huit blocs intermédiaires sont rattrapés par collecte et les lacunes restent à réessayer. Le journal est volatile et les preuves incompatibles avec une réorganisation doivent être invalidées ; aucune absence d'échantillon ne prouve une confirmation.

L'interface conserve jusqu'à 512 identifiants archivés pendant 30 minutes sans preuve et distingue les observations sans suivi. Une preuve retrouvée réserve l'identifiant dans la même archive, protégé de l'expiration et de l'éviction jusqu'à la préparation de son bloc, y compris au-delà de 30 minutes pendant une pause ou une file de départs. À cette préparation, l'identifiant quitte le groupe et son personnage est réadmis à sa position. Les réservations, leur libération après traitement ou annulation, la file de 16 départs, l'initialisation sans animation de l'ancien journal, le libellé RATTRAPAGE pour une preuve tardive, le recul du dernier bloc et le traitement statique en mouvement réduit restent à vérifier. Un véhicule déjà en mouvement termine son trajet lorsqu'un bloc est révisé.

Le moteur conserve 80 voyageurs en attente affichés, normalement jusqu'à 160 résidents et 80 admissions différées. Une préparation peut monter temporairement à 912 résidents, avec jusqu'à 752 inclusions superposées à bord ; le comportement et le coût de rendu de ces bornes restent non validés. L'expiration, l'éviction, la récupération depuis le groupe, les compteurs, les preuves reçues pendant pause et les réorganisations devront être couverts par des fixtures locales à la reprise des tests.

Les t-shirts interpolent du jaune vers l'orange à la moyenne puis le rouge à au moins deux fois la moyenne des seuls voyageurs en attente affichés, séparément par chaîne. Il ne s'agit pas d'une moyenne du réseau. La moyenne absente ou nulle donne l'orange neutre ; la transition de 300 millisecondes est désactivée en mouvement réduit. Ces couleurs et leurs cas limites restent également à valider.

## Rafraîchissement et cache du direct à 3 secondes — non validé

Le délai entre la réponse de l'API locale et la prochaine lecture passe de 10 à 3 secondes en direct. Le mode démonstration garde 5 secondes. À la demande du propriétaire, le cache serveur partagé passe ensuite lui aussi de 10 à 3 secondes après chaque collecte, réussie ou en échec. L'unique collecte en cours par chaîne, les requêtes clientes séquentielles, le délai d'expiration et la suspension dans un onglet masqué restent en place. Seule une lecture statique du changement a été effectuée. Aucun test ni contrôle de compilation n'a été lancé pendant la suspension demandée.

## Quai à droite et portes séparées — non validé

La métaphore a ensuite été rapprochée de TxStreet : les deux wagons à l'arrêt projettent les blocs à venir. Le premier est ajusté aux inclusions prouvées avant son départ, puis le second prend sa place. Le champ facultatif `Tx.blockHash` relie les confirmations des adaptateurs au bloc reçu. L'échantillonnage priorise les frais élevés à la collecte, avec une liste du premier bloc projeté Bitcoin et un tri du `pending` Ethereum avant troncature. Aucun test ni contrôle de compilation n'est lancé pendant la suspension demandée ; les anciens parcours du modèle « bloc observé / candidat » devront être adaptés lors de leur reprise, ainsi que les bornes et replis du nouvel échantillonnage.

Le maintien des voyageurs pendant le dernier départ, l'accélération du transfert, l'entrée du nouveau candidat depuis le bas et l'arrivée des transactions par le haut ont ensuite été ajoutés. Le wagon du haut est descendu, les observations précédentes restent en attente sur le quai avec un regroupement visible pour borner leur mémoire, et la disposition se compacte selon la taille de l'écran. Les portes n'ont plus de marches et les voyageurs passent au-dessus de leur dessin. Une préparation d'une demi-seconde rassemble les voyageurs concernés avant le départ. La rubrique Comprendre explique le rôle des deux wagons. Les tests restent suspendus à la demande du propriétaire ; ces changements ne sont pas déclarés validés.

Une modification précédente a unifié la couleur des wagons, les a maintenus centrés sur la chaussée et déplacé les trajets des voyageurs sur le quai à droite. L'embarquement utilise la porte haute à droite ; la sortie utilise la porte basse à droite et attend l'arrivée du wagon. La géométrie du moteur et du dessin est partagée.

La demande du propriétaire de suspendre les tests reste applicable. Aucun test automatique ni contrôle de compilation n'a été lancé pour cette modification. Le formatage du code et un aperçu de remise ne constituent pas une validation du comportement. Les résultats historiques ci-dessous ne valident donc pas cette nouvelle disposition ni ses trajets. Le réembarquement après transfert et les contraintes de portes, de quai et de mouvement restent à vérifier lors de la reprise des validations.

## Vue immersive et transfert des wagons — résultats historiques avant suspension

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
