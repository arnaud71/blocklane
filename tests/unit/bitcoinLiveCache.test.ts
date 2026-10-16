import { describe, expect, it, vi } from 'vitest';
import { SnapshotService } from '../../server/cache';
import type { EventFlowReader } from '../../server/eventStreams';
import type { Tx } from '../../shared/model';
import { bitcoinFetcher, btcBlock, config, now } from './fixtures';

describe('Bitcoin real-arrival adapter wiring through the shared cache', () => {
  it('incorporates arrivals before final event-flow selection and before canonical inclusion checks', async () => {
    const arrival: Tx = {
      id: 'd'.repeat(64),
      chain: 'bitcoin',
      status: 'pending',
      size: 200,
      feeRate: 1,
      kind: 'transfer',
      value: 'Montant non fourni',
    };
    const included: Tx = { ...arrival, id: 'e'.repeat(64) };
    const order: string[] = [];
    const readBitcoinArrivals = vi.fn(() => {
      order.push('read-arrivals');
      return {
        source: 'Flux Bitcoin contrôlé',
        observedAt: now,
        transactions: [arrival, included],
      };
    });
    const read = vi.fn<EventFlowReader['read']>((_chain, selection) => {
      order.push('read-flow');
      expect(selection.has(arrival.id)).toBe(true);
      expect(selection.has(included.id)).toBe(false);
      return null;
    });
    const core = bitcoinFetcher({
      '/v1/blocks': [{ ...btcBlock, tx_count: 2 }],
      [`/block/${btcBlock.id}/txids`]: ['1'.repeat(64), included.id],
    });
    const fetcher = vi.fn<typeof fetch>((input, init) => {
      if (String(input).endsWith('/txids')) order.push('check-inclusions');
      return core(input, init);
    });
    const service = new SnapshotService({
      config,
      now: () => now,
      fetcher,
      usdQuotes: { get: async () => null },
      eventFlows: { read, readBitcoinArrivals, dispose: vi.fn() },
    });
    try {
      const result = await service.get('bitcoin', 'live');
      expect(result.status).toBe('ok');
      expect(result.transactions.find(({ id }) => id === arrival.id)?.status).toBe('pending');
      expect(result.transactions.find(({ id }) => id === included.id)).toMatchObject({
        status: 'confirmed',
        blockHash: btcBlock.id,
      });
      expect(result.bitcoinArrivals?.transactionIds).toEqual([arrival.id]);
      expect(order).toEqual(['read-arrivals', 'check-inclusions', 'read-flow']);
      await service.get('bitcoin', 'live');
      expect(readBitcoinArrivals).toHaveBeenCalledOnce();
      expect(read).toHaveBeenCalledTimes(2);
    } finally {
      service.dispose();
    }
  });
});
