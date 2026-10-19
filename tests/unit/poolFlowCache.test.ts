import { describe, expect, it } from 'vitest';
import { SnapshotService } from '../../server/cache.js';
import { snapshotSchema } from '../../shared/model.js';
import { CACHE_TTL_MS } from '../../server/config.js';
import { config, liveSnapshot, now } from './fixtures.js';

describe('shared provider flow cache', () => {
  it('shares measurements, keeps their date on failure and expires flow independently of head data', async () => {
    let time = now;
    let failing = false;
    const poolFlow = {
      source: 'Nœud contrôlé',
      method: 'getrawmempool',
      observedAt: now,
      inventoryCount: 5,
      state: 'warming',
      history: [],
    };
    const provider = async () => {
      if (failing) throw new Error('private-token');
      return snapshotSchema.parse({ ...liveSnapshot('bitcoin', time), poolFlow });
    };
    const service = new SnapshotService({
      config,
      now: () => time,
      providers: { bitcoin: provider, ethereum: provider },
    });
    const initial = await service.get('bitcoin', 'live');
    time += CACHE_TTL_MS;
    failing = true;
    const stale = await service.get('bitcoin', 'live');
    expect(stale.status).toBe('stale');
    expect(stale.poolFlow).toEqual(initial.poolFlow);
    expect(stale.poolFlow?.observedAt).toBe(now);
    expect(JSON.stringify(stale)).not.toContain('private-token');
    failing = false;
    time = now + 90_001;
    const freshHead = await service.get('bitcoin', 'live');
    expect(freshHead.status).toBe('ok');
    expect(freshHead.observedAt).toBe(time);
    expect(freshHead.poolFlow).toBeNull();
    expect(snapshotSchema.safeParse(freshHead).success).toBe(true);
    time = now - 1;
    const corrected = await service.get('bitcoin', 'live');
    expect(corrected).toMatchObject({ status: 'unavailable', mode: 'live' });
    expect(corrected.poolFlow ?? null).toBeNull();
    expect(corrected.transactions).toEqual([]);
    expect(corrected.blocks).toEqual([]);
    expect(corrected.poolObservation ?? null).toBeNull();
    expect(corrected.blockTemplate ?? null).toBeNull();
    expect(corrected.candidateComparison ?? null).toBeNull();
    expect(corrected.eventFlow ?? null).toBeNull();
    expect((await service.get('bitcoin', 'demo')).poolFlow ?? null).toBeNull();
  });
});
