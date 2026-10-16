import type { PassengerPose } from './passengerMotion';
import { passengerStatus } from './passengerStatus';

const phaseLabels = {
  arriving: 'arrivée depuis le bord extérieur du quai',
  queue: 'sur le quai',
  reordering: 'rejoint sa place réservée dans la file',
  parked: 'en attente visuelle sur le quai',
  walking: 'en marche',
  boarding: 'embarquement illustré',
  preparing: 'embarquement rapide avant le départ',
  boarded: 'à bord du wagon illustratif',
  exiting: 'sortie illustrée',
  returning: 'retour en file illustré',
  retiring: 'dernière observation quittant le quai',
  confirmed: 'inclusion observée',
};

export function stablePassengerHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function isPassengerMoving(pose: PassengerPose): boolean {
  return (
    !pose.inWagon &&
    !pose.inHandoff &&
    (pose.phase === 'arriving' ||
      pose.phase === 'reordering' ||
      pose.phase === 'walking' ||
      pose.phase === 'boarding' ||
      pose.phase === 'preparing' ||
      pose.phase === 'exiting' ||
      pose.phase === 'returning' ||
      pose.phase === 'retiring')
  );
}

/** A wait is a projection decision or a dated local observation, never a network rejection. */
export function passengerWaitingReason(pose: PassengerPose): string {
  if (pose.tx.status !== 'pending' || pose.inWagon || pose.destination !== 'queue') return '';
  if (pose.poolState === 'queued' || pose.reason === 'queued')
    return pose.poolState === 'queued'
      ? 'Transaction différée (queued) dans le dernier relevé du fournisseur : elle ne monte pas dans la projection.'
      : 'Un ancien relevé indiquait une transaction différée (queued). Sa présence actuelle est inconnue ; une nouvelle observation est nécessaire.';
  if (pose.poolState === 'absent' || pose.reason === 'absent')
    return pose.poolState === 'absent'
      ? 'Absente du dernier relevé complet du fournisseur. Cette absence ne prouve aucune confirmation.'
      : 'Une ancienne absence du pool empêche sa réadmission sans nouvelle observation. Sa présence actuelle est inconnue ; cette absence ne prouve aucune confirmation.';
  if (pose.poolState === 'replaced' || pose.reason === 'replaced')
    return 'Une transaction plus récemment observée du même compte avec le même nonce remplace cette candidature ; aucune confirmation n’est déduite.';
  if (pose.reason === 'nonce')
    return 'Une transaction précédente connue du même compte doit être admise avant ce nonce.';
  if (pose.reason === 'projection')
    return 'La base fee du prochain bloc Ethereum est indisponible ou expirée : le plafond connu ne peut pas être évalué contre une ancienne référence.';
  if (pose.reason === 'fee' && pose.tx.chain === 'ethereum')
    return 'Frais inférieurs à la base fee Ethereum de référence : plafond ou taux observé insuffisant, embarquement non prévu.';
  if (pose.reason === 'capacity')
    return 'Capacité insuffisante ou inconnue dans les projections pour la taille déclarée de cette transaction.';
  return '';
}

export function passengerDependencyDescription(pose: PassengerPose): string {
  if (pose.tx.status !== 'pending' || pose.tx.chain !== 'ethereum') return '';
  const dependency = pose.nonceDependency;
  if (!dependency || dependency.predecessor.state === 'root') return '';
  const predecessor = dependency.predecessor;
  const nonce = 'nonce' in predecessor ? predecessor.nonce : '';
  const identifier =
    'transactionId' in predecessor && predecessor.transactionId
      ? ` (${predecessor.transactionId.slice(0, 12)}…)`
      : '';
  if (predecessor.state === 'unobserved')
    return `${dependency.coverage === 'stale' ? 'Couverture de dépendances ancienne ou indisponible. ' : ''}Prédécesseur non observé pour le nonce ${nonce}. Projection incertaine : la catégorie pending du fournisseur ne prouve pas que cette transaction peut être exécutée.`;
  if (predecessor.state === 'gap')
    return `Un nonce intermédiaire manque dans la séquence connue du compte : le prédécesseur de nonce ${nonce} n’a pas été observé. Embarquement non prévu tant que cette dépendance n’est pas établie.`;
  if (predecessor.state === 'unknown')
    return `${dependency.coverage === 'stale' ? 'Couverture de dépendances ancienne ou indisponible. ' : ''}Le statut du prédécesseur connu de nonce ${nonce}${identifier} est inconnu. Son absence ne prouve aucune inclusion ; cette dépendance empêche l’embarquement.`;
  if (predecessor.state === 'queued')
    return `Le prédécesseur connu de nonce ${nonce}${identifier} est différé (queued) chez le fournisseur. Il doit pouvoir être admis avant cette transaction.`;
  if (predecessor.state === 'confirmed')
    return `Le prédécesseur de nonce ${nonce}${identifier} a une inclusion exacte dans le bloc #${predecessor.blockHeight}. Cette preuve permet de réévaluer la projection ; elle ne confirme pas cette transaction.`;
  return pose.reason === 'nonce' && !pose.inWagon
    ? `Le prédécesseur connu de nonce ${nonce}${identifier} doit être admis avant cette transaction, même lorsqu’il est hors de l’échantillon animé.`
    : `Ordre de nonce projeté avec le prédécesseur connu de nonce ${nonce}${identifier}. Cette estimation ne prouve ni l’exécution ni l’inclusion.`;
}

/** Also describes uncertain admission: an illustrated seat is not an execution guarantee. */
export function passengerPlanningReason(pose: PassengerPose): string {
  const dependency = passengerDependencyDescription(pose);
  return pose.reason === 'nonce' && dependency
    ? dependency
    : [passengerWaitingReason(pose), dependency].filter(Boolean).join(' ');
}

export function passengerDescription(
  pose: PassengerPose,
  feeLabel?: string,
  interactive = true,
): string {
  const tx = pose.tx;
  const fee = feeLabel ?? `${tx.feeRate.toFixed(2)} ${tx.chain === 'bitcoin' ? 'sat/vB' : 'Gwei'}`;
  const waitingReason = passengerPlanningReason(pose);
  const presence = passengerStatus(pose).description;
  return (
    'Transaction ' +
    tx.id.slice(0, 12) +
    ', ' +
    (pose.sourceObserved ? fee : `frais de la dernière observation : ${fee}`) +
    ', ' +
    presence +
    '. ' +
    (pose.inHandoff ? 'à bord pendant le transfert' : phaseLabels[pose.phase]) +
    '.' +
    (pose.arrivalKind === 'initial-stock'
      ? ' Présente dans le stock initial observé ; son arrivée réelle dans le mempool est inconnue.'
      : pose.arrivalKind === 'new-observation'
        ? ' Nouvelle observation dans cette scène ; cet instant ne date pas son arrivée réelle dans le mempool.'
        : pose.arrivalKind === 'late-inclusion'
          ? ' Inclusion découverte hors de l’échantillon ; départ depuis le reste du réseau. Cet instant ne date pas son arrivée réelle dans le mempool.'
          : '') +
    (waitingReason ? ` ${waitingReason}` : '') +
    (!pose.sourceObserved
      ? ' La couleur reflète ces frais historiques ; elle ne garantit pas une priorité actuelle.'
      : '') +
    (interactive ? ' Afficher les détails.' : '')
  );
}
