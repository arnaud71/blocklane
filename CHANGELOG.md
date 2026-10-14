# Journal des versions

Le projet suit le versionnement sémantique. Les dates utilisent le calendrier Europe/Zurich. Une entrée représente le contenu de la version ; sa livraison publique est une opération distincte.

## À venir

### Interface

- Optimisation du travail React et des calculs répétés : réutilisation du dessin et des poses immobiles des voyageurs, têtes et accessoires mémorisés séparément des gestes, formats numériques partagés, libellés de frais mis en cache, médianes conservées par instantané, scène et campus mémorisés avec commandes de sélection stables. Publication des effectifs de la scène espacée d'au moins 250 ms, indépendante de l'animation à environ 24 images par seconde. Échantillon de 240 voyageurs, 48 unités par wagon, compteurs arrière, file collective, sources et cache API de trois secondes conservés. Aucun profilage ni mesure de gain n'est effectué ; aucun gain chiffré ni validation n'est annoncé pendant la suspension des contrôles.
- Moteur conservant les références des personnages et collections inchangés, mesures des chemins mises en cache par références faibles et archive copiée seulement lors d'un changement. État React publié seulement si la scène visible change, tout en traitant les échéances internes. Boucle `requestAnimationFrame` annulée dans un onglet masqué puis relancée sans saut de temps ; pause et mouvements réduits conservés.
- Affichages mémorisés réveillés par délais ponctuels aux échéances de fraîcheur : cours USD expiré après cinq minutes, compte Ethereum ancien après 30 secondes puis non mesuré après 120 secondes, avec recalcul au retour d'un onglet visible. Invalidation des libellés USD et de l'échelle commune de la file même pendant une attente API ou une scène immobile ; nettoyage des délais et écouteurs, sans intervalle ni collecte supplémentaire.
- Compteur `N TX` sur une plaque à l'arrière de chaque wagon, au-dessus des feux rouges : identifiants uniques représentés à bord, conservés pendant départ et promotion et lisibles des deux côtés. Infobulle et libellé accessible précisent la limite de l'échantillon ; le chiffre ne représente pas le total réel d'un bloc ni le budget de ressource.
- Budget de chaque projection porté de 12 à 48 unités illustratives, avec 48 emplacements sur quatre colonnes et douze rangées dans un wagon de taille inchangée. Un voyageur conserve son coût de une à trois unités : jusqu'à 48 transactions d'une unité, ou moins selon leurs besoins illustratifs. Géométrie et moteur partagent la même constante ; inclusions vérifiées superposables au-delà des places, sans modifier les 240 voyageurs courants, les archives, les contrats ou les appels.
- File collective **File globale · fournisseur** en bas de chaque rue, sur une ligne de 92 pixels avant la couverture, alignée avec une bande verte du campus central. Total exact de la vue locale et provenance visibles, avec détail Ethereum `pending + queued` ; ce n'est jamais un total mondial. Au plus 48 silhouettes statiques par chaîne, avec échelle commune explicite `1, 2, 5 × 10ⁿ` calculée sur le maximum des deux comptes affichés et dernier groupe partiel. Silhouettes décoratives, résumé accessible et infobulle, sans identifiants, frais individuels ni confirmations inventées. Zéro réel, compte inconnu, simulation et ancien relevé conservés ; âge propre du pool Ethereum respecté. Échantillon de 240 voyageurs et anciennes observations inchangés, sans nouvel appel, timer, contrat ou dépendance.
- Échantillon courant porté de 80 à 240 voyageurs en attente par chaîne. File élargie à huit colonnes et 30 rangées, avec conservation des places et superposition des observations ; disposition desktop et miroir Bitcoin conservés. Démonstration étendue à 240 transactions en attente et 12 confirmations fictives par chaîne.

