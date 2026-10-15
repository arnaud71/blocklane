# Instructions de maintenance de BlockLane

## Intention

BlockLane est un observatoire pédagogique public, inspiré de la métaphore de transport de TxStreet, avec une scène et du code originaux. Conserver une interface française, lisible, esthétique et accessible. Bitcoin et Ethereum sont les deux réseaux initiaux. La personnalisation HEG et un lien FairOnChain doivent rester facultatifs.

Les demandes explicites de l'utilisateur priment sur ce guide. Progresser de façon autonome sur les actions réversibles déjà autorisées. Ce guide n'impose pas une nouvelle confirmation pour les correctifs ordinaires.

## Architecture à préserver

- React, TypeScript strict et Vite pour l'interface ; Canvas 2D natif pour les voyageurs individuels et SVG/CSS pour les wagons, portes, phares, maisons, textes et groupes collectifs statiques. Préserver la sélection au pointeur et le navigateur de transactions HTML accessible au clavier, sans recréer un élément DOM par voyageur.
- API HTTP Node 24 en lecture seule ; fournisseurs et clés configurés côté serveur.
- Contrat partagé validé par Zod entre les adaptateurs et l'interface.
- Aucun accès FairOnChain nécessaire au chargement, aux données ou aux animations.
- Ajouter une chaîne par un adaptateur documenté ; garder sa logique hors de la scène.
- Introduire un service, une dépendance ou une base de données seulement avec un besoin concret et une décision dans `docs/architecture.md`.

## Honnêteté des données

- Ne jamais remplacer silencieusement une panne du direct par des données simulées.
- Garder distincts mode démonstration, direct valide, données anciennes et indisponibilité.
- La scène est un échantillon limité ; ne pas la présenter comme un inventaire exhaustif.
- Respecter la distinction Ethereum `pending` / dernier bloc confirmé. Ne jamais inventer une taille de mempool mondial.
- Les blocs Bitcoin n'ont pas une échéance garantie ; les slots Ethereum ne garantissent pas l'inclusion ni la finalité.
- Une transaction visible, une estimation de frais ou un déplacement animé ne prouve pas une confirmation.
- Ne pas ajouter de portefeuille, de signature, de diffusion de transaction ou de conseil d'investissement dans le périmètre actuel.

## Sécurité

- Ne jamais enregistrer de secrets, clés RPC, jetons ou `.env` réels dans Git, une capture ou une sortie d'outil.
- Les clés ne doivent jamais apparaître dans `src/`, `VITE_*`, l'API publique, les messages d'erreur ou le bundle.
- Les visiteurs ne choisissent pas les URL upstream. Garder une liste fixe de routes ; aucune route de proxy arbitraire.
- Valider et borner les données distantes avant affichage. Préserver délai d'expiration, limite de taille, cache partagé et limite d'objets.
- Ne pas diminuer les contrôles de sécurité ou masquer un échec CI pour livrer.
- Ne pas exécuter `npm audit fix --force` ni migrer une version majeure sans analyser la compatibilité.
- N'ajouter ni fusion ni déploiement automatique. Les livraisons passent par une validation explicite dans l'environnement retenu.

## Procédure de changement

1. Lire l'état Git et les fichiers concernés ; préserver les changements du propriétaire et des autres agents.
2. Utiliser une branche `codex/...` pour une proposition traçable. Ne jamais réécrire l'historique partagé ni forcer un push.
3. Pour un changement métier, ajouter ou adapter des tests qui vérifient le contrat réel : payload invalide, panne, ancienneté, provenance, bornes ou comportement utilisateur. Éviter les tests qui recopient l'implémentation.
4. Lancer `npm run check` et `npm run format:check`. Exécuter `npm run test:e2e` pour un changement d'interface, d'API ou de contrat. Ne pas dépendre des API réelles dans les tests automatiques.
5. Vérifier visuellement un changement de scène sur desktop et mobile, au clavier et en mouvement réduit. Respecter le bouton de pause et éviter les animations coûteuses.
6. Exécuter l'audit de dépendances lorsque le manifeste, le lockfile ou le runtime change. Examiner aussi les dépendances de développement, même si l'audit bloquant CI cible le runtime.
7. Documenter les changements visibles, incompatibilités, sources et limites dans le changelog. Mettre à jour les procédures affectées.
8. Présenter les tests effectués et les limitations restantes dans la PR. Éviter les mises à jour massives sans rapport.

Avant une publication GitHub, configurer les protections de branche et les contrôles obligatoires. Un fichier de workflow n'active pas ces protections à lui seul.

## Maintenance périodique

Examiner Dependabot, les avis de sécurité Node et des dépendances, les contrats des fournisseurs et les erreurs remontées. Mettre à jour d'abord les correctifs compatibles, dans une PR vérifiable. Conserver les migrations majeures dans des propositions distinctes avec plan de retour arrière. Ne pas promettre une maintenance permanente si l'automatisation, l'accès aux comptes ou l'hébergement ne sont pas actifs.

Préférer les sources officielles pour vérifier une évolution technique. Inscrire une décision qui modifie la provenance des données, la sémantique des animations, le contrat partagé ou l'hébergement. Consulter `docs/maintenance.md` et `SECURITY.md` avant une intervention opérationnelle.
