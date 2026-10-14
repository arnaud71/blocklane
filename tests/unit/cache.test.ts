import { describe, expect, it, vi } from 'vitest';
import { SnapshotService } from '../../server/cache.js';
import { CACHE_TTL_MS, MAX_STALE_MS } from '../../server/config.js';
import { UpstreamError } from '../../server/network.js';
import { config, liveSnapshot, now } from './fixtures.js';

describe('shared snapshot cache and honest failures', () => {
  it('deduplicates simultaneous clients and keeps chain and demo caches separate', async () => {
    let time = now;
    let release: () => void = () => {};
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const bitcoin = vi.fn(async () => {
      await wait;
      return liveSnapshot('bitcoin', time);
    });
    const ethereum = vi.fn(async () => liveSnapshot('ethereum', time));
    const service = new SnapshotService({
      config,
      now: () => time,
      providers: { bitcoin, ethereum },
    });
    const requests = Array.from({ length: 50 }, () => service.get('bitcoin', 'live'));
    await Promise.resolve();
    expect(bitcoin).toHaveBeenCalledTimes(1);
    release();
    const snapshots = await Promise.all(requests);
    expect(snapshots.every((snapshot) => snapshot === snapshots[0])).toBe(true);
    await service.get('bitcoin', 'demo');
    expect(bitcoin).toHaveBeenCalledTimes(1);
    await service.get('ethereum', 'live');
    expect(ethereum).toHaveBeenCalledTimes(1);
    time += CACHE_TTL_MS - 1;
    await service.get('bitcoin', 'live');
    expect(bitcoin).toHaveBeenCalledTimes(1);
    time += 1;
    await service.get('bitcoin', 'live');
    expect(bitcoin).toHaveBeenCalledTimes(2);
  });

  it('retains timestamp on stale data, expires old data and recovers after a provider failure', async () => {
    let time = now;
    let failing = false;
    const bitcoin = vi.fn(async () => {
      if (failing) throw new Error('secret-provider-key');
      return liveSnapshot('bitcoin', time);
    });
    const service = new SnapshotService({
      config,
      now: () => time,
      providers: { bitcoin, ethereum: bitcoin },
    });
    const original = await service.get('bitcoin', 'live');
    failing = true;
    time += CACHE_TTL_MS;
    const stale = await service.get('bitcoin', 'live');
    expect(stale.status).toBe('stale');
    expect(stale.observedAt).toBe(original.observedAt);
    expect(stale.transactions).toEqual(original.transactions);
    expect(stale.message).not.toContain('secret-provider-key');
    time = now + MAX_STALE_MS + 1;
    const unavailable = await service.get('bitcoin', 'live');
    expect(unavailable.status).toBe('unavailable');
    expect(unavailable.transactions).toEqual([]);
    expect(unavailable.blocks).toEqual([]);
    failing = false;
    time += CACHE_TTL_MS;
    const recovered = await service.get('bitcoin', 'live');
    expect(recovered.status).toBe('ok');
    expect(recovered.observedAt).toBe(time);
  });

  it('does not substitute demo data when the first read fails; retries synchronous exceptions', async () => {
    let time = now;
    const bitcoin = vi.fn(() => {
      if (bitcoin.mock.calls.length === 1) throw new UpstreamError('network');
      return Promise.resolve(liveSnapshot('bitcoin', time));
    });
    const service = new SnapshotService({
      config,
      now: () => time,
      providers: { bitcoin, ethereum: bitcoin },
    });
    const unavailable = await service.get('bitcoin', 'live');
    expect(unavailable.mode).toBe('live');
    expect(unavailable.status).toBe('unavailable');
    expect(unavailable.transactions).toEqual([]);
    await service.get('bitcoin', 'live');
    expect(bitcoin).toHaveBeenCalledTimes(1);
    time += CACHE_TTL_MS;
    expect((await service.get('bitcoin', 'live')).status).toBe('ok');
  });

  it('rejects provider mode confusion and reports wrong mainnet configuration safely', async () => {
    const bitcoin = async () => liveSnapshot('ethereum');
    const ethereum = async () => {
      throw new UpstreamError('wrong-chain');
    };
    const service = new SnapshotService({
      config,
      now: () => now,
      providers: { bitcoin, ethereum },
    });
    expect((await service.get('bitcoin', 'live')).status).toBe('unavailable');
    expect((await service.get('ethereum', 'live')).message).toContain('réseau principal');
  });
});
