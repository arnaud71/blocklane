# Sécurité de BlockLane

## Périmètre

BlockLane consulte et visualise des données publiques. Il ne gère ni portefeuille, ni clé de signature, ni fonds, ni diffusion de transactions. Les points d'accès blockchain sont configurés par l'opérateur côté serveur. Les visiteurs ne peuvent pas fournir une URL à interroger.

Les données des fournisseurs sont non fiables : elles doivent être validées et bornées avant d'être transmises à l'interface. L'API mutualise son cache entre visiteurs, limite les échantillons et interrompt les appels trop longs. Les URL de fournisseurs sont limitées à HTTPS, avec une exception HTTP pour les adresses de boucle locale.

Le serveur public doit fonctionner derrière un reverse proxy HTTPS avec limite de débit, limites de connexion et protection adaptée au trafic. Le serveur Node et le cache en mémoire ne constituent pas une protection contre une attaque distribuée. Pour des points d'accès internes, appliquer aussi une politique réseau sortante au niveau de l'hébergement : la validation de syntaxe d'une URL ne remplace pas ce contrôle.

La limite API initiale est de 120 requêtes par minute et adresse cliente. `TRUSTED_PROXY_IPS` est vide par défaut. Lorsqu'un proxy est déclaré par son IP exacte, un `X-Real-IP` unique et valide peut identifier son client ; le proxy doit écraser cet en-tête et l'accès direct au backend doit rester limité. `X-Forwarded-For` est toujours ignoré. Ne pas déclarer un réseau entier ou une adresse supposée : utiliser l'adresse de socket réelle, particulièrement dans Docker. Sans proxy déclaré, ses visiteurs partagent la même limite.

## Secrets et confidentialité

- Mettre les clés fournisseurs dans les secrets de l'hébergeur ou un `.env` local ignoré par Git.
- Ne jamais les mettre dans une variable `VITE_*`, un fichier client ou un paramètre fourni par un visiteur.
- Ne pas journaliser les URL RPC complètes, headers d'authentification ou réponses d'erreur du fournisseur.
- Après une exposition, révoquer la clé, vérifier son usage et la remplacer. Retirer une clé du dernier commit ne suffit pas à la faire disparaître de l'historique.
- Les identifiants de transaction sont publics mais peuvent être corrélés. N'ajouter des adresses, profils nominatifs ou outils de suivi qu'avec un objectif pédagogique explicite.

La version initiale n'ajoute pas d'outil d'analytics ni de cookie publicitaire. Le fournisseur voit les requêtes sortantes du serveur ; les hébergeurs et reverse proxies peuvent conserver leurs propres journaux. L'opérateur doit documenter leurs règles de conservation avant la mise en ligne.

## Vulnérabilités et incident

Pour signaler une vulnérabilité, utiliser le [canal privé GitHub de BlockLane](https://github.com/arnaud71/blocklane/security/advisories/new), activé sur le dépôt public arnaud71/blocklane. Ne pas ouvrir une issue publique contenant un secret ou une procédure d’exploitation non corrigée. Les alertes de dépendances, la détection des secrets et la protection au push sont activées ; elles ne remplacent pas la revue et le contrôle de l’historique avant publication.

Fournir la version affectée, le comportement observé, des étapes minimales de reproduction et l'impact, sans donnée sensible. Les mainteneurs évaluent l'exposition, préparent le correctif, le vérifient et organisent la livraison et la communication. Aucun délai de réponse contractuel n'est défini par cette version initiale.

La maintenance cible la dernière version publiée. Il n'existe pas encore de branches LTS applicatives. L'audit runtime CI bloque les vulnérabilités de niveau élevé ou critique connues de npm ; il ne prouve pas l'absence de vulnérabilité. Vérifier périodiquement l'arbre complet, le runtime Node, les images système et les actions CI.

## Garanties de provenance

Une donnée ancienne doit rester signalée. Une source indisponible ne doit pas être simulée sous une étiquette de direct. Les illustrations ne garantissent ni l'inclusion, ni la confirmation, ni la finalité d'une transaction. Une altération de ces comportements est un incident d'intégrité des données, même si le serveur reste accessible.
