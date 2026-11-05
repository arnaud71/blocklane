import { BITCOIN_ARRIVALS_MAX_AGE_MS, type Snapshot, type Tx } from '../../shared/model';
import { languageTag, translate, type Locale } from '../i18n/locale';

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

const poolTimes = {
  fr: new Intl.DateTimeFormat(languageTag('fr'), {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }),
  en: new Intl.DateTimeFormat(languageTag('en'), {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }),
};

function observationTime(observedAt: number | undefined, locale: Locale): string {
  return observedAt !== undefined &&
    Number.isSafeInteger(observedAt) &&
    observedAt >= 0 &&
    observedAt <= 8_640_000_000_000_000
    ? translate(
        locale,
        `, relevé à ${poolTimes[locale].format(observedAt)}`,
        `, observed at ${poolTimes[locale].format(observedAt)}`,
      )
    : '';
}

/** Presence has its own dated evidence; old individual details never turn it into history. */
export function passengerStatus(
  observation: PassengerStatusObservation,
  locale: Locale = 'fr',
): PassengerStatus {
  const t = (fr: string, en: string) => translate(locale, fr, en);
  const kind = statusKind(observation);
  if (kind === 'confirmed')
    return {
      kind: 'confirmed',
      label: t('incluse dans un bloc observé', 'included in an observed block'),
      description: t('incluse dans un bloc observé', 'included in an observed block'),
      group: 'confirmed',
    };

  const datedPool = observationTime(observation.poolObservedAt, locale);
  if (kind === 'absent')
    return {
      kind: 'absent',
      label: t(
        'absente du dernier relevé complet du fournisseur',
        'absent from the provider’s latest complete inventory',
      ),
      description: t(
        `absente du dernier relevé complet du fournisseur${datedPool}, sans preuve de confirmation`,
        `absent from the provider’s latest complete inventory${datedPool}, without confirmation evidence`,
      ),
      group: 'history',
    };
  if (kind === 'replaced')
    return {
      kind: 'replaced',
      label: t('candidature remplacée', 'candidate replaced'),
      description: t(
        `candidature remplacée par une transaction plus récemment observée du même compte et avec le même nonce${datedPool}, sans preuve de confirmation`,
        `candidate replaced by a more recently observed transaction from the same account with the same nonce${datedPool}, without confirmation evidence`,
      ),
      group: 'history',
    };
  if (kind === 'queued')
    return {
      kind: 'queued',
      label: t(
        'différée (queued) dans le dernier relevé du fournisseur',
        'queued in the provider’s latest inventory',
      ),
      description: t(
        `différée (queued) dans le dernier relevé du fournisseur${datedPool}`,
        `queued in the provider’s latest inventory${datedPool}`,
      ),
      group: 'queued',
    };
  if (kind === 'pending')
    return {
      kind: 'pending',
      label: t(
        'en attente dans le dernier relevé complet du fournisseur',
        'pending in the provider’s latest complete inventory',
      ),
      description: t(
        `en attente dans le dernier relevé complet du fournisseur${datedPool}${observation.sourceObserved ? '' : ' ; détails individuels conservés'}`,
        `pending in the provider’s latest complete inventory${datedPool}${observation.sourceObserved ? '' : '; retained individual details'}`,
      ),
      group: 'current',
    };
  if (kind === 'observed')
    return {
      kind: 'observed',
      label: observation.bitcoinArrival
        ? t(
            `en attente observée par ${observation.bitcoinArrival.source}`,
            `pending, observed by ${observation.bitcoinArrival.source}`,
          )
        : t('en attente dans la source', 'pending in this source'),
      description: observation.bitcoinArrival
        ? t(
            `en attente observée par ${observation.bitcoinArrival.source}${observationTime(observation.bitcoinArrival.observedAt, locale)} ; cette présence ne garantit pas sa présence chez un autre fournisseur et ne prouve aucune inclusion`,
            `pending, observed by ${observation.bitcoinArrival.source}${observationTime(observation.bitcoinArrival.observedAt, locale)}; this does not guarantee presence at another provider or prove inclusion`,
          )
        : t('en attente dans la source', 'pending in this source'),
      group: 'current',
    };
  return {
    kind: 'unknown',
    label: t(
      'dernière observation · statut actuel inconnu',
      'last observation · current status unknown',
    ),
    description: t(
      'dernière observation conservée, absente de l’échantillon actuel ; statut actuel inconnu',
      'retained last observation, absent from the current sample; current status unknown',
    ),
    group: 'history',
  };
}

export function isHistoricalPassenger(observation: PassengerStatusObservation): boolean {
  const kind = statusKind(observation);
  return kind === 'unknown' || kind === 'absent' || kind === 'replaced';
}
