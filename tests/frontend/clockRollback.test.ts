import { describe, expect, it } from 'vitest';
import { snapshotSchema } from '../../shared/model';
import { generateDemoSnapshot } from '../../server/demo';
import { assessFreshness, nextSnapshotFreshnessDeadline } from '../../src/lib/freshness';
import { liveSnapshot, now } from '../unit/fixtures';

function futureObservation(offset = 60_000) {
  const at = now + offset;
  const base = liveSnapshot('bitcoin', at);
  const transactions = base.transactions.filter((tx) => tx.status === 'pending').slice(0, 2);
  const block = { ...base.blocks[0]!, txCount: 4 };
  return snapshotSchema.parse({
    ...base,
    transactions,
    blocks: [block],
    inclusions: [],
    blockTemplate: {
      source: 'Controlled node',
      observedAt: at,
      height: block.height + 1,
      previousBlockHash: block.hash,
      transactionCount: 0,
      weight: 0,
      weightLimit: 4_000_000,
      selectedTransactionIds: [],
    },
    candidateComparison: {
      scope: 'complete',
      blockHash: block.hash,
      blockHeight: block.height,
      parentBlockHash: 'c'.repeat(64),
      candidateObservedAt: at - 2_000,
      blockObservedAt: at,
      candidateSource: 'Controlled candidate',
      blockSource: 'Controlled block',
      candidateTransactionCount: 3,
      blockTransactionCount: 3,
      commonCount: 2,
      candidateOnlyCount: 1,
      blockOnlyCount: 1,
    },
    bitcoinArrivals: {
      source: 'Controlled arrivals',
      method: 'mempool-transactions',
      observedAt: at,
      transactionIds: transactions.map((tx) => tx.id),
    },
    eventFlow: {
      source: 'Controlled events',
      method: 'mempool-txids',
      state: 'live',
      epoch: 1,
      startedAt: at - 3_000,
      observedAt: at,
      lastMessageAt: at,
      history: [
        {
          fromObservedAt: at - 3_000,
          observedAt: at,
          enteredCount: 2,
          outsideSampleEnteredCount: 0,
        },
      ],
    },
  });
}

describe('browser observations after a clock correction', () => {
  it.each([100, 5_000])('tolerates a bounded server clock lead of %sms', (offset) => {
    const source = liveSnapshot('bitcoin', now + offset);
    expect(assessFreshness(source, false, now)).toBe(source);
    expect(nextSnapshotFreshnessDeadline(source, now)).toBe(now + offset + 120_001);
  });

  it.each([
    [5_001, false],
    [5_001, true],
    [60_000, false],
    [60_000, true],
  ] as const)(
    'retires live data %sms ahead and selection context, disconnected=%s',
    (offset, failed) => {
      const future = futureObservation(offset);
      const refused = assessFreshness(future, failed, now);
      expect(refused).toMatchObject({
        status: 'unavailable',
        mode: 'live',
        observedAt: future.observedAt,
      });
      expect(refused.transactions).toEqual([]);
      expect(refused.blocks).toEqual([]);
      expect(refused.inclusions).toEqual([]);
      expect(refused.pendingCount).toBeNull();
      expect(refused.feeRate).toBeNull();
      expect(refused.blockTemplate).toBeNull();
      expect(refused.candidateComparison).toBeNull();
      expect(refused.bitcoinArrivals).toBeNull();
      expect(refused.eventFlow).toBeNull();
      expect(snapshotSchema.safeParse(refused).success).toBe(true);
      expect(nextSnapshotFreshnessDeadline(future, now)).toBeNull();
      expect(nextSnapshotFreshnessDeadline(refused, now)).toBeNull();
    },
  );

  it('accepts a subsequent correctly dated live observation without changing demonstration behavior', () => {
    const future = futureObservation();
    expect(assessFreshness(future, false, now).status).toBe('unavailable');
    const fresh = liveSnapshot('bitcoin', now);
    expect(assessFreshness(fresh, false, now)).toBe(fresh);
    expect(nextSnapshotFreshnessDeadline(fresh, now)).toBe(now + 120_001);
    const demo = generateDemoSnapshot('ethereum', now + 60_000);
    expect(assessFreshness(demo, true, now)).toBe(demo);
    expect(nextSnapshotFreshnessDeadline(demo, now)).toBeNull();
  });
});
