import { describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '../../shared/model';
import { SnapshotService } from '../../server/cache';
import { CACHE_TTL_MS } from '../../server/config';
import { config, liveSnapshot, now } from './fixtures';

describe('shared cache after a clock correction', () => {
  it('recollects immediately after the clock moves behind a completed observation', async () => {
    let time = now;
    const bitcoin = vi.fn(async () => liveSnapshot('bitcoin', time));
    const service = new SnapshotService({
      config,
      now: () => time,
      providers: { bitcoin, ethereum: async () => liveSnapshot('ethereum', time) },
    });
    expect((await service.get('bitcoin', 'live')).observedAt).toBe(now);
    time -= 60_000;
    const corrected = await service.get('bitcoin', 'live');
    expect(bitcoin).toHaveBeenCalledTimes(2);
    expect(corrected).toMatchObject({ status: 'ok', mode: 'live', observedAt: time });
    expect(corrected.transactions.length).toBeGreaterThan(0);
  });

  it('rejects a provider observation from the future instead of accepting it when the clock catches up', async () => {
    let time = now;
    let future = true;
    const bitcoin = vi.fn(async () => liveSnapshot('bitcoin', future ? now + 1 : time));
    const service = new SnapshotService({
      config,
      now: () => time,
      providers: { bitcoin, ethereum: async () => liveSnapshot('ethereum', time) },
    });
    const refused = await service.get('bitcoin', 'live');
    expect(refused).toMatchObject({ status: 'unavailable', mode: 'live' });
    expect(refused.transactions).toEqual([]);
    expect(refused.blocks).toEqual([]);
    time += 1;
    expect((await service.get('bitcoin', 'live')).status).toBe('unavailable');
    expect(bitcoin).toHaveBeenCalledTimes(1);
    future = false;
    time = now + CACHE_TTL_MS;
    expect(await service.get('bitcoin', 'live')).toMatchObject({ status: 'ok', observedAt: time });
    expect(bitcoin).toHaveBeenCalledTimes(2);
  });

  it('does not retain a future stale snapshot when recollection after rollback fails', async () => {
    let time = now;
    let fail = false;
    const bitcoin = vi.fn(async () => {
      if (fail) throw new Error('private-provider-secret');
      return liveSnapshot('bitcoin', time);
    });
    const service = new SnapshotService({
      config,
      now: () => time,
      providers: { bitcoin, ethereum: async () => liveSnapshot('ethereum', time) },
    });
    await service.get('bitcoin', 'live');
    time -= 60_000;
    fail = true;
    const failed = await service.get('bitcoin', 'live');
    expect(bitcoin).toHaveBeenCalledTimes(2);
    expect(failed).toMatchObject({ status: 'unavailable', mode: 'live' });
    expect(failed.transactions).toEqual([]);
    expect(failed.blocks).toEqual([]);
    expect(JSON.stringify(failed)).not.toContain('private-provider-secret');
    time += CACHE_TTL_MS - 1;
    expect((await service.get('bitcoin', 'live')).status).toBe('unavailable');
    expect(bitcoin).toHaveBeenCalledTimes(2);
    fail = false;
    time += 1;
    expect(await service.get('bitcoin', 'live')).toMatchObject({ status: 'ok', observedAt: time });
    expect(time).toBeLessThan(now);
    expect(bitcoin).toHaveBeenCalledTimes(3);
  });

  it.each([false, true])(
    'shares in-flight work but rejects a result started before rollback, provider redates=%s',
    async (redates) => {
      let time = now;
      let release!: (snapshot: Snapshot) => void;
      const pending = new Promise<Snapshot>((resolve) => {
        release = resolve;
      });
      let calls = 0;
      const bitcoin = vi.fn(async () => {
        calls += 1;
        return calls === 1 ? pending : liveSnapshot('bitcoin', time);
      });
      const service = new SnapshotService({
        config,
        now: () => time,
        providers: { bitcoin, ethereum: async () => liveSnapshot('ethereum', time) },
      });
      const first = service.get('bitcoin', 'live');
      await Promise.resolve();
      expect(bitcoin).toHaveBeenCalledTimes(1);
      time -= 60_000;
      const second = service.get('bitcoin', 'live');
      await Promise.resolve();
      expect(bitcoin).toHaveBeenCalledTimes(1);
      release(liveSnapshot('bitcoin', redates ? time : now));
      for (const snapshot of await Promise.all([first, second])) {
        expect(snapshot).toMatchObject({ status: 'unavailable', mode: 'live' });
        expect(snapshot.transactions).toEqual([]);
        expect(snapshot.blocks).toEqual([]);
      }
      expect(bitcoin).toHaveBeenCalledTimes(1);
      time += CACHE_TTL_MS;
      expect(await service.get('bitcoin', 'live')).toMatchObject({
        status: 'ok',
        observedAt: time,
      });
      expect(bitcoin).toHaveBeenCalledTimes(2);
    },
  );

  it('keeps each network cache independent and demonstration explicit after rollback', async () => {
    let time = now;
    const bitcoin = vi.fn(async () => liveSnapshot('bitcoin', time));
    const ethereum = vi.fn(async () => liveSnapshot('ethereum', time));
    const service = new SnapshotService({
      config,
      now: () => time,
      providers: { bitcoin, ethereum },
    });
    await service.get('bitcoin', 'live');
    await service.get('ethereum', 'live');
    time -= 60_000;
    expect(await service.get('bitcoin', 'live')).toMatchObject({
      chain: 'bitcoin',
      status: 'ok',
      observedAt: time,
    });
    expect(bitcoin).toHaveBeenCalledTimes(2);
    expect(ethereum).toHaveBeenCalledTimes(1);
    expect(await service.get('ethereum', 'demo')).toMatchObject({
      chain: 'ethereum',
      mode: 'demo',
      status: 'ok',
      observedAt: time,
    });
    expect(ethereum).toHaveBeenCalledTimes(1);
    expect(await service.get('ethereum', 'live')).toMatchObject({
      chain: 'ethereum',
      mode: 'live',
      status: 'ok',
      observedAt: time,
    });
    expect(ethereum).toHaveBeenCalledTimes(2);
    await service.get('bitcoin', 'live');
    expect(bitcoin).toHaveBeenCalledTimes(2);
  });
});
