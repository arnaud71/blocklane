import { describe, expect, it } from 'vitest';
import { snapshotSchema, type Snapshot } from '../../shared/model';
import { assessFreshness, nextSnapshotFreshnessDeadline } from '../../src/lib/freshness';
import { liveSnapshot, now } from '../unit/fixtures';

function observation(): Snapshot {
  const base = liveSnapshot('bitcoin', now);
  const block = { ...base.blocks[0]!, txCount: 4 };
  return snapshotSchema.parse({
    ...base,
    transactions: [],
    blocks: [block],
    candidateComparison: {
      scope: 'complete',
      blockHash: block.hash,
      blockHeight: block.height,
      parentBlockHash: 'c'.repeat(64),
      candidateObservedAt: now - 2_000,
      blockObservedAt: now,
      candidateSource: 'Nœud Bitcoin contrôlé',
      blockSource: 'Blocs contrôlés',
      candidateTransactionCount: 3,
      blockTransactionCount: 3,
      commonCount: 2,
      candidateOnlyCount: 1,
      blockOnlyCount: 1,
    },
    blockTemplate: {
      source: 'Nœud Bitcoin contrôlé',
      observedAt: now,
      height: block.height + 1,
      previousBlockHash: block.hash,
      transactionCount: 0,
      weight: 0,
      weightLimit: 4_000_000,
      selectedTransactionIds: [],
    },
  });
}

describe('historical candidate comparison freshness', () => {
  it('keeps a completed comparison when the next live candidate expires', () => {
    const source = observation();
    expect(nextSnapshotFreshnessDeadline(source, now)).toBe(now + 30_001);
    const aged = assessFreshness(source, false, now + 30_001);
    expect(aged.blockTemplate).toBeNull();
    expect(aged.candidateComparison).toBe(source.candidateComparison);
    expect(aged.observedAt).toBe(now);
    expect(snapshotSchema.safeParse(aged).success).toBe(true);
  });

  it('retains dates and counts on a temporary source failure, then clears expired data', () => {
    const source = observation();
    const stale = assessFreshness(source, true, now + 3_000);
    expect(stale.status).toBe('stale');
    expect(stale.candidateComparison).toBe(source.candidateComparison);
    expect(stale.observedAt).toBe(now);
    const expired = assessFreshness(source, true, now + 120_001);
    expect(expired.status).toBe('unavailable');
    expect(expired.candidateComparison).toBeNull();
    expect(expired.blockTemplate).toBeNull();
    expect(expired.blocks).toEqual([]);
    expect(snapshotSchema.safeParse(expired).success).toBe(true);
  });
});
