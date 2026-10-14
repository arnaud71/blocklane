# Exploitation et maintenance

Automatisation enregistrée le 14 octobre 2026 : `maintenance-hebdomadaire-blocklane`, attachée au chat du projet, active chaque lundi à 09 h (Europe/Zurich). Elle prépare des correctifs vérifiables, reste silencieuse en l'absence de changement utile et n'effectue aucune fusion ni publication. Pour les exécutions locales, garder le poste éveillé et l'application ouverte.

## Responsabilités

Codex peut préparer des correctifs, mises à jour, tests et PR dans ce projet. L'automatisation hebdomadaire doit être enregistrée dans Codex pour déclencher ce travail ; `AGENTS.md` et Dependabot ne réveillent pas seuls un agent local. Le poste ou l'environnement d'exécution, les autorisations et les comptes nécessaires doivent être disponibles. Aucune maintenance permanente ni astreinte n'est garantie par ce dépôt.

Le propriétaire conserve la décision de fusion et de publication. Un hébergement public a besoin d'un responsable pour les comptes, le domaine, les incidents et les coûts. Ne pas confondre une proposition de correction vérifiée avec une livraison en production.

## À configurer après création du dépôt distant

1. Publier le dépôt et protéger `main` : PR obligatoire, contrôles CI obligatoires, historique sans force-push, suppression de branche protégée interdite.
2. Activer Dependabot et ses alertes, ainsi que la détection et le signalement privé de secrets/vulnérabilités lorsque l'offre du dépôt le permet.
3. Conserver les permissions Actions minimales ; ne pas donner de secrets de déploiement aux PR ni aux forks.
4. Renseigner le contact de sécurité dans `SECURITY.md` et définir qui valide une release.
5. Créer les secrets et limites fournisseur dans l'environnement serveur ; vérifier leur rotation.
6. Définir le domaine HTTPS, les limites au reverse proxy et des sondes externes. Le proxy doit remplacer `X-Real-IP` par l'IP cliente observée ; déclarer son adresse de socket exacte dans `TRUSTED_PROXY_IPS`.
7. Configurer une alerte de service et une alerte de source ancienne/indisponible. Le simple HTTP 200 du serveur ne prouve pas que les données sont fraîches.
8. Vérifier l'automatisation de maintenance Codex dans l'application et son accès au projet.

Les workflows du dépôt sont préparés ; ils ne configurent pas automatiquement ces paramètres GitHub ni l'hébergement.

La suspension des tests et contrôles demandée par le propriétaire reste applicable aux changements locaux actuels : les procédures de vérification ci-dessous décrivent une reprise autorisée ou une future livraison, pas des contrôles effectués pour la conversion USD. L'état précis figure dans [validation.md](validation.md).

## Chaque semaine

- Lire les alertes de sécurité, les propositions Dependabot et les résultats CI récents.
- Vérifier la disponibilité et la fraîcheur des deux chaînes, sans diffuser d'URL contenant une clé dans les sorties.
- Examiner les annonces officielles de Node, des dépendances affectées et des fournisseurs si un contrat a changé.
- Préparer les mises à jour compatibles dans une branche `codex/maintenance-YYYY-MM-DD`. Une PR claire peut regrouper des correctifs cohérents ; séparer les migrations majeures.
- Exécuter `npm run check`, `npm run format:check`, `npm run test:e2e` et l'audit applicable. Reproduire les problèmes de données avec des fixtures contrôlées.
- Signaler uniquement un changement utile : faille, panne persistante, mise à jour vérifiable, besoin de décision ou correctif prêt. Rester silencieux si rien d'actionnable n'a changé.

Dependabot propose les versions, sans les fusionner. L'automatisation peut préparer une PR ; elle ne doit pas publier une application ni modifier des secrets sans autorisation correspondante.

## Chaque mois et avant une migration

Vérifier l'arbre complet avec `npm audit`, pas seulement le runtime. Examiner le support Node, le système de l'image, les actions CI épinglées et le poids du bundle. Vérifier le clavier, mobile, pause et mouvement réduit. Confirmer que la démonstration est étiquetée, que les anciennes données sont signalées et que le lien FairOnChain reste facultatif.

