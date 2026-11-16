import { translate, type Locale } from '../i18n/locale';
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

const englishPhaseLabels: Record<keyof typeof phaseLabels, string> = {
  arriving: 'arriving from the outer edge of the platform',
  queue: 'on the platform',
  reordering: 'moving to its reserved queue position',
  parked: 'visually waiting on the platform',
  walking: 'walking',
  boarding: 'illustrated boarding',
  preparing: 'rapid boarding before departure',
  boarded: 'aboard the illustrative vehicle',
  exiting: 'illustrated exit',
  returning: 'illustrated return to the queue',
  retiring: 'last observation leaving the platform',
  confirmed: 'observed inclusion',
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
export function passengerWaitingReason(pose: PassengerPose, locale: Locale = 'fr'): string {
  const t = (fr: string, en: string) => translate(locale, fr, en);
  if (pose.tx.status !== 'pending' || pose.inWagon || pose.destination !== 'queue') return '';
  if (pose.poolState === 'queued' || pose.reason === 'queued')
    return pose.poolState === 'queued'
      ? t(
          'Transaction différée (queued) dans le dernier relevé du fournisseur : elle ne monte pas dans la projection.',
          'Transaction queued in the provider’s latest inventory: it does not board the projection.',
        )
      : t(
          'Un ancien relevé indiquait une transaction différée (queued). Sa présence actuelle est inconnue ; une nouvelle observation est nécessaire.',
          'An older inventory reported a queued transaction. Its current presence is unknown; a new observation is needed.',
        );
  if (pose.poolState === 'absent' || pose.reason === 'absent')
    return pose.poolState === 'absent'
      ? t(
          'Absente du dernier relevé complet du fournisseur. Cette absence ne prouve aucune confirmation.',
          'Absent from the provider’s latest complete inventory. This absence does not prove confirmation.',
        )
      : t(
          'Une ancienne absence du pool empêche sa réadmission sans nouvelle observation. Sa présence actuelle est inconnue ; cette absence ne prouve aucune confirmation.',
          'An older pool absence prevents readmission without a new observation. Current presence is unknown; this absence does not prove confirmation.',
        );
  if (pose.poolState === 'replaced' || pose.reason === 'replaced')
    return t(
      'Une transaction plus récemment observée du même compte avec le même nonce remplace cette candidature ; aucune confirmation n’est déduite.',
      'A more recently observed transaction from the same account with the same nonce replaces this candidate; no confirmation is inferred.',
    );
  if (pose.reason === 'nonce')
    return t(
      'Une transaction précédente connue du même compte doit être admise avant ce nonce.',
      'A known preceding transaction from the same account must be admitted before this nonce.',
    );
  if (pose.reason === 'projection')
    return t(
      'La base fee du prochain bloc Ethereum est indisponible ou expirée : le plafond connu ne peut pas être évalué contre une ancienne référence.',
      'The next Ethereum block’s base fee is unavailable or expired: the known cap cannot be assessed against an old reference.',
    );
  if (pose.reason === 'fee' && pose.tx.chain === 'ethereum')
    return t(
      'Frais inférieurs à la base fee Ethereum de référence : plafond ou taux observé insuffisant, embarquement non prévu.',
      'Fees below the reference Ethereum base fee: the observed cap or rate is insufficient, so boarding is not planned.',
    );
  if (pose.reason === 'capacity')
    return t(
      'Capacité insuffisante ou inconnue dans les projections pour la taille déclarée de cette transaction.',
      'The projections have insufficient or unknown capacity for this transaction’s declared size.',
    );
  return '';
}

export function passengerDependencyDescription(pose: PassengerPose, locale: Locale = 'fr'): string {
  const t = (fr: string, en: string) => translate(locale, fr, en);
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
    return t(
      `${dependency.coverage === 'stale' ? 'Couverture de dépendances ancienne ou indisponible. ' : ''}Prédécesseur non observé pour le nonce ${nonce}. Projection incertaine : la catégorie pending du fournisseur ne prouve pas que cette transaction peut être exécutée.`,
      `${dependency.coverage === 'stale' ? 'Dependency coverage is stale or unavailable. ' : ''}Unobserved predecessor for nonce ${nonce}. Uncertain projection: the provider’s pending category does not prove this transaction can execute.`,
    );
  if (predecessor.state === 'gap')
    return t(
      `Un nonce intermédiaire manque dans la séquence connue du compte : le prédécesseur de nonce ${nonce} n’a pas été observé. Embarquement non prévu tant que cette dépendance n’est pas établie.`,
      `An intermediate nonce is missing from the account’s known sequence: the predecessor with nonce ${nonce} has not been observed. Boarding is not planned until this dependency is established.`,
    );
  if (predecessor.state === 'unknown')
    return t(
      `${dependency.coverage === 'stale' ? 'Couverture de dépendances ancienne ou indisponible. ' : ''}Le statut du prédécesseur connu de nonce ${nonce}${identifier} est inconnu. Son absence ne prouve aucune inclusion ; cette dépendance empêche l’embarquement.`,
      `${dependency.coverage === 'stale' ? 'Dependency coverage is stale or unavailable. ' : ''}The status of the known predecessor with nonce ${nonce}${identifier} is unknown. Its absence does not prove inclusion; this dependency prevents boarding.`,
    );
  if (predecessor.state === 'queued')
    return t(
      `Le prédécesseur connu de nonce ${nonce}${identifier} est différé (queued) chez le fournisseur. Il doit pouvoir être admis avant cette transaction.`,
      `The known predecessor with nonce ${nonce}${identifier} is queued at the provider. It must be eligible for admission before this transaction.`,
    );
  if (predecessor.state === 'confirmed')
    return t(
      `Le prédécesseur de nonce ${nonce}${identifier} a une inclusion exacte dans le bloc #${predecessor.blockHeight}. Cette preuve permet de réévaluer la projection ; elle ne confirme pas cette transaction.`,
      `The predecessor with nonce ${nonce}${identifier} has an exact inclusion in block #${predecessor.blockHeight}. This evidence allows the projection to be reassessed; it does not confirm this transaction.`,
    );
  return pose.reason === 'nonce' && !pose.inWagon
    ? t(
        `Le prédécesseur connu de nonce ${nonce}${identifier} doit être admis avant cette transaction, même lorsqu’il est hors de l’échantillon animé.`,
        `The known predecessor with nonce ${nonce}${identifier} must be admitted before this transaction, even when outside the animated sample.`,
      )
    : t(
        `Ordre de nonce projeté avec le prédécesseur connu de nonce ${nonce}${identifier}. Cette estimation ne prouve ni l’exécution ni l’inclusion.`,
        `Projected nonce order with the known predecessor with nonce ${nonce}${identifier}. This estimate proves neither execution nor inclusion.`,
      );
}

/** Also describes uncertain admission: an illustrated seat is not an execution guarantee. */
export function passengerPlanningReason(pose: PassengerPose, locale: Locale = 'fr'): string {
  const dependency = passengerDependencyDescription(pose, locale);
  return pose.reason === 'nonce' && dependency
    ? dependency
    : [passengerWaitingReason(pose, locale), dependency].filter(Boolean).join(' ');
}

export function passengerDescription(
  pose: PassengerPose,
  feeLabel?: string,
  interactive = true,
  locale: Locale = 'fr',
): string {
  const t = (fr: string, en: string) => translate(locale, fr, en);
  const tx = pose.tx;
  const fee = feeLabel ?? `${tx.feeRate.toFixed(2)} ${tx.chain === 'bitcoin' ? 'sat/vB' : 'Gwei'}`;
  const waitingReason = passengerPlanningReason(pose, locale);
  const presence = passengerStatus(pose, locale).description;
  return (
    'Transaction ' +
    tx.id.slice(0, 12) +
    ', ' +
    (pose.sourceObserved
      ? fee
      : t(`frais de la dernière observation : ${fee}`, `fees from the last observation: ${fee}`)) +
    ', ' +
    presence +
    '. ' +
    (pose.inHandoff
      ? t('à bord pendant le transfert', 'aboard during transfer')
      : (locale === 'fr' ? phaseLabels : englishPhaseLabels)[pose.phase]) +
    '.' +
    (pose.arrivalKind === 'initial-stock'
      ? t(
          ' Présente dans le stock initial observé ; son arrivée réelle dans le mempool est inconnue.',
          ' Present in the initially observed inventory; its actual arrival in the mempool is unknown.',
        )
      : pose.arrivalKind === 'new-observation'
        ? t(
            ' Nouvelle observation dans cette scène ; cet instant ne date pas son arrivée réelle dans le mempool.',
            ' New observation in this scene; this time does not date its actual arrival in the mempool.',
          )
        : pose.arrivalKind === 'late-inclusion'
          ? t(
              ' Inclusion découverte hors de l’échantillon ; départ depuis le reste du réseau. Cet instant ne date pas son arrivée réelle dans le mempool.',
              ' Inclusion discovered outside the sample; departure from the rest of the network. This time does not date its actual arrival in the mempool.',
            )
          : '') +
    (waitingReason ? ` ${waitingReason}` : '') +
    (!pose.sourceObserved
      ? t(
          ' La couleur reflète ces frais historiques ; elle ne garantit pas une priorité actuelle.',
          ' The colour reflects these historical fees; it does not guarantee current priority.',
        )
      : '') +
    (interactive ? t(' Afficher les détails.', ' View details.') : '')
  );
}