- Ville utilisant toute la largeur du desktop, avec une seule colonne centrale de maisons et bâtiments HEG, Bitcoin à gauche et Ethereum à droite. Colonnes extérieures symétriques : wagons, passage, file d'attente et arrivées depuis chaque bord ; portes Bitcoin à gauche et Ethereum à droite, sans chemin piéton sur la chaussée.
- Arrivées horizontales à hauteur des places réservées depuis le bord gauche Bitcoin et le bord droit Ethereum, remplaçant l'arrivée par le haut. Une géométrie canonique commune et sa projection en miroir conservent la lisibilité des textes et glyphes, les angles des flèches et les chemins des observations anciennes.
- Largeur logique SVG adaptée au rapport du viewport, avec élargissement des colonnes du quai sans étirement global des wagons ou personnages. Grille à trois colonnes avec campus commun compactable ; lignes en-tête, scène et couverture partagées par `subgrid`, avec grille interne de repli. États des données, préparation d'une seconde, panneaux à quatre secondes, feux et places de file existantes conservés.
- Phares avant blanc chaud sur les wagons dès la préparation au départ et pendant les mouvements ; feux de freinage rouges pendant les derniers 30 % de promotion et d'arrivée. Extinction à l'arrêt, phases conservées pendant pause, halos SVG sans clignotement ni filtre.
- Grand panneau d'informations toujours visible en haut de chaque blockchain, dans l'en-tête à la place des métriques statiques, avec valeur principale plus grande et cinq rubriques Mempool, Frais médians, Bloc, Valeur et Voyageurs, alternées toutes les quatre secondes. Le même panneau se compacte selon l'écran et conserve le décor SVG, la route et le quai disponibles ; choix manuel des pages et pause du défilement. Rotation suspendue pendant pause générale, mouvements réduits, sélection, onglet masqué ou données non valides.
- Panneau de détails conservé, avec chiffres plus lisibles et rotation Réseau / Bloc / Voyageurs à quatre secondes. Le rythme des pages reste indépendant des collectes API et de l'horloge des wagons ; le polling et le cache blockchain restent à trois secondes.
- Rubrique Valeur du dernier bloc complet, en BTC/ETH en valeur principale et équivalent USD `≈` secondaire au cours spot disponible, indépendamment du switch des frais. Bitcoin : somme des sorties hors coinbase, monnaie rendue incluse, sans mesure de transfert économique net. Ethereum : somme des champs `value` déclarés, tokens, transferts internes et frais exclus, avec valeur possible des transactions échouées sans lecture des reçus. Source et limites visibles ; absence ou démonstration sans total réel inventé.
- Nombre de transactions du mempool local du fournisseur observé, distinct des voyageurs de l'échantillon et de tout total mondial : compte mempool.space pour Bitcoin, total Ethereum `pending + queued` si `txpool_status` est disponible. Démonstration explicitement simulée ; valeur absente ou expirée non mesurée, sans repli sur l'échantillon ni faux zéro.
- Compteur « Depuis départ » dans une ligne fixe sous le grand panneau en haut de chaque chaîne, visible quelle que soit la rubrique rotative et indépendant pour Bitcoin et Ethereum : temps réel depuis le début du dernier départ animé, rafraîchi à la seconde sans dépendre de la vitesse ou de la pause. `—` avant le premier départ ; confirmations statiques en mouvement réduit sans nouveau départ, animations de rattrapage comptées et dernier repère conservé pendant une indisponibilité temporaire. Réinitialisation au rechargement ou au changement direct / démonstration ; simulation explicite, sans confondre ce temps avec l'âge du bloc ou un compte à rebours. Aucune nouvelle requête ni modification du cache API.
- Frais médians par transaction dans les en-têtes et la page Réseau : médiane des coûts estimés des seules transactions en attente du nouvel instantané, avec effectif, exclusion des confirmations et archives, identifiants dédupliqués et moyenne des deux valeurs centrales pour un effectif pair. Affichage `≈` en BTC/ETH par transaction ou USD par transaction selon le switch ; `—` si l'échantillon est absent. Cette sélection top frais ne constitue pas une médiane mondiale ; Ethereum utilise la limite de gas déclarée, jamais le gas consommé ni les frais payés.
- Taux conseillé Bitcoin et base fee Ethereum conservés en détails secondaires de la page Réseau ; aucun champ d'API, classement, couleur ou animation modifié par le calcul de médiane.
- Commande commune frais natifs / USD : médiane exprimée en BTC/ETH ou dollars par transaction ; montants estimés `≈` dans les détails et infobulles des voyageurs en USD, avec taille virtuelle Bitcoin ou limite de gas Ethereum. Les taux natifs restent consultables ; le tri et les couleurs sont conservés.
- Source et heure du cours visibles ; conversion au cours reçu, sans prétendre fournir le cours historique du bloc ou les frais Ethereum réellement payés. Cours absent ou trop ancien : conversion indisponible, sans prix fictif en démonstration ni faux zéro pour les petits montants.
- File du quai conservant les places déjà attribuées selon l'arrivée observée ; nouveaux identifiants d'une même collecte classés par frais décroissants pour occuper les places restantes, avec départage stable par identifiant et retours animés.
- Petites flèches alignées sur la direction réelle de chaque segment de déplacement, horizontal ou vertical.
- Lecture de l'API locale toutes les 3 secondes après réponse en direct et cache serveur partagé de 3 secondes après collecte ; une seule collecte en cours par chaîne, requêtes clientes séquentielles et suspension dans les onglets masqués conservées.
- Archive de présentation suivie : jusqu'à 512 identifiants conservés pendant 30 minutes sans preuve, puis observations sans suivi au statut actuel inconnu. Une inclusion vérifiée réserve l'identifiant jusqu'à la préparation du bon bloc, protégée de l'expiration et de l'éviction pendant l'attente ; à cette préparation, le groupe diminue et le voyageur est réadmis depuis sa position.
- File de 16 départs pour les blocs intermédiaires ; l'ancien journal n'est pas animé au premier chargement. Une preuve reçue après le départ de son bloc est illustrée comme RATTRAPAGE, avec le même hash.
- Départs conditionnés à la vérification du bloc ; recul du dernier bloc et réorganisation annulent les départs incompatibles encore en file ou en préparation, en laissant finir les véhicules déjà en mouvement.
- Couleurs des t-shirts interpolées du jaune pour des frais faibles vers l'orange à la moyenne et le rouge à au moins deux fois cette moyenne, calculée séparément sur les voyageurs en attente affichés de chaque chaîne. Moyenne absente ou nulle : orange neutre ; transition de 300 millisecondes désactivée en mouvement réduit.
- Mouvement réduit : preuves appliquées statiquement, y compris aux observations déjà présentes, sans trajet et en conservant les observations.
- Occupants du wagon précédent conservés pendant son départ jusqu'à sa sortie de l'écran.
- Deux projections successives comme dans TxStreet : prochain bloc en haut, bloc suivant en bas, avec priorités réévaluées à l'arrêt.
- Premier wagon ajusté aux seules inclusions vérifiées du bloc reçu avant son départ ; les voyageurs non inclus restent sur le quai.
- Hash d'inclusion fourni par les adaptateurs Bitcoin et Ethereum, distinct du simple déplacement animé.
- Échantillonnage des frais élevés dès la collecte : premier bloc projeté mempool.space pour Bitcoin, bloc `pending` du fournisseur classé avant troncature pour Ethereum ; replis annoncés.
- Transfert du candidat accéléré et arrivée de son remplaçant depuis le bas de l'écran, avec la même horloge que les voyageurs.
- Première projection placée plus bas pour dégager l'espace supérieur de la scène ; les nouvelles transactions arrivent désormais par les bords extérieurs.
- Portes sans marches, avec personnages dessinés au-dessus pendant leur passage.
- Préparation d'au moins une seconde d'animation avant le départ du bloc, avec échéance commune aux sorties et embarquements. Sorties rapides plafonnées à 500 ms ; voyageurs du second wagon utilisant le temps restant pour embarquer après leur sortie. Sortie déjà engagée accélérée uniquement sur son chemin restant, sans retour vers la porte. Passages tardifs conservant 50 ms au minimum ; tous les inclus à bord et les autres hors du premier wagon avant son départ, quitte à prolonger l'arrêt.
- Voyageurs hors échantillon maintenus en attente sur le quai avec leur dernière observation ; regroupement visible des plus anciennes observations pour borner la mémoire.
- Première projection encore descendue pour libérer l'espace supérieur de la scène.
- Explication « Pourquoi deux wagons ? » dans la rubrique Comprendre et rappel dans le panneau du dernier bloc.
- Disposition adaptée aux grands écrans, aux ordinateurs portables et aux petits écrans, avec barres plus compactes pour libérer la scène.
- Bitcoin et Ethereum visibles simultanément, avec des sources et des états de connexion indépendants.
- Vue immersive qui occupe la fenêtre, deux rues verticales sur ordinateur et deux scènes compactes sur mobile.
- Commandes communes pour les animations et les modes de données, panneau de détails repliable et sélection rattachée au réseau.
- Navigation pédagogique et provenance des données accessibles sans menu latéral permanent.
- Départ du premier wagon lors d'un nouveau bloc reçu, promotion du second à sa place et arrivée de son remplaçant depuis le bas.
- Couleur de carrosserie commune et wagons centrés sur la chaussée verticale pendant leurs déplacements.
- Quais extérieurs symétriques, embarquement par la porte haute et sortie par la porte basse du côté du quai, avec ouverture des portes correspondantes.
- Voyageurs maintenus à bord pendant le déplacement ; les sorties nécessaires commencent après l'arrivée, avec un retour en file sans traversée de la chaussée.
- Géométrie commune entre les wagons dessinés, leurs portes et le moteur des trajets.
- Suivi Bitcoin et Ethereum borné à 2 048 identifiants par chaîne pendant 30 minutes, avec au plus 2 288 identifiants transitoires le temps de vérifier avant éviction ; une disparition de l'échantillon ne confirme rien.

