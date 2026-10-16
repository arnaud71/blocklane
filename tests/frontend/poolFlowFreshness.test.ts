import { describe, expect, it } from 'vitest';
import { snapshotSchema } from '../../shared/model';
import { assessFreshness, nextSnapshotFreshnessDeadline } from '../../src/lib/freshness';
import { liveSnapshot, now } from '../unit/fixtures';

const source = () =>
  snapshotSchema.parse({
    ...liveSnapshot('bitcoin', now),
    poolFlow: {
      source: 'Nœud contrôlé',
      method: 'getrawmempool',
      observedAt: now - 20_000,
      inventoryCount: 20,
      state: 'ready',
      history: [
        {
          fromObservedAt: now - 50_000,
          observedAt: now - 20_000,
          previousCount: 20,
          currentCount: 20,
          enteredCount: 5,
          disappearedCount: 5,
          outsideSampleEnteredCount: 2,
        },
      ],
    },
  });

describe('independent provider flow expiration', () => {
  it('expires the dated flow without restarting its clock on a newer block snapshot', () => {
    const snapshot = source();
    expect(nextSnapshotFreshnessDeadline(snapshot, now)).toBe(now + 70_001);
    expect(assessFreshness(snapshot, false, now + 70_000).poolFlow).toBe(snapshot.poolFlow);
    const expired = assessFreshness(snapshot, false, now + 70_001);
    expect(expired.poolFlow).toBeNull();
    expect(expired.status).toBe('ok');
    expect(expired.transactions).toBe(snapshot.transactions);
    expect(snapshotSchema.safeParse(expired).success).toBe(true);
  });

  it('preserves dates on source failure, then removes evidence on overall unavailability', () => {
    const snapshot = source();
    const stale = assessFreshness(snapshot, true, now + 3_000);
    expect(stale.status).toBe('stale');
    expect(stale.poolFlow).toBe(snapshot.poolFlow);
    expect(stale.observedAt).toBe(now);
    expect(assessFreshness(stale, true, now + 120_001).poolFlow).toBeNull();
  });

  it('retires a flow whose receipt date is in the future after a clock correction', () => {
    const snapshot = source();
    expect(assessFreshness(snapshot, false, now - 20_001).poolFlow).toBeNull();
  });
});
