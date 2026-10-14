# Journal des versions

Le projet suit le versionnement sémantique. Les dates utilisent le calendrier Europe/Zurich. Une entrée représente le contenu de la version ; sa livraison publique est une opération distincte.

## À venir

### Interface

- File du quai triée par frais décroissants, avec tête près de la porte haute, changements de place animés et départage stable par identifiant ; anciens observateurs hors classement courant et sièges déjà occupés préservés.
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
- Nouvelles transactions arrivant depuis le haut du quai ; première projection descendue pour dégager leur arrivée.
- Portes sans marches, avec personnages dessinés au-dessus pendant leur passage.
- Préparation rapide des voyageurs concernés pendant une demi-seconde avant le départ du bloc.
- Voyageurs hors échantillon maintenus en attente sur le quai avec leur dernière observation ; regroupement visible des plus anciennes observations pour borner la mémoire.
- Première projection encore descendue pour dégager l'arrivée des nouvelles transactions.
- Explication « Pourquoi deux wagons ? » dans la rubrique Comprendre et rappel dans le panneau du dernier bloc.
- Disposition adaptée aux grands écrans, aux ordinateurs portables et aux petits écrans, avec barres plus compactes pour libérer la scène.
- Bitcoin et Ethereum visibles simultanément, avec des sources et des états de connexion indépendants.
- Vue immersive qui occupe la fenêtre, deux rues verticales sur ordinateur et deux scènes compactes sur mobile.
- Commandes communes pour les animations et les modes de données, panneau de détails repliable et sélection rattachée au réseau.
- Navigation pédagogique et provenance des données accessibles sans menu latéral permanent.
- Départ du premier wagon lors d'un nouveau bloc reçu, promotion du second à sa place et arrivée de son remplaçant depuis le bas.
- Couleur de carrosserie commune et wagons centrés sur la chaussée verticale pendant leurs déplacements.
- Quai exclusivement à droite, embarquement par la porte haute à droite et sortie par une porte basse à droite, avec ouverture des portes correspondantes.
- Voyageurs maintenus à bord pendant le déplacement ; les sorties nécessaires commencent après l'arrivée, avec un retour en file sans traversée de la chaussée.
- Géométrie commune entre les wagons dessinés, leurs portes et le moteur des trajets.
- Suivi Bitcoin et Ethereum borné à 2 048 identifiants par chaîne pendant 30 minutes, avec au plus 2 144 identifiants transitoires le temps de vérifier avant éviction ; une disparition de l'échantillon ne confirme rien.

### Contrat et suivi

- Journal facultatif `Snapshot.inclusions` : blocs vérifiés et identifiants suivis réellement inclus, maximum 16 blocs et 2 048 identifiants au total, en complément des 120 transactions et trois blocs courants.
- Rattrapage de huit blocs au maximum par collecte, réessai des lacunes et journal rejoué sans consommation par le premier visiteur. Hashes, hauteurs et identifiants validés ; cohérence avec les blocs affichés à hauteur commune.
- Suivi et journal volatiles, sensibles aux redémarrages, expirations, évictions et réorganisations ; aucune promesse d'historique exhaustif ou de finalité.
- Limites de représentation : 80 voyageurs en attente, normalement 160 résidents et 80 admissions différées ; une préparation peut conserver temporairement 912 résidents et jusqu'à 752 inclusions superposables.

### Validation

- Tests et contrôles de compilation suspendus à la demande du propriétaire. Le contrat, le rattrapage, les bornes temporaires, les compteurs d'archive, les mouvements réduits et les couleurs ne sont pas déclarés validés ; les résultats des versions précédentes ne les couvrent pas.

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