### Contrat et suivi

- Sélection des frais élevés portée de 96 à 240 candidates par chaîne et réponse maximale de 120 à 264 transactions, avec 24 confirmations réservées. Effectif réel inférieur conservé si le fournisseur expose moins de candidates ; aucun appel fournisseur supplémentaire et cache partagé de trois secondes inchangé. Médiane calculée sur toutes les transactions en attente valides reçues.

- Champ facultatif nullable `Snapshot.latestBlockValue` : total exact en chaîne décimale de satoshis ou wei, lié au hash, à la hauteur et au nombre de transactions du dernier bloc, avec provenance et méthode explicites. Bitcoin reprend `totalOutputAmt` des statistiques mempool.space ; Ethereum additionne avec `BigInt` toutes les valeurs déclarées du bloc avant troncature de l'échantillon. Incohérence ou indisponibilité : `null`, sans faux zéro ni total fictif en démonstration. Aucun nouveau fournisseur, secret ou dépendance.
- Champ facultatif nullable `Snapshot.mempool` pour le pool local Ethereum : `pending`, `queued`, `observedAt` en millisecondes, état `ok` / `stale` et méthode `txpool_status`. Les comptes sont des entiers sûrs non négatifs ; leur somme doit être sûre et correspondre à `pendingCount`. Une observation de ce type ne peut appartenir qu'à Ethereum en direct.
- Collecte facultative `txpool_status` en arrière-plan, partagée par l'adaptateur Ethereum : une requête simultanée, délai de 30 secondes après chaque tentative, réponse bornée à 64 Kio et compte conservé au plus 120 secondes. La panne ou l'absence de cette méthode ne bloque ni n'invalide les données blockchain ; l'interface vérifie séparément l'âge du comptage. Aucun fournisseur, clé, variable d'environnement ou dépendance supplémentaire.
- Champ facultatif nullable `Snapshot.usdQuote` : prix USD positif fini borné, heure de réception en millisecondes, source Coinbase et état `ok` / `stale`, indépendant du statut blockchain.
- Cours spot Coinbase BTC/USD et ETH/USD via deux URL serveur fixes, sans nouvelle dépendance, clé ou variable d'environnement : cache partagé de 60 secondes après tentative, une requête simultanée par chaîne, délai de huit secondes, réponse limitée à 16 Kio et cours ancien conservé au plus cinq minutes avant `null`. Collecte en arrière-plan sans attente ajoutée à la réponse blockchain.
- Journal facultatif `Snapshot.inclusions` : blocs vérifiés et identifiants suivis réellement inclus, maximum 16 blocs et 2 048 identifiants au total, en complément des 264 transactions et trois blocs courants.
- Rattrapage de huit blocs au maximum par collecte, réessai des lacunes et journal rejoué sans consommation par le premier visiteur. Hashes, hauteurs et identifiants validés ; cohérence avec les blocs affichés à hauteur commune.
- Suivi et journal volatiles, sensibles aux redémarrages, expirations, évictions et réorganisations ; aucune promesse d'historique exhaustif ou de finalité.
- Limites de représentation : 240 voyageurs en attente, normalement 480 résidents et 240 admissions différées ; une préparation peut conserver temporairement 1 712 résidents et jusqu'à 1 232 inclusions superposables.

