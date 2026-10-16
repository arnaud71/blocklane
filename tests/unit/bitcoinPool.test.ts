import { describe, expect, it, vi } from 'vitest';
import {
  BITCOIN_POOL_REFRESH_MS,
  BITCOIN_POOL_INCREMENTAL_COOLDOWN_MS,
  BITCOIN_POOL_MAX_ADDITIONS,
  createBitcoinPoolReader,
} from '../../server/adapters/bitcoinPool';
import { config, now } from './fixtures';
import { PENDING_SAMPLE_LIMIT } from '../../shared/model';

const id = (value: number) => value.toString(16).padStart(64, '0');
const entry = (fee: number) => ({ vsize: 100, weight: 400, fees: { base: fee / 100_000_000 } });

describe('Independent Bitcoin pool inventory and excluded display selection', () => {
  it('selects outside members from the complete inventory even when its entire individual top are all in the candidate', async () => {
    const count = PENDING_SAMPLE_LIMIT + 240;
    const entries = Object.fromEntries(
      Array.from({ length: count }, (_, index) => [id(index + 1), entry(count - index)]),
    );
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      const requests = JSON.parse(String(init?.body)) as { id: string; method: string }[];
      return Response.json(
        requests.map((request) => ({
          id: request.id,
          result:
            request.method === 'getblockchaininfo'
              ? { chain: 'main', initialblockdownload: false }
              : entries,
        })),
      );
    });
    const read = createBitcoinPoolReader(config, fetcher, () => now);
    expect(read()).toBeNull();
    await vi.waitFor(() => expect(read()?.transactions).toHaveLength(PENDING_SAMPLE_LIMIT));
    const unfiltered = read()!;
    const excluded = new Set(unfiltered.transactions.map((tx) => tx.id));
    const outside = read(excluded)!;
    expect(outside.count).toBe(count);
    expect(outside.transactions).toHaveLength(240);
    expect(outside.transactions.every((tx) => !excluded.has(tx.id))).toBe(true);
    expect(outside.transactions[0]?.id).toBe(id(PENDING_SAMPLE_LIMIT + 1));
    expect(outside.hasTransaction?.(id(1))).toBe(true);
    expect(outside.hasTransaction?.(id(count + 1))).toBe(false);
    expect(read(excluded)).toBe(outside);
    expect(read()).toBe(unfiltered);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reconciles additions and removals independently of the candidate, preserving snapshot-specific lookups', async () => {
    let time = now;
    let inventory = [id(1), id(2)];
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      const requests = JSON.parse(String(init?.body)) as {
        id: string;
        method: string;
        params: unknown[];
      }[];
      return Response.json(
        requests.map((request) => ({
          id: request.id,
          result:
            request.method === 'getblockchaininfo'
              ? { chain: 'main', initialblockdownload: false }
              : request.method === 'getmempoolentry'
                ? entry(100)
                : request.params[0] === true
                  ? Object.fromEntries(
                      inventory.map((transactionId) => [transactionId, entry(100)]),
                    )
                  : { txids: inventory, mempool_sequence: 2 },
        })),
      );
    });
    const read = createBitcoinPoolReader(config, fetcher, () => time);
    const excluded = new Set([id(1)]);
    read(excluded);
    await vi.waitFor(() => expect(read(excluded)?.count).toBe(2));
    const previous = read(excluded)!;
    expect(previous.transactions.map((tx) => tx.id)).toEqual([id(2)]);
    inventory = [id(1), id(3)];
    time += BITCOIN_POOL_REFRESH_MS + 1;
    expect(read(excluded)).toBeNull();
    await vi.waitFor(() => expect(read(excluded)?.update).toBe('incremental'));
    const current = read(excluded)!;
    expect(current.transactions.map((tx) => tx.id)).toEqual([id(3)]);
    expect(current.hasTransaction?.(id(2))).toBe(false);
    expect(current.hasTransaction?.(id(3))).toBe(true);
    expect(previous.hasTransaction?.(id(2))).toBe(true);
    expect(current.observedAt).toBe(time);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('withdraws inventory presence evidence when a refresh fails without guessing that removals were mined', async () => {
    let time = now;
    let failed = false;
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      if (failed) return new Response('provider-secret', { status: 503 });
      const requests = JSON.parse(String(init?.body)) as { id: string; method: string }[];
      return Response.json(
        requests.map((request) => ({
          id: request.id,
          result:
            request.method === 'getblockchaininfo'
              ? { chain: 'main', initialblockdownload: false }
              : { [id(1)]: entry(100) },
        })),
      );
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const read = createBitcoinPoolReader(config, fetcher, () => time);
      read();
      await vi.waitFor(() => expect(read()?.hasTransaction?.(id(1))).toBe(true));
      failed = true;
      time += BITCOIN_POOL_REFRESH_MS + 1;
      expect(read(new Set())).toBeNull();
      await vi.waitFor(() => expect(warning).toHaveBeenCalled());
      expect(read()).toBeNull();
      expect(JSON.stringify(warning.mock.calls)).not.toContain('provider-secret');
    } finally {
      warning.mockRestore();
    }
  });

  it.each([
    { failedMethod: 'inventory', code: -32601 },
    { failedMethod: 'inventory', code: -32602 },
    { failedMethod: 'entry', code: -32601 },
    { failedMethod: 'entry', code: -32602 },
  ])(
    'recovers only at the next scheduled baseline and temporarily avoids explicitly unsupported $failedMethod ($code)',
    async ({ failedMethod, code }) => {
      let time = now;
      let inventory = [id(1), id(2)];
      let refusalEnabled = true;
      const poolCalls: unknown[][] = [];
      const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
        const requests = JSON.parse(String(init?.body)) as {
          id: string;
          method: string;
          params: unknown[];
        }[];
        return Response.json(
          requests.map((request) => {
            if (request.method === 'getblockchaininfo')
              return { id: request.id, result: { chain: 'main', initialblockdownload: false } };
            if (request.method === 'getmempoolentry')
              return refusalEnabled && failedMethod === 'entry'
                ? { id: request.id, error: { code, message: 'provider-secret' } }
                : { id: request.id, result: entry(100) };
            poolCalls.push(request.params);
            if (request.params[0] === true)
              return {
                id: request.id,
                result: Object.fromEntries(
                  inventory.map((transactionId) => [transactionId, entry(100)]),
                ),
              };
            return refusalEnabled && failedMethod === 'inventory'
              ? { id: request.id, error: { code, message: 'provider-secret' } }
              : { id: request.id, result: { txids: inventory, mempool_sequence: 2 } };
          }),
        );
      });
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const read = createBitcoinPoolReader(config, fetcher, () => time);
        read();
        await vi.waitFor(() => expect(read()?.update).toBe('full'));
        inventory = [id(1), id(3)];
        time += BITCOIN_POOL_REFRESH_MS + 1;
        const refusedAt = time;
        expect(read()).toBeNull();
        await vi.waitFor(() => expect(warning).toHaveBeenCalledTimes(1));
        const failedRequestCount = fetcher.mock.calls.length;
        expect(poolCalls.at(-1)).toEqual([false, true]);
        for (let visitor = 0; visitor < 20; visitor += 1) expect(read()).toBeNull();
        expect(fetcher).toHaveBeenCalledTimes(failedRequestCount);
        refusalEnabled = false;
        time += BITCOIN_POOL_REFRESH_MS;
        expect(read()).toBeNull();
        await vi.waitFor(() => expect(read()?.update).toBe('full'));
        expect(read()).toMatchObject({
          count: 2,
          observedAt: time,
          source: config.bitcoinPoolSource,
        });
        expect(read()?.hasTransaction?.(id(2))).toBe(false);
        expect(read()?.hasTransaction?.(id(3))).toBe(true);
        expect(read()?.transactions.every((tx) => tx.status === 'pending')).toBe(true);
        expect(poolCalls.at(-1)).toEqual([true]);
        time += BITCOIN_POOL_REFRESH_MS;
        read();
        await vi.waitFor(() => expect(read()?.observedAt).toBe(time));
        expect(poolCalls.at(-1)).toEqual([true]);
        expect(read()?.update).toBe('full');
        time = refusedAt + BITCOIN_POOL_INCREMENTAL_COOLDOWN_MS;
        read();
        await vi.waitFor(() => expect(read()?.update).toBe('incremental'));
        expect(poolCalls.at(-1)).toEqual([false, true]);
        expect(JSON.stringify(warning.mock.calls)).not.toContain('provider-secret');
      } finally {
        warning.mockRestore();
      }
    },
  );

  it.each([-5, -32000, '-32601'])(
    'rebases after a temporary or unclassified RPC error (%s) without disabling the next incremental attempt',
    async (code) => {
      let time = now;
      let failIncremental = false;
      const poolCalls: unknown[][] = [];
      const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
        const requests = JSON.parse(String(init?.body)) as {
          id: string;
          method: string;
          params: unknown[];
        }[];
        return Response.json(
          requests.map((request) => {
            if (request.method === 'getblockchaininfo')
              return { id: request.id, result: { chain: 'main', initialblockdownload: false } };
            poolCalls.push(request.params);
            return failIncremental && request.params[0] === false
              ? { id: request.id, error: { code, message: 'provider-secret' } }
              : {
                  id: request.id,
                  result:
                    request.params[0] === true
                      ? { [id(1)]: entry(100) }
                      : { txids: [id(1)], mempool_sequence: 2 },
                };
          }),
        );
      });
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const read = createBitcoinPoolReader(config, fetcher, () => time);
        read();
        await vi.waitFor(() => expect(read()?.update).toBe('full'));
        failIncremental = true;
        time += BITCOIN_POOL_REFRESH_MS + 1;
        read();
        await vi.waitFor(() => expect(warning).toHaveBeenCalledTimes(1));
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(read()).toBeNull();
        failIncremental = false;
        time += BITCOIN_POOL_REFRESH_MS;
        read();
        await vi.waitFor(() => expect(read()?.observedAt).toBe(time));
        expect(poolCalls.at(-1)).toEqual([true]);
        expect(read()?.update).toBe('full');
        time += BITCOIN_POOL_REFRESH_MS;
        read();
        await vi.waitFor(() => expect(read()?.update).toBe('incremental'));
        expect(poolCalls.at(-1)).toEqual([false, true]);
        expect(fetcher).toHaveBeenCalledTimes(4);
        expect(JSON.stringify(warning.mock.calls)).not.toContain('provider-secret');
      } finally {
        warning.mockRestore();
      }
    },
  );

  it('recovers a burst beyond the incremental additions budget with a bounded next-cycle baseline', async () => {
    let time = now;
    let inventory = [id(1)];
    const poolCalls: unknown[][] = [];
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      const requests = JSON.parse(String(init?.body)) as {
        id: string;
        method: string;
        params: unknown[];
      }[];
      return Response.json(
        requests.map((request) => {
          if (request.method === 'getblockchaininfo')
            return { id: request.id, result: { chain: 'main', initialblockdownload: false } };
          expect(request.method).toBe('getrawmempool');
          poolCalls.push(request.params);
          return {
            id: request.id,
            result:
              request.params[0] === true
                ? Object.fromEntries(inventory.map((transactionId) => [transactionId, entry(100)]))
                : { txids: inventory, mempool_sequence: 2 },
          };
        }),
      );
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const read = createBitcoinPoolReader(config, fetcher, () => time);
      read();
      await vi.waitFor(() => expect(read()?.count).toBe(1));
      inventory = Array.from({ length: BITCOIN_POOL_MAX_ADDITIONS + 2 }, (_, index) =>
        id(index + 1),
      );
      time += BITCOIN_POOL_REFRESH_MS + 1;
      expect(read()).toBeNull();
      await vi.waitFor(() => expect(warning).toHaveBeenCalledTimes(1));
      expect(poolCalls.at(-1)).toEqual([false, true]);
      for (let visitor = 0; visitor < 20; visitor += 1) expect(read()).toBeNull();
      expect(fetcher).toHaveBeenCalledTimes(2);
      time += BITCOIN_POOL_REFRESH_MS;
      expect(read()).toBeNull();
      await vi.waitFor(() => expect(read()?.count).toBe(inventory.length));
      expect(read()).toMatchObject({ observedAt: time, update: 'full' });
      expect(read()?.hasTransaction?.(inventory.at(-1)!)).toBe(true);
      expect(read()?.transactions.every((tx) => tx.status === 'pending')).toBe(true);
      expect(poolCalls.at(-1)).toEqual([true]);
      expect(fetcher).toHaveBeenCalledTimes(3);
      time += BITCOIN_POOL_REFRESH_MS;
      read();
      await vi.waitFor(() => expect(read()?.update).toBe('incremental'));
      expect(poolCalls.at(-1)).toEqual([false, true]);
      expect(fetcher).toHaveBeenCalledTimes(4);
    } finally {
      warning.mockRestore();
    }
  });
});
