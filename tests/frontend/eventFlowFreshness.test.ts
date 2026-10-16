import { describe, expect, it } from 'vitest';
import { snapshotSchema } from '../../shared/model';
import { assessFreshness, nextSnapshotFreshnessDeadline } from '../../src/lib/freshness';
import { liveSnapshot, now } from '../unit/fixtures';

function source() {
  return snapshotSchema.parse({
    ...liveSnapshot('bitcoin', now),
    eventFlow: {
      source: 'Flux contrôlé',
      method: 'mempool-txids',
      state: 'live',
      epoch: 1,
      startedAt: now - 3_000,
      observedAt: now,
      lastMessageAt: now,
      history: [
        {
          fromObservedAt: now - 3_000,
          observedAt: now,
          enteredCount: 1,
          outsideSampleEnteredCount: 1,
        },
      ],
    },
  });
}

describe('event observation freshness without a new HTTP response', () => {
  it('marks a stream interrupted on its own deadline without renewing block or event dates', () => {
    const snapshot = source();
    expect(nextSnapshotFreshnessDeadline(snapshot, now)).toBe(now + 15_001);
    expect(assessFreshness(snapshot, false, now + 15_000).eventFlow?.state).toBe('live');
    const expired = assessFreshness(snapshot, false, now + 15_001);
    expect(expired.eventFlow?.state).toBe('interrupted');
    expect(expired.eventFlow?.history).toEqual([]);
    expect(expired.eventFlow?.observedAt).toBe(now);
    expect(expired.observedAt).toBe(now);
    expect(expired.status).toBe('ok');
    expect(snapshotSchema.safeParse(expired).success).toBe(true);
    expect(nextSnapshotFreshnessDeadline(expired, now + 15_001)).toBe(now + 120_001);
  });

  it('drops future-clock evidence and clears event context when all chain data expire', () => {
    const snapshot = source();
    expect(assessFreshness(snapshot, false, now - 1).eventFlow).toBeNull();
    expect(assessFreshness(snapshot, true, now + 120_001).eventFlow).toBeNull();
  });
});