### Validation

- Tests, lint, TypeScript, compilation, audit et validations automatiques ou visuelles suspendus à la demande du propriétaire. La capacité des projections portée à 48 unités et leur compteur arrière, la file collective inférieure, son échelle commune et ses états, l'échantillon étendu à 240 voyageurs par chaîne, la réponse maximale de 264 transactions, les nouvelles grilles et bornes de représentation, la ville centrale pleine largeur, les quais symétriques, le miroir Bitcoin, les arrivées latérales, le grand panneau, le défilement à quatre secondes, le total du dernier bloc, la préparation d'une seconde, le compte du pool Ethereum, le compteur depuis le dernier départ animé, la médiane des coûts par transaction, la conversion USD, le contrat, le rattrapage, les bornes temporaires, les compteurs d'archive, les mouvements réduits et les couleurs ne sont pas déclarés validés ; les résultats des versions précédentes ne les couvrent pas. Les tests et fixtures fondés sur le budget de 12 unités restent à adapter à la reprise autorisée. Aucun appel API réel de validation ajouté. Lecture statique, formatage et aperçu normal de remise uniquement.

## 0.2.0 — 2026-10-14

### Ajouts

- Trajets vers les wagons, embarquement, sortie et retour en file lorsqu'une transaction plus prioritaire prend une place dans la projection.
- Taille de tête liée à la taille virtuelle Bitcoin ou à la limite de gas Ethereum, sur une échelle stable et bornée.
- Panneau du quai avec pages Réseau, Bloc et Voyageurs, rotation automatique et détails fixés par sélection.
- Voyageurs visibles à bord, portes animées, compteurs d'activité et budget du candidat illustratif.
- Horloge d'animation commune bornée à 24 images par seconde, pause, vitesse, onglet masqué et mouvements réduits.
- Tests du moteur et parcours navigateur vérifiant les déplacements et l'absence de confirmations inventées.

