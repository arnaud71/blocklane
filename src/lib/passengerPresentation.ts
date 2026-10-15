import type { PassengerPose } from './passengerMotion';

const phaseLabels = {
  arriving: 'arrivée depuis le bord extérieur du quai',
  queue: 'sur le quai',
  reordering: 'rejoint sa place réservée dans la file',
  parked: 'en attente visuelle sur le quai, statut actuel non suivi',
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

export function passengerDescription(
  pose: PassengerPose,
  feeLabel?: string,
  interactive = true,
): string {
  const tx = pose.tx;
  return (
    'Transaction ' +
    tx.id.slice(0, 12) +
    ', ' +
    (feeLabel ?? `${tx.feeRate.toFixed(2)} ${tx.chain === 'bitcoin' ? 'sat/vB' : 'Gwei'}`) +
    ', ' +
    (pose.sourceObserved
      ? tx.status === 'confirmed'
        ? 'incluse dans un bloc observé'
        : 'en attente dans la source'
      : 'dernière observation conservée, absente de l’échantillon actuel') +
    '. ' +
    (pose.inHandoff ? 'à bord pendant le transfert' : phaseLabels[pose.phase]) +
    (interactive && pose.sourceObserved ? '. Afficher les détails.' : '.')
  );
}
