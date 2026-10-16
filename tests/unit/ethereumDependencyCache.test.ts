import { describe, expect, it, vi } from 'vitest';
import { snapshotSchema } from '../../shared/model.js';
import { SnapshotService } from '../../server/cache.js';
import { CACHE_TTL_MS, MAX_STALE_MS } from '../../server/config.js';
import { config, liveSnapshot, now } from './fixtures.js';

describe('Ethereum nonce dependency cache', () => {
  it('shares the original context, preserves it as old evidence on failure and removes it when unavailable', async () => {
    let time = now;
    let failing = false;
    const base = liveSnapshot('ethereum', now);
    const original = snapshotSchema.parse({
      ...base,
      transactions: [],
      sampling: {
        method: 'txpool_content',
        source: 'Pool Ethereum contrôlé',
        observedAt: now - 1_000,
        pendingCount: 0,
        queuedCount: 0,
      },
      poolObservation: {
        method: 'txpool_content',
        source: 'Pool Ethereum contrôlé',
        observedAt: now - 1_000,
        presentTransactionIds: [],
        queuedTransactionIds: [],
        absentTransactionIds: [],
      },
      ethereumDependencies: {
        source: 'Pool Ethereum contrôlé',
        observedAt: now - 1_000,
        parentBlockHash: base.blocks[0]!.hash,
        height: base.blocks[0]!.height + 1,
        entries: [],
      },
    });
    const ethereum = vi.fn(async () => {
      if (failing) throw new Error('private-rpc-details');
      return original;
    });
    const service = new SnapshotService({
      config,
      now: () => time,
      providers: { ethereum, bitcoin: async () => liveSnapshot('bitcoin', time) },
    });
    const [first, second] = await Promise.all([
      service.get('ethereum', 'live'),
      service.get('ethereum', 'live'),
    ]);
    expect(ethereum).toHaveBeenCalledTimes(1);
    expect(first.ethereumDependencies).toEqual(original.ethereumDependencies);
    expect(second.ethereumDependencies).toBe(first.ethereumDependencies);

    failing = true;
    time += CACHE_TTL_MS;
    const stale = await service.get('ethereum', 'live');
    expect(stale.status).toBe('stale');
    expect(stale.observedAt).toBe(now);
    expect(stale.ethereumDependencies).toEqual(original.ethereumDependencies);
    expect(stale.ethereumDependencies?.observedAt).toBe(now - 1_000);
    expect(stale.message).not.toContain('private-rpc-details');

    time = now + MAX_STALE_MS + 1;
    const unavailable = await service.get('ethereum', 'live');
    expect(unavailable.status).toBe('unavailable');
    expect(unavailable.ethereumDependencies ?? null).toBeNull();
    expect(unavailable.poolObservation ?? null).toBeNull();
    expect(unavailable.transactions).toEqual([]);
  });
});
