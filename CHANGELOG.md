# Journal des versions

Le projet suit le versionnement sémantique. Les dates utilisent le calendrier Europe/Zurich. Une entrée représente le contenu de la version ; sa livraison publique est une opération distincte.

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
