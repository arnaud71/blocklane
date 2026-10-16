import { BITCOIN_ARRIVALS_MAX_AGE_MS, type Snapshot, type Tx } from '../../shared/model';

export interface BitcoinArrivalObservation {
  source: string;
  observedAt: number;
}

const bitcoinArrivalCache = new WeakMap<
  Snapshot,
  {
    ids: ReadonlySet<string>;
    observation: BitcoinArrivalObservation;
  } | null
>();

/** A received pending detail proves presence in this source, not absence/presence in another node. */
export function bitcoinArrivalObservation(
  snapshot: Snapshot | null,
  tx: Tx,
): BitcoinArrivalObservation | undefined {
  if (!snapshot || tx.chain !== 'bitcoin' || tx.status !== 'pending') return undefined;
  let cached = bitcoinArrivalCache.get(snapshot);
  if (cached === undefined) {
    const arrivals = snapshot.bitcoinArrivals;
    const active =
      snapshot.chain === 'bitcoin' &&
      snapshot.mode === 'live' &&
      snapshot.status !== 'unavailable' &&
      arrivals &&
      arrivals.observedAt <= snapshot.observedAt &&
      snapshot.observedAt - arrivals.observedAt <= BITCOIN_ARRIVALS_MAX_AGE_MS;
    const pending = new Set(
      snapshot.transactions
        .filter((entry) => entry.status === 'pending')
        .map((entry) => entry.id.toLowerCase()),
    );
    cached = active
      ? {
          ids: new Set(
            arrivals.transactionIds.map((id) => id.toLowerCase()).filter((id) => pending.has(id)),
          ),
          observation: { source: arrivals.source, observedAt: arrivals.observedAt },
        }
      : null;
    bitcoinArrivalCache.set(snapshot, cached);
  }
  return cached?.ids.has(tx.id.toLowerCase()) ? cached.observation : undefined;
}

export interface PassengerStatusObservation {
  tx: Tx;
  sourceObserved: boolean;
  poolState?: 'pending' | 'queued' | 'absent' | 'replaced' | 'unknown';
  poolObservedAt?: number;
  bitcoinArrival?: BitcoinArrivalObservation;
}

export type PassengerStatusKind =
  'confirmed' | 'pending' | 'queued' | 'absent' | 'replaced' | 'observed' | 'unknown';

export type PassengerStatusGroup = 'current' | 'queued' | 'history' | 'confirmed';

export interface PassengerStatus {
  readonly kind: PassengerStatusKind;
  readonly label: string;
  readonly description: string;
  readonly group: PassengerStatusGroup;
}

function statusKind(observation: PassengerStatusObservation): PassengerStatusKind {
  if (observation.tx.status === 'confirmed') return 'confirmed';
  if (observation.tx.chain === 'bitcoin' && observation.bitcoinArrival) return 'observed';
  if (observation.poolState !== undefined && observation.poolState !== 'unknown')
    return observation.poolState;
  return observation.sourceObserved ? 'observed' : 'unknown';
}

const poolTime = new Intl.DateTimeFormat('fr-CH', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function observationTime(observedAt: number | undefined): string {
  return observedAt !== undefined &&
    Number.isSafeInteger(observedAt) &&
    observedAt >= 0 &&
    observedAt <= 8_640_000_000_000_000
    ? `, relevé à ${poolTime.format(observedAt)}`
    : '';
}

/** Presence has its own dated evidence; old individual details never turn it into history. */
export function passengerStatus(observation: PassengerStatusObservation): PassengerStatus {
  const kind = statusKind(observation);
  if (kind === 'confirmed')
    return {
      kind: 'confirmed',
      label: 'incluse dans un bloc observé',
      description: 'incluse dans un bloc observé',
      group: 'confirmed',
    };

  const datedPool = observationTime(observation.poolObservedAt);
  if (kind === 'absent')
    return {
      kind: 'absent',
      label: 'absente du dernier relevé complet du fournisseur',
      description: `absente du dernier relevé complet du fournisseur${datedPool}, sans preuve de confirmation`,
      group: 'history',
    };
  if (kind === 'replaced')
    return {
      kind: 'replaced',
      label: 'candidature remplacée',
      description: `candidature remplacée par une transaction plus récemment observée du même compte et avec le même nonce${datedPool}, sans preuve de confirmation`,
      group: 'history',
    };
  if (kind === 'queued')
    return {
      kind: 'queued',
      label: 'différée (queued) dans le dernier relevé du fournisseur',
      description: `différée (queued) dans le dernier relevé du fournisseur${datedPool}`,
      group: 'queued',
    };
  if (kind === 'pending')
    return {
      kind: 'pending',
      label: 'en attente dans le dernier relevé complet du fournisseur',
      description: `en attente dans le dernier relevé complet du fournisseur${datedPool}${observation.sourceObserved ? '' : ' ; détails individuels conservés'}`,
      group: 'current',
    };
  if (kind === 'observed')
    return {
      kind: 'observed',
      label: observation.bitcoinArrival
        ? `en attente observée par ${observation.bitcoinArrival.source}`
        : 'en attente dans la source',
      description: observation.bitcoinArrival
        ? `en attente observée par ${observation.bitcoinArrival.source}${observationTime(observation.bitcoinArrival.observedAt)} ; cette présence ne garantit pas sa présence chez un autre fournisseur et ne prouve aucune inclusion`
        : 'en attente dans la source',
      group: 'current',
    };
  return {
    kind: 'unknown',
    label: 'dernière observation · statut actuel inconnu',
    description:
      'dernière observation conservée, absente de l’échantillon actuel ; statut actuel inconnu',
    group: 'history',
  };
}

export function isHistoricalPassenger(observation: PassengerStatusObservation): boolean {
  const kind = statusKind(observation);
  return kind === 'unknown' || kind === 'absent' || kind === 'replaced';
}
