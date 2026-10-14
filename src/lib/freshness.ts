import type { Snapshot } from '../../shared/model';

/** A disconnected browser must apply the same expiration as the server cache. */
export function assessFreshness(snapshot: Snapshot, failed: boolean, now: number): Snapshot {
  if (snapshot.mode === 'demo' || snapshot.status === 'unavailable') return snapshot;
  if (now - snapshot.observedAt > 120_000) {
    return {
      ...snapshot,
      status: 'unavailable',
      pendingCount: null,
      mempool: null,
      feeRate: null,
      transactions: [],
      blocks: [],
      message: 'Dernières données trop anciennes. Affichage suspendu en attendant la source.',
    };
  }
  return failed ? { ...snapshot, status: 'stale' } : snapshot;
}
