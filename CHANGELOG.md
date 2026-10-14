# Journal des versions

Le projet suit le versionnement sémantique. Les dates utilisent le calendrier Europe/Zurich. Une entrée représente le contenu de la version ; sa livraison publique est une opération distincte.

## À venir

### Interface

- Occupants du wagon précédent conservés pendant son départ jusqu'à sa sortie de l'écran.
- Transfert du candidat accéléré et arrivée de son remplaçant depuis le bas de l'écran, avec la même horloge que les voyageurs.
- Nouvelles transactions arrivant depuis le haut du quai ; wagon observé descendu pour dégager leur arrivée.
- Portes sans marches, avec personnages dessinés au-dessus pendant leur passage.
- Préparation rapide des voyageurs concernés pendant une demi-seconde avant le départ du bloc.
- Voyageurs conservés lors des changements d'échantillon, avec superposition des occupants du wagon observé et sortie visible avant recyclage hors écran.
- Disposition adaptée aux grands écrans, aux ordinateurs portables et aux petits écrans, avec barres plus compactes pour libérer la scène.
- Bitcoin et Ethereum visibles simultanément, avec des sources et des états de connexion indépendants.
- Vue immersive qui occupe la fenêtre, deux rues verticales sur ordinateur et deux scènes compactes sur mobile.
- Commandes communes pour les animations et les modes de données, panneau de détails repliable et sélection rattachée au réseau.
- Navigation pédagogique et provenance des données accessibles sans menu latéral permanent.
- Transfert du wagon candidat vers le wagon observé lors d'un nouveau bloc : après l'arrivée, les voyageurs dont la source confirme l'inclusion restent à bord ; les autres encore présents en attente reviennent en file.
- Couleur de carrosserie commune et wagons centrés sur la chaussée verticale pendant leurs déplacements.
- Quai exclusivement à droite, embarquement par la porte haute à droite et sortie par une porte basse à droite, avec ouverture des portes correspondantes.
- Voyageurs maintenus à bord pendant le déplacement ; les sorties nécessaires commencent après l'arrivée, avec un retour en file sans traversée de la chaussée.
- Géométrie commune entre les wagons dessinés, leurs portes et le moteur des trajets.
- Suivi Bitcoin borné en mémoire et vérification des identifiants dans le dernier bloc pour retrouver les transactions réellement incluses. Une disparition de l'échantillon ne confirme rien.

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
