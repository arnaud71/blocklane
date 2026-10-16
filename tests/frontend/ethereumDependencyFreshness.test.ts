import { describe, expect, it } from 'vitest';
import { snapshotSchema, type Snapshot } from '../../shared/model';
import { assessFreshness, nextSnapshotFreshnessDeadline } from '../../src/lib/freshness';
import { liveSnapshot, now } from '../unit/fixtures';

function observation(): Snapshot {
  const base = liveSnapshot('ethereum', now);
  const observedAt = now - 20_000;
  const source = 'Pool Ethereum contrôlé';
  return snapshotSchema.parse({
    ...base,
    transactions: [],
    sampling: {
      method: 'txpool_content',
      source,
      observedAt,
      pendingCount: 0,
      queuedCount: 0,
    },
    poolObservation: {
      method: 'txpool_content',
      source,
      observedAt,
      presentTransactionIds: [],
      queuedTransactionIds: [],
      absentTransactionIds: [],
    },
    ethereumDependencies: {
      source,
      observedAt,
      parentBlockHash: base.blocks[0]!.hash,
      height: base.blocks[0]!.height + 1,
      entries: [],
    },
  });
}

describe('Ethereum nonce dependency freshness', () => {
  it('schedules the dependency deadline independently of a newer snapshot or slow request', () => {
    const source = observation();
    expect(nextSnapshotFreshnessDeadline(source, now)).toBe(now + 40_001);
    expect(assessFreshness(source, false, now + 40_000)).toBe(source);
    const expired = assessFreshness(source, false, now + 40_001);
    expect(expired.ethereumDependencies).toBeNull();
    expect(expired.poolObservation).toBeNull();
    expect(expired.status).toBe('ok');
    expect(expired.observedAt).toBe(now);
    expect(nextSnapshotFreshnessDeadline(expired, now + 40_001)).toBe(now + 120_001);
    expect(snapshotSchema.safeParse(expired).success).toBe(true);
  });

  it('keeps original dependency evidence during a temporary failure, then expires it', () => {
    const source = observation();
    const stale = assessFreshness(source, true, now + 3_000);
    expect(stale.status).toBe('stale');
    expect(stale.ethereumDependencies).toBe(source.ethereumDependencies);
    expect(stale.ethereumDependencies?.observedAt).toBe(now - 20_000);
    expect(stale.observedAt).toBe(now);
    const expired = assessFreshness(stale, true, now + 40_001);
    expect(expired.ethereumDependencies).toBeNull();
    expect(expired.status).toBe('stale');
    expect(snapshotSchema.safeParse(expired).success).toBe(true);
  });

  it('removes dependency evidence with the entire unavailable snapshot', () => {
    const expired = assessFreshness(observation(), true, now + 120_001);
    expect(expired.status).toBe('unavailable');
    expect(expired.ethereumDependencies).toBeNull();
    expect(expired.transactions).toEqual([]);
    expect(expired.blocks).toEqual([]);
    expect(nextSnapshotFreshnessDeadline(expired, now + 120_001)).toBeNull();
    expect(snapshotSchema.safeParse(expired).success).toBe(true);
  });

  it('does not add live dependency evidence to legacy or demonstration snapshots', () => {
    const legacy = liveSnapshot('ethereum', now);
    expect(assessFreshness(legacy, false, now)).toBe(legacy);
    const demo = { ...legacy, mode: 'demo' as const };
    expect(assessFreshness(demo, true, now + 200_000)).toBe(demo);
    expect(demo.ethereumDependencies).toBeUndefined();
  });
});