Pour une version majeure, lire le guide officiel de migration, proposer les adaptations et tester le parcours complet. Ne pas utiliser `npm audit fix --force`. Documenter les modifications du contrat, les incompatibilités et le retour arrière. Programmer la migration Node avant la fin de support de la version choisie ; vérifier le [calendrier Node officiel](https://nodejs.org/en/about/previous-releases).

## Diagnostiquer une panne de données

1. Vérifier que le service répond à `GET /api/health` puis consulter les états de chaîne dans l'interface ou les instantanés API.
2. Distinguer liveness du serveur, accès réseau upstream et fraîcheur des données. Une chaîne peut échouer sans arrêter l'autre.
3. Vérifier DNS, HTTPS, quota, statut fournisseur et présence de la configuration côté serveur. Inspecter des messages sanitizés ; ne pas copier une URL RPC complète.
4. Respecter le cache partagé de 3 secondes après chaque collecte. Éviter de rafraîchir en boucle ou de multiplier les instances : cela augmente les appels upstream. Le délai court accroît la fréquence possible des collectes ; la déduplication ne vaut que pour une même instance du serveur.
5. Reproduire un changement de payload avec une fixture anonymisée. Ne jamais désactiver la validation pour accepter un payload inconnu.
6. Si une clé est compromise, la révoquer et la remplacer dans les secrets de l'hébergeur.
7. Si un fournisseur doit être remplacé, vérifier le contrat du nouvel endpoint et les tests, puis redémarrer avec la nouvelle configuration. La source affichée doit correspondre à la provenance réelle.

Une panne upstream peut afficher le dernier instantané pendant 120 secondes avec le statut ancien. Au-delà, la source doit être indisponible. Il n'y a aucune bascule automatique vers une simulation.

## Diagnostiquer une conversion USD indisponible

Le cours possède sa propre provenance et fraîcheur, indépendantes de la blockchain. Une chaîne peut rester en direct avec `usdQuote: null` ; les frais natifs restent consultables. Examiner la source Coinbase, l'heure de réception et le statut du cours sans traiter cette panne comme une panne Bitcoin ou Ethereum. Le renouvellement fonctionne en arrière-plan : une première réponse sans cours peut être suivie d'une réponse avec cours, sans bloquer les données blockchain.

Les seules destinations sont les routes spot fixes BTC/USD et ETH/USD de `api.coinbase.com`. Pour HEG, autoriser DNS et HTTPS sortant vers `api.coinbase.com:443` si l'affichage USD est souhaité. Aucun secret, paramètre d'environnement ou fournisseur choisi par le visiteur n'est ajouté. Respecter le cache de cours de 60 secondes après chaque tentative, distinct du cache blockchain de trois secondes ; un redémarrage efface les caches et plusieurs instances multiplient les lectures.

Une requête de cours est limitée à huit secondes et 16 Kio. Un ancien cours peut être conservé au plus cinq minutes depuis sa réception, signalé comme ancien, puis la conversion devient indisponible. Ne pas désactiver ces limites, inventer un cours de démonstration ou substituer zéro. Le total Ethereum reste une estimation avec limite de gas déclarée, pas le coût payé ; le cours relevé n'est pas celui du bloc historique. En cas d'évolution du payload, adapter une fixture contrôlée et le contrat après reprise autorisée des validations. [Documentation Coinbase](https://docs.cdp.coinbase.com/coinbase-app/track-apis/prices).

## Livraison vérifiée

1. Partir d'un commit revu avec CI verte et un espace de travail propre. Vérifier le changelog et la version `package.json` / lockfile.
2. Exécuter les contrôles prévus et compiler depuis le lockfile avec `npm ci`. Les tests navigateur utilisent des données contrôlées ; compléter par un test direct de lecture des fournisseurs avant la publication.
3. Construire l'image conteneur et noter le commit, la version Node, le digest de l'image de base résolue et le digest de l'image produite. Le tag de base `node:24-bookworm-slim` reçoit des mises à jour ; conserver les digests de la livraison pour la reproductibilité opérationnelle.
4. Lancer l'image dans un environnement de préproduction avec les mêmes variables non secrètes. Vérifier santé, deux chaînes, anciens instantanés, erreurs, fichiers statiques et fonctionnement sans FairOnChain.
5. Conserver l'image actuellement déployée et un export protégé de sa configuration, sans écrire les secrets dans Git.
6. Présenter la version et les vérifications au propriétaire ; déployer seulement avec l'autorisation appropriée.
7. Après livraison, vérifier le domaine HTTPS, les sources, les limites du proxy et les alertes. Créer le tag SemVer et la release correspondant exactement au commit livré.

Il n'existe pas de job de déploiement automatique dans cette version. Ajouter un pipeline de livraison uniquement après choix de l'hébergement et des règles de validation.

## Conteneur local

```sh
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 blocklane
docker compose down
```

Le port est publié uniquement sur `127.0.0.1:3001` côté hôte. HTTPS et la publication du domaine sont à gérer par le reverse proxy. `HOST=0.0.0.0` est défini à l'intérieur du conteneur ; cela ne publie pas son port sur toutes les interfaces de l'hôte. Les variables `.env` servent aussi à l'interpolation Compose ; garder ce fichier privé.

La valeur `TRUSTED_PROXY_IPS` est une liste d'IP IPv4/IPv6 exactes, séparées par virgules, limitée à 64 entrées et sans CIDR. Avec un proxy situé sur l'hôte, l'adresse vue depuis le conteneur peut être une passerelle Docker plutôt que `127.0.0.1`. Vérifier la topologie avant de déclarer une confiance. Une mauvaise configuration regroupe les visiteurs sous le quota du proxy, ou permet d'usurper le quota d'un autre client. `API_RATE_LIMIT_PER_MINUTE` accepte un entier de 1 à 10000, par défaut 120 ; augmenter cette valeur ne remplace pas les contrôles du reverse proxy.

Le cache ne nécessite aucune sauvegarde. Sauvegarder le dépôt distant, les configurations d'exploitation et les références des images publiées. Les secrets doivent vivre dans un coffre ou dans les mécanismes protégés de l'hébergeur.

## Retour arrière

Redéployer l'image précédente par digest avec sa configuration compatible, puis vérifier santé et provenance des données. Avec Compose, remplacer l'image du service par la référence précédente dans un fichier d'exploitation, puis exécuter `docker compose up -d` ; ne pas reconstruire un ancien tag flottant en espérant retrouver le même artefact.

L'état en mémoire peut être perdu sans migration. Si une future version ajoute une base ou modifie un contrat durable, son plan de migration et de retour arrière devient un préalable à la livraison. Documenter la cause et le correctif après l'incident.

## Références des actions CI initiales

Les actions sont épinglées à des commits complets vérifiés dans leurs releases officielles le 14 octobre 2026 : [checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1), [setup-node v7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0) et [upload-artifact v7.0.2](https://github.com/actions/upload-artifact/releases/tag/v7.0.2). Dependabot propose leur évolution. Vérifier la release, les permissions et le runtime exigé lors d'un changement de pin ; utiliser un runner maintenu.
