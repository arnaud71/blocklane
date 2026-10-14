# Voyageurs, wagons et panneau du quai

La scène utilise les transactions validées de la source. Leur statut de réseau et leur état d'animation sont deux données différentes : une transaction peut être **à bord du candidat illustratif** et rester **en attente dans la source**.

## Parcours

```mermaid
stateDiagram-v2
    [*] --> Quai
    Quai --> Marche
    Marche --> Embarquement: place dans la projection
    Embarquement --> A_bord
    Marche --> Sortie: frais ou place insuffisants dans la projection
    A_bord --> Sortie: priorité modifiée dans un nouvel échantillon
    Sortie --> Retour
    Retour --> Quai
```

Les transactions sont classées selon les frais observés, puis l'identifiant pour stabiliser les égalités. Le candidat possède douze unités **visuelles**. Un voyageur occupe une à trois unités selon ses besoins de ressources : référence de 400 vBytes pour Bitcoin et 100 000 unités de gas pour Ethereum. Le tarif de référence de l'instantané sert de repère pédagogique. Ces règles simplifiées n'intègrent pas les dépendances Bitcoin, les nonces Ethereum, les transactions privées, la sélection des producteurs ni toutes les contraintes du protocole.

Un voyageur moins prioritaire rejoint la porte, revient au quai et peut réessayer. Un nouvel instantané peut déplacer un voyageur précédemment embarqué si un meilleur candidat occupe le budget illustratif. Aucun de ces mouvements n'annonce un rejet du réseau.

Seules les transactions dont la source fournit le statut `confirmed` rejoignent le wagon observé. Une disparition de l'échantillon n'est pas une confirmation. Une réorganisation signalée par un nouveau statut en attente remet le voyageur dans le parcours correspondant. Les départs en direct restent liés au changement du hash du bloc observé ; en simulation, les départs sont fictifs.

## Taille des têtes

Seule la tête change d'échelle. Elle dépend d'une courbe logarithmique absolue et bornée entre 0,8 et 1,85. La même transaction conserve sa taille lorsque ses voisins changent. Pour Bitcoin, la ressource est sa taille virtuelle en vBytes ; pour Ethereum, c'est sa **limite de gas déclarée**, pas sa taille en octets ni le gas effectivement consommé.

## Horloge et accessibilité

`src/lib/passengerMotion.ts` est un moteur pur, indépendant du dessin. `src/hooks/usePassengerMotion.ts` utilise une seule horloge `requestAnimationFrame`, avec rendu à environ 24 images par seconde, jusqu'à 80 voyageurs et pas de saut de temps après pause ou retour d'un onglet masqué. Le décor est mémorisé pour éviter de le recalculer à chaque mouvement.

Pause suspend les voyageurs, les wagons, les signaux et le défilement du panneau. Les mouvements réduits placent les voyageurs à leur destination illustrative sans trajet animé. Les personnages restent sélectionnables au clavier, y compris dans les wagons. Les confirmations et la fraîcheur affichées gardent la sémantique de la source.

## Panneau d'informations

Le panneau alterne toutes les huit secondes entre Réseau, Bloc et Voyageurs. Une sélection fixe les données actuelles de la transaction ; Échap ou le bouton de libération permet de retrouver le panneau. Les pages restent accessibles manuellement, avec les flèches du clavier. Les détails sélectionnés suivent l'instantané courant et disparaissent lorsque la transaction n'est plus dans l'échantillon disponible.

Les compteurs du panneau concernent la scène représentée. Le nombre de transactions du réseau reste distinct, et sa valeur absente est affichée comme non mesurée.