### Sémantique

- Embarquements et retours du candidat restent une projection pédagogique. Les statuts réels proviennent exclusivement de la source.
- Les douze unités du wagon candidat sont un budget de représentation, pas la capacité d'un bloc du réseau.
- Les transactions confirmées ne tiennent pas toutes dans un wagon illustré ; l'excédent reste sur le quai observé.

## 0.1.0 — 2026-10-14

### Ajouts

- Observatoire Bitcoin et Ethereum avec une ville SVG originale et une interface française.
- Adaptateurs de données en lecture seule, validation partagée et modes direct / démonstration explicites.
- Identification des sources, traitement de l'indisponibilité et signalement des données anciennes.
- Personnalisation HEG et lien FairOnChain facultatif, sans dépendance à ce service.
- Socle React, TypeScript strict, Vite et serveur Node 24.
- Tests unitaires et navigateur, lint, formatage, compilation et CI GitHub.
- Mises à jour de dépendances proposées par Dependabot ; aucune fusion automatique.
- Conteneur non privilégié et documentation de l'architecture, de la maintenance et de la sécurité.

### Limites initiales

- Données directes issues de fournisseurs publics partagés, sans engagement de disponibilité.
- Vue Ethereum limitée au bloc `pending` fourni ou au dernier bloc confirmé ; aucun mempool mondial exhaustif.
- Échantillonnage borné pour la scène, sans prédiction de l'ordre exact d'inclusion.
- Domaine, hébergement public, secrets opérationnels, alertes et protections du dépôt à configurer.
