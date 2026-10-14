import { describe, expect, it } from 'vitest';
import { fetchBitcoinSnapshot } from '../../server/adapters/bitcoin.js';
import { bitcoinFetcher, btcBlock, btcTx, config, now } from './fixtures.js';

describe('Bitcoin read-only adapter', () => {
  it('maps validated mempool data, actual weight, and provider fee recommendation', async () => {
    const fetcher = bitcoinFetcher();
    const snapshot = await fetchBitcoinSnapshot(config, fetcher, () => now);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(snapshot.mode).toBe('live');
    expect(snapshot.pendingCount).toBe(9_000);
    expect(snapshot.feeRate).toBe(7);
    expect(snapshot.transactions[0]?.feeRate).toBe(5);
    expect(snapshot.blocks[0]?.used).toBe(975_000);
    expect(snapshot.blocks[0]?.capacity).toBe(1_000_000);
    expect(snapshot.coverage).toContain('échantillon');
    expect(snapshot.observedAt).toBe(now);
  });

  it('rejects malformed hashes, unsafe fees, noninteger bytes and impossible block weight', async () => {
    for (const transaction of [
      { ...btcTx, txid: 'untrusted' },
      { ...btcTx, fee: Number.MAX_SAFE_INTEGER + 1 },
      { ...btcTx, fee: -1 },
      { ...btcTx, vsize: 1.5 },
      { ...btcTx, vsize: 0 },
    ]) {
      await expect(
        fetchBitcoinSnapshot(config, bitcoinFetcher({ '/mempool/recent': [transaction] })),
      ).rejects.toMatchObject({ kind: 'invalid' });
    }
    await expect(
      fetchBitcoinSnapshot(
        config,
        bitcoinFetcher({ '/v1/blocks': [{ ...btcBlock, weight: 4_000_001 }] }),
      ),
    ).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('bounds large samples and performs satoshi/vbyte division without premature float conversion', async () => {
    const transactions = Array.from({ length: 121 }, () => ({ ...btcTx, fee: 10, vsize: 3 }));
    const snapshot = await fetchBitcoinSnapshot(
      config,
      bitcoinFetcher({ '/mempool/recent': transactions }),
    );
    expect(snapshot.transactions).toHaveLength(120);
    expect(snapshot.transactions[0]?.feeRate).toBe(3.333);
  });
});
