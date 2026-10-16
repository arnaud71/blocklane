import {
  POOL_FLOW_MAX_AGE_MS,
  EVENT_FLOW_MAX_AGE_MS,
  EVENT_FLOW_SILENCE_MS,
  BITCOIN_ARRIVALS_MAX_AGE_MS,
  type Snapshot,
} from '../../shared/model';

const TEMPLATE_MAX_AGE_MS = 30_000;
const POOL_MAX_AGE_MS = 60_000;
const SNAPSHOT_MAX_AGE_MS = 120_000;

/** Schedule only the next data boundary; a long pending request must not postpone expiration. */
export function nextSnapshotFreshnessDeadline(snapshot: Snapshot, now: number): number | null {
  if (snapshot.mode !== 'live' || snapshot.status === 'unavailable') return null;
  const deadlines = [snapshot.observedAt + SNAPSHOT_MAX_AGE_MS + 1];
  if (snapshot.blockTemplate)
    deadlines.push(snapshot.blockTemplate.observedAt + TEMPLATE_MAX_AGE_MS + 1);
  if (snapshot.ethereumProjection)
    deadlines.push(snapshot.ethereumProjection.observedAt + TEMPLATE_MAX_AGE_MS + 1);
  if (snapshot.poolObservation)
    deadlines.push(snapshot.poolObservation.observedAt + POOL_MAX_AGE_MS + 1);
  if (snapshot.ethereumDependencies)
    deadlines.push(snapshot.ethereumDependencies.observedAt + POOL_MAX_AGE_MS + 1);
  if (snapshot.poolFlow) deadlines.push(snapshot.poolFlow.observedAt + POOL_FLOW_MAX_AGE_MS + 1);
  if (snapshot.bitcoinArrivals)
    deadlines.push(snapshot.bitcoinArrivals.observedAt + BITCOIN_ARRIVALS_MAX_AGE_MS + 1);
  if (snapshot.eventFlow && ['live', 'warming'].includes(snapshot.eventFlow.state)) {
    deadlines.push(snapshot.eventFlow.observedAt + EVENT_FLOW_MAX_AGE_MS + 1);
    if (snapshot.eventFlow.lastMessageAt !== null)
      deadlines.push(snapshot.eventFlow.lastMessageAt + EVENT_FLOW_SILENCE_MS + 1);
  }
  const remaining = deadlines.filter((deadline) => deadline > now);
  return remaining.length ? Math.min(...remaining) : null;
}

/** A disconnected browser must apply the same expiration as the server cache. */
export function assessFreshness(snapshot: Snapshot, failed: boolean, now: number): Snapshot {
  if (snapshot.mode === 'demo' || snapshot.status === 'unavailable') return snapshot;
  if (now - snapshot.observedAt > SNAPSHOT_MAX_AGE_MS) {
    return {
      ...snapshot,
      status: 'unavailable',
      pendingCount: null,
      mempool: null,
      sampling: null,
      blockTemplate: null,
      candidateComparison: null,
      poolObservation: null,
      poolFlow: null,
      eventFlow: null,
      bitcoinArrivals: null,
      ethereumProjection: null,
      ethereumDependencies: null,
      latestBlockValue: null,
      feeRate: null,
      transactions: [],
      blocks: [],
      inclusions: [],
      message: 'Dernières données trop anciennes. Affichage suspendu en attendant la source.',
    };
  }
  const templateExpired =
    !!snapshot.blockTemplate && now - snapshot.blockTemplate.observedAt > TEMPLATE_MAX_AGE_MS;
  const ethereumExpired =
    !!snapshot.ethereumProjection &&
    now - snapshot.ethereumProjection.observedAt > TEMPLATE_MAX_AGE_MS;
  const poolExpired =
    !!snapshot.poolObservation && now - snapshot.poolObservation.observedAt > POOL_MAX_AGE_MS;
  const dependenciesExpired =
    !!snapshot.ethereumDependencies &&
    now - snapshot.ethereumDependencies.observedAt > POOL_MAX_AGE_MS;
  const flowExpired =
    !!snapshot.poolFlow &&
    (now < snapshot.poolFlow.observedAt ||
      now - snapshot.poolFlow.observedAt > POOL_FLOW_MAX_AGE_MS);
  const event = snapshot.eventFlow;
  const arrivalsExpired =
    !!snapshot.bitcoinArrivals &&
    (now < snapshot.bitcoinArrivals.observedAt ||
      now - snapshot.bitcoinArrivals.observedAt > BITCOIN_ARRIVALS_MAX_AGE_MS);
  const expiredArrivalIds = new Set(
    arrivalsExpired ? snapshot.bitcoinArrivals?.transactionIds : [],
  );
  const independentPresence = new Set(
    arrivalsExpired
      ? [
          ...(!poolExpired && snapshot.poolObservation && snapshot.poolObservation.observedAt <= now
            ? [
                ...snapshot.poolObservation.presentTransactionIds,
                ...snapshot.poolObservation.queuedTransactionIds,
              ]
            : []),
          ...(!templateExpired && snapshot.blockTemplate && snapshot.blockTemplate.observedAt <= now
            ? snapshot.blockTemplate.selectedTransactionIds
            : []),
        ]
      : [],
  );
  const eventFuture =
    !!event &&
    (event.observedAt > now || (event.lastMessageAt !== null && event.lastMessageAt > now));
  const eventExpired =
    !!event &&
    ['live', 'warming'].includes(event.state) &&
    (now - event.observedAt > EVENT_FLOW_MAX_AGE_MS ||
      event.lastMessageAt === null ||
      now - event.lastMessageAt > EVENT_FLOW_SILENCE_MS);
  if (
    !failed &&
    !templateExpired &&
    !ethereumExpired &&
    !poolExpired &&
    !dependenciesExpired &&
    !flowExpired &&
    !arrivalsExpired &&
    !eventFuture &&
    !eventExpired
  )
    return snapshot;
  const note = templateExpired
    ? 'Ancien candidat du nœud : retour à l’estimation sur le dernier échantillon.'
    : ethereumExpired
      ? 'Projection Ethereum ancienne : critères de sélection actuels indisponibles.'
      : '';
  return {
    ...snapshot,
    status: failed ? 'stale' : snapshot.status,
    ...(templateExpired ? { blockTemplate: null } : {}),
    ...(ethereumExpired ? { ethereumProjection: null } : {}),
    ...(poolExpired ? { poolObservation: null } : {}),
    ...(dependenciesExpired ? { ethereumDependencies: null } : {}),
    ...(flowExpired ? { poolFlow: null } : {}),
    ...(arrivalsExpired
      ? {
          bitcoinArrivals: null,
          // Remove only expired stream-only evidence from the active sample. The
          // motion engine retains those individuals as dated historical observations.
          transactions: snapshot.transactions.filter(
            (tx) =>
              tx.status !== 'pending' ||
              !expiredArrivalIds.has(tx.id.toLowerCase()) ||
              independentPresence.has(tx.id.toLowerCase()),
          ),
        }
      : {}),
    ...(eventFuture
      ? { eventFlow: null }
      : eventExpired && event
        ? { eventFlow: { ...event, state: 'interrupted' as const, history: [] } }
        : {}),
    ...(note
      ? {
          coverage: `${note} ${snapshot.coverage}`.slice(0, 700),
          message: `${note}${snapshot.message ? ` ${snapshot.message}` : ''}`.slice(0, 700),
        }
      : {}),
  };
}
