import { describe, expect, it, vi } from 'vitest';
import { snapshotSchema } from '../../shared/model.js';
import { SnapshotService } from '../../server/cache.js';
import { CACHE_TTL_MS, MAX_STALE_MS } from '../../server/config.js';
import { config, liveSnapshot, now } from './fixtures.js';

describe('candidate comparison in the shared cache', () => {
  it('preserves evidence dates on stale reads and retires the comparison on expiry', async () => {
    let time = now;
    let failing = false;
    const base = liveSnapshot('bitcoin', now);
    const latest = { ...base.blocks[0]!, txCount: 4 };
    const source = snapshotSchema.parse({
      ...base,
      blocks: [latest],
      transactions: [],
      candidateComparison: {
        scope: 'complete',
        blockHash: latest.hash,
        blockHeight: latest.height,
        parentBlockHash: 'c'.repeat(64),
        candidateObservedAt: now - 5_000,
        blockObservedAt: now,
        candidateSource: 'Candidat contrôlé',
        blockSource: 'Bloc contrôlé',
        candidateTransactionCount: 4,
        blockTransactionCount: 3,
        commonCount: 2,
        candidateOnlyCount: 2,
        blockOnlyCount: 1,
      },
    });
    const provider = vi.fn(async () => {
      if (failing) throw new Error('private-upstream-token');
      return source;
    });
    const service = new SnapshotService({
      config,
      now: () => time,
      providers: { bitcoin: provider, ethereum: provider },
    });
    const initial = await service.get('bitcoin', 'live');
    expect(initial.candidateComparison).toEqual(source.candidateComparison);
    failing = true;
    time += CACHE_TTL_MS;
    const stale = await service.get('bitcoin', 'live');
    expect(stale.status).toBe('stale');
    expect(stale.candidateComparison).toEqual(initial.candidateComparison);
    expect(stale.observedAt).toBe(now);
    expect(stale.message).not.toContain('private-upstream-token');
    time = now + MAX_STALE_MS + 1;
    const retired = await service.get('bitcoin', 'live');
    expect(retired.status).toBe('unavailable');
    expect(retired.candidateComparison ?? null).toBeNull();
    expect(retired.blocks).toEqual([]);
    expect(snapshotSchema.safeParse(retired).success).toBe(true);
    expect((await service.get('bitcoin', 'demo')).candidateComparison ?? null).toBeNull();
  });
});
