import { describe, expect, it, vi } from 'vitest';
import {
  BITCOIN_TRACKED_SAMPLE_LIMIT,
  BITCOIN_TRACKED_SAMPLE_TTL_MS,
  bitcoinRecentSchema,
  createBitcoinProvider,
  fetchBitcoinSnapshot,
} from '../../server/adapters/bitcoin.js';
import { PENDING_SAMPLE_LIMIT } from '../../shared/model.js';
import { SnapshotService } from '../../server/cache.js';
import { CACHE_TTL_MS } from '../../server/config.js';
import type { Fetcher } from '../../server/network.js';
import { bitcoinFetcher, btcBlock, btcTx, config, hash, now } from './fixtures.js';

describe('Bitcoin read-only adapter', () => {
  it('maps validated mempool data, actual weight, and provider fee recommendation', async () => {
    const fetcher = bitcoinFetcher();
    const snapshot = await fetchBitcoinSnapshot(config, fetcher, () => now);
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(snapshot.mode).toBe('live');
    expect(snapshot.pendingCount).toBe(9_000);
    expect(snapshot.feeRate).toBe(7);
    expect(snapshot.transactions[0]?.feeRate).toBe(5);
    expect(snapshot.blocks[0]?.used).toBe(975_000);
    expect(snapshot.blocks[0]?.capacity).toBe(1_000_000);
    expect(snapshot.coverage).toContain('transactions récentes');
    expect(snapshot.observedAt).toBe(now);
  });

  it('discards malformed optional arrivals and still rejects impossible required block weight', async () => {
    for (const transaction of [
      { ...btcTx, txid: 'untrusted' },
      { ...btcTx, fee: Number.MAX_SAFE_INTEGER + 1 },
      { ...btcTx, fee: -1 },
      { ...btcTx, vsize: 1.5 },
      { ...btcTx, vsize: 0 },
    ]) {
      expect(bitcoinRecentSchema.safeParse([transaction]).success).toBe(false);
      const snapshot = await fetchBitcoinSnapshot(
        config,
        bitcoinFetcher({ '/mempool/recent': [transaction] }),
      );
      expect(snapshot.status).toBe('ok');
      expect(snapshot.transactions).toEqual([]);
      expect(snapshot.coverage).toContain('temporairement indisponible');
    }
    await expect(
      fetchBitcoinSnapshot(
        config,
        bitcoinFetcher({ '/v1/blocks': [{ ...btcBlock, weight: 4_000_001 }] }),
      ),
    ).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('preserves the 1000-entry REST arrival bound and divides satoshis/vbyte without premature float conversion', async () => {
    const transactions = Array.from({ length: 1_000 }, (_, index) => ({
      ...btcTx,
      txid: (index + 10_000).toString(16).padStart(64, '0'),
      fee: 10,
      vsize: 3,
    }));
    const snapshot = await fetchBitcoinSnapshot(
      config,
      bitcoinFetcher({ '/mempool/recent': transactions }),
    );
    expect(snapshot.transactions).toHaveLength(Math.min(PENDING_SAMPLE_LIMIT, transactions.length));
    expect(snapshot.transactions[0]?.feeRate).toBe(3.333);
    expect(bitcoinRecentSchema.safeParse(transactions).success).toBe(true);
    expect(
      bitcoinRecentSchema.safeParse([...transactions, { ...transactions[0]!, txid: hash('f') }])
        .success,
    ).toBe(false);
  });

  it('carries only previously sampled transactions proved present in the new latest block', async () => {
    let current = bitcoinFetcher({ '/mempool/recent': [btcTx, { ...btcTx, txid: hash('c') }] });
    const fetcher = vi.fn<Fetcher>((...args) => current(...args));
    const read = createBitcoinProvider(config, fetcher, () => now);
    expect((await read()).transactions.map((tx) => tx.status)).toEqual(['pending', 'pending']);

    const newBlock = { ...btcBlock, id: hash('d'), height: btcBlock.height + 1, tx_count: 2 };
    current = bitcoinFetcher({
      '/v1/blocks': [newBlock, btcBlock],
      '/mempool/recent': [{ ...btcTx, txid: hash('e') }],
      [`/block/${newBlock.id}/txids`]: [btcTx.txid.toUpperCase(), hash('f')],
    });
    const next = await read();
    expect(next.transactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: hash('e'), status: 'pending' }),
        expect.objectContaining({ id: btcTx.txid, status: 'confirmed', size: btcTx.vsize }),
      ]),
    );
    expect(next.transactions.some((tx) => tx.id === hash('c'))).toBe(false);
    expect(next.transactions.some((tx) => tx.id === hash('f'))).toBe(false);
    expect(next.pendingCount).toBe(9_000);
    expect(next.blocks[0]?.hash).toBe(newBlock.id);

    const repeated = await read();
    expect(repeated.transactions).toEqual(next.transactions);
    expect(
      fetcher.mock.calls.filter(([input]) => String(input).endsWith(`/block/${newBlock.id}/txids`)),
    ).toHaveLength(1);
  });

  it('lets explicit inclusion override an inconsistent recent arrival and clears confirmations on a new hash', async () => {
    let current = bitcoinFetcher({
      '/v1/blocks': [{ ...btcBlock, tx_count: 1 }],
      [`/block/${btcBlock.id}/txids`]: [btcTx.txid],
    });
    const read = createBitcoinProvider(
      config,
      (...args) => current(...args),
      () => now,
    );
    expect((await read()).transactions).toEqual([
      expect.objectContaining({ id: btcTx.txid, status: 'confirmed' }),
    ]);
    const replacement = { ...btcBlock, id: hash('d'), tx_count: 1 };
    current = bitcoinFetcher({
      '/v1/blocks': [replacement],
      '/mempool/recent': [],
      [`/block/${replacement.id}/txids`]: [hash('e')],
    });
    expect((await read()).transactions).toEqual([]);
  });

  it('does not confuse another provider instance or absence from the sample with confirmation', async () => {
    const firstRead = createBitcoinProvider(config, bitcoinFetcher(), () => now);
    await firstRead();
    const newBlock = { ...btcBlock, id: hash('d'), tx_count: 1 };
    const independent = createBitcoinProvider(
      config,
      bitcoinFetcher({
        '/v1/blocks': [newBlock],
        '/mempool/recent': [],
        [`/block/${newBlock.id}/txids`]: [btcTx.txid],
      }),
      () => now,
    );
    expect((await independent()).transactions).toEqual([]);
  });

  it('bounds tracking memory by the newest unique samples and expires old evidence candidates', async () => {
    let time = now;
    let current = bitcoinFetcher();
    const read = createBitcoinProvider(
      config,
      (...args) => current(...args),
      () => time,
    );
    await read();
    const arrivals = Array.from({ length: PENDING_SAMPLE_LIMIT * 5 }, (_, index) => ({
      ...btcTx,
      txid: (index + 10_000).toString(16).padStart(64, '0'),
    }));
    expect(arrivals.length).toBeGreaterThan(BITCOIN_TRACKED_SAMPLE_LIMIT);
    const recentBatchSize = Math.min(PENDING_SAMPLE_LIMIT, 1_000);
    for (let offset = 0; offset < arrivals.length; offset += recentBatchSize) {
      current = bitcoinFetcher({
        '/mempool/recent': arrivals.slice(offset, offset + recentBatchSize),
      });
      await read();
    }
    const newBlock = { ...btcBlock, id: hash('d'), tx_count: 2 };
    current = bitcoinFetcher({
      '/v1/blocks': [newBlock],
      '/mempool/recent': [],
      [`/block/${newBlock.id}/txids`]: [btcTx.txid, arrivals.at(-1)!.txid],
    });
    expect((await read()).transactions).toEqual([
      expect.objectContaining({ id: arrivals.at(-1)!.txid, status: 'confirmed' }),
    ]);

    current = bitcoinFetcher({ '/mempool/recent': [btcTx] });
    await read();
    time += BITCOIN_TRACKED_SAMPLE_TTL_MS;
    const expiredBlock = { ...newBlock, id: hash('e'), tx_count: 1 };
    current = bitcoinFetcher({
      '/v1/blocks': [expiredBlock],
      '/mempool/recent': [],
      [`/block/${expiredBlock.id}/txids`]: [btcTx.txid],
    });
    expect((await read()).transactions).toEqual([]);
  });

  it('announces optional verification failures, rejects incomplete or duplicate evidence, and retries safely', async () => {
    for (const invalid of [[btcTx.txid, btcTx.txid], ['malformed'], []]) {
      const result = await fetchBitcoinSnapshot(
        config,
        bitcoinFetcher({
          '/v1/blocks': [{ ...btcBlock, tx_count: 2 }],
          [`/block/${btcBlock.id}/txids`]: invalid,
        }),
      );
      expect(result.status).toBe('ok');
      expect(result.transactions[0]?.status).toBe('pending');
      expect(result.message).toContain('Inclusions partiellement vérifiées');
    }

    let failed = true;
    const coreFetcher = bitcoinFetcher({
      '/v1/blocks': [{ ...btcBlock, tx_count: 1 }],
      [`/block/${btcBlock.id}/txids`]: [btcTx.txid],
    });
    const fetcher = vi.fn<Fetcher>((input, init) => {
      if (failed && String(input).endsWith('/txids')) {
        return Promise.resolve(new Response('provider-secret', { status: 503 }));
      }
      return coreFetcher(input, init);
    });
    const read = createBitcoinProvider(config, fetcher, () => now);
    const partial = await read();
    expect(partial.message).not.toContain('provider-secret');
    expect(partial.transactions[0]?.status).toBe('pending');
    failed = false;
    expect((await read()).transactions[0]?.status).toBe('confirmed');
    await read();
    expect(fetcher.mock.calls.filter(([input]) => String(input).endsWith('/txids'))).toHaveLength(
      2,
    );
  });

  it('wires retained Bitcoin observations to the shared cache without per-visitor verification calls', async () => {
    let time = now;
    let current = bitcoinFetcher();
    const fetcher = vi.fn<Fetcher>((...args) => current(...args));
    const service = new SnapshotService({
      config,
      fetcher,
      now: () => time,
      usdQuotes: { get: async () => null },
    });
    await Promise.all(Array.from({ length: 20 }, () => service.get('bitcoin', 'live')));
    expect(fetcher).toHaveBeenCalledTimes(5);
    time += CACHE_TTL_MS;
    const newBlock = { ...btcBlock, id: hash('d'), tx_count: 1 };
    current = bitcoinFetcher({
      '/v1/blocks': [newBlock],
      '/mempool/recent': [],
      [`/block/${newBlock.id}/txids`]: [btcTx.txid],
    });
    const next = await service.get('bitcoin', 'live');
    expect(next.transactions[0]).toMatchObject({ id: btcTx.txid, status: 'confirmed' });
    expect(fetcher).toHaveBeenCalledTimes(10);
    time += CACHE_TTL_MS;
    await service.get('bitcoin', 'live');
    expect(fetcher).toHaveBeenCalledTimes(14);
  });
});
