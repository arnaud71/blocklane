import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BITCOIN_OUTSIDE_TEMPLATE_SAMPLE_LIMIT,
  createBitcoinProvider,
  fetchBitcoinSnapshot,
} from '../../server/adapters/bitcoin';
import { type BitcoinPoolSample } from '../../server/adapters/bitcoinPool';
import {
  BITCOIN_TEMPLATE_MAX_AGE_MS,
  type BitcoinTemplateReader,
  type BitcoinTemplateSample,
} from '../../server/adapters/bitcoinTemplate';
import { MAX_TRACKED_TRANSACTIONS, PENDING_SAMPLE_LIMIT, type Tx } from '../../shared/model';
import { providerMempool } from '../../src/lib/mempoolDisplay';
import { bitcoinFetcher, btcBlock, btcTx, config, hash, now } from './fixtures';

beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(now));
afterEach(() => vi.restoreAllMocks());

function transaction(id = hash('e'), feeRate = 20): Tx {
  return {
    id,
    chain: 'bitcoin',
    status: 'pending',
    feeRate,
    size: 200,
    kind: 'transfer',
    value: 'Montant non fourni',
  };
}

function template(overrides: Partial<BitcoinTemplateSample> = {}): BitcoinTemplateSample {
  const tx = transaction();
  return {
    transactions: [tx],
    transactionIds: new Set([tx.id]),
    count: 1,
    source: 'Nœud candidat contrôlé',
    observedAt: now,
    height: btcBlock.height + 1,
    previousBlockHash: btcBlock.id,
    weight: 800,
    weightLimit: 4_000_000,
    medianFeeSats: overrides.count === 0 ? null : 4_000,
    ...overrides,
  };
}

function reader(read: () => BitcoinTemplateSample | null): BitcoinTemplateReader {
  return Object.assign(read, {
    state: () => ({ pending: false, nextAttemptAt: now + 15_000, failure: null }),
  });
}

function pool(): BitcoinPoolSample {
  return {
    transactions: [transaction(hash('f'), 100)],
    count: 12_000,
    observedAt: now,
    source: 'Pool de repli contrôlé',
    update: 'incremental',
  };
}

describe('Bitcoin node candidate priority and fallback', () => {
  it('keeps the matching candidate while independently observing the higher-fee outside queue', async () => {
    const fallback = vi.fn(() => pool());
    const projected = vi.fn(async () => [transaction(hash('d'), 200)]);
    const result = await fetchBitcoinSnapshot(
      config,
      bitcoinFetcher(),
      () => now,
      projected,
      fallback,
      reader(() => template()),
    );
    expect(result.transactions).toEqual([transaction(), transaction(hash('f'), 100)]);
    expect(result.blockTemplate).toMatchObject({
      height: btcBlock.height + 1,
      selectedTransactionIds: [transaction().id],
      transactionCount: 1,
      weight: 800,
      weightLimit: 4_000_000,
    });
    expect(result.sampling).toMatchObject({ method: 'getrawmempool', pendingCount: 12_000 });
    expect(result.pendingCount).toBe(12_000);
    expect(providerMempool(result).source).toBe(pool().source);
    expect(result.blockTemplate?.source).toBe('Nœud candidat contrôlé');
    expect(result.coverage).toContain('Aucune preuve de minage ni d’inclusion');
    expect(result.coverage).toContain('Inventaire RPC réconcilié séparément');
    expect(result.coverage).toContain('Blocs/frais : mempool.space');
    expect(fallback).toHaveBeenCalledWith(expect.any(Set));
    expect(projected).not.toHaveBeenCalled();
  });

  it('keeps complete-candidate provenance within public text bounds with maximum source labels', async () => {
    const result = await fetchBitcoinSnapshot(
      { ...config, bitcoinSource: 'R'.repeat(100) },
      bitcoinFetcher(),
      () => now,
      undefined,
      undefined,
      reader(() => template({ source: 'N'.repeat(100) })),
    );
    expect(result.blockTemplate).not.toBeNull();
    expect(result.coverage.length).toBeLessThanOrEqual(700);
    expect(result.message!.length).toBeLessThanOrEqual(700);
    expect(result.coverage).toContain('Compte, poids et médiane sur toutes ses transactions');
    expect(result.message).toContain('détails individuels limités');
  });

  it('treats an empty valid template as a real empty candidate rather than silently substituting a pool', async () => {
    const fallback = vi.fn(() => pool());
    const result = await fetchBitcoinSnapshot(
      config,
      bitcoinFetcher(),
      () => now,
      undefined,
      fallback,
      reader(() => template({ transactions: [], transactionIds: new Set(), count: 0, weight: 0 })),
    );
    expect(result.transactions).toEqual(pool().transactions);
    expect(result.blockTemplate?.transactionCount).toBe(0);
    expect(result.blockTemplate?.medianFeeSats).toBeNull();
    expect(result.blockTemplate?.selectedTransactionIds).toEqual([]);
    expect(result.sampling?.method).toBe('getrawmempool');
    expect(fallback).toHaveBeenCalled();
  });

  it('falls back to the existing complete-pool approach when the optional template is unavailable', async () => {
    const result = await fetchBitcoinSnapshot(
      config,
      bitcoinFetcher(),
      () => now,
      undefined,
      () => pool(),
      reader(() => null),
    );
    expect(result.transactions[0]?.id).toBe(hash('f'));
    expect(result.blockTemplate).toBeNull();
    expect(result.sampling?.method).toBe('getrawmempool');
    expect(result.pendingCount).toBe(12_000);
    expect(result).not.toHaveProperty('medianFeeSats');
    expect(result.message).toContain('approche de repli');
  });

  it('preserves projected-block then recent-transaction fallback without inventing template metadata', async () => {
    const projected = await fetchBitcoinSnapshot(
      config,
      bitcoinFetcher(),
      () => now,
      async () => [transaction(hash('d'))],
      () => null,
      reader(() => null),
    );
    expect(projected.transactions[0]?.id).toBe(hash('d'));
    expect(projected.coverage).toContain('premier bloc projeté');
    expect(projected.blockTemplate).toBeNull();
    const recent = await fetchBitcoinSnapshot(
      config,
      bitcoinFetcher(),
      () => now,
      async () => {
        throw new Error('unavailable');
      },
      () => null,
      reader(() => null),
    );
    expect(recent.transactions[0]?.id).toBe(btcTx.txid);
    expect(recent.coverage).toContain('transactions récentes');
    expect(recent.blockTemplate).toBeNull();
  });

  it.each([
    { previousBlockHash: hash('c') },
    { height: btcBlock.height + 2 },
    { observedAt: now - BITCOIN_TEMPLATE_MAX_AGE_MS - 1 },
    { observedAt: now + 1 },
  ])(
    'rejects a mismatched or expired candidate before choosing the backup (%j)',
    async (overrides) => {
      const result = await fetchBitcoinSnapshot(
        config,
        bitcoinFetcher(),
        () => now,
        undefined,
        () => pool(),
        reader(() => template(overrides)),
      );
      expect(result.blockTemplate).toBeNull();
      expect(result.transactions[0]?.id).toBe(hash('f'));
      expect(result.sampling?.method).toBe('getrawmempool');
    },
  );

  it('reads the projected backup when a previously ready pool expires during REST collection', async () => {
    let reads = 0;
    const projected = vi.fn(async () => [transaction(hash('d'))]);
    const result = await fetchBitcoinSnapshot(
      config,
      bitcoinFetcher(),
      () => now,
      projected,
      () => (++reads === 1 ? pool() : null),
      reader(() => null),
    );
    expect(projected).toHaveBeenCalledTimes(1);
    expect(result.transactions[0]?.id).toBe(hash('d'));
    expect(result.blockTemplate).toBeNull();
  });

  it('carries candidate membership for retained IDs without resampling or refreshing their observation', async () => {
    const first = transaction(hash('e'));
    const second = transaction(hash('f'));
    let active = template();
    const read = createBitcoinProvider(
      config,
      bitcoinFetcher(),
      () => now,
      undefined,
      undefined,
      reader(() => active),
    );
    expect((await read()).transactions.map((tx) => tx.id)).toEqual([first.id]);
    active = template({
      transactions: [second],
      transactionIds: new Set([first.id, second.id]),
      count: 2,
      weight: 1_600,
    });
    const next = await read();
    expect(next.transactions.map((tx) => tx.id)).toEqual([second.id]);
    expect(new Set(next.blockTemplate?.selectedTransactionIds)).toEqual(
      new Set([first.id, second.id]),
    );
    expect(next.transactions.every((tx) => tx.status === 'pending')).toBe(true);
  });

  it('sends only known candidate members rather than the full template inventory', async () => {
    const ids = Array.from({ length: 5_000 }, (_, index) =>
      (index + 50_000).toString(16).padStart(64, '0'),
    );
    const txs = ids.slice(0, PENDING_SAMPLE_LIMIT).map((id) => transaction(id));
    const result = await fetchBitcoinSnapshot(
      config,
      bitcoinFetcher(),
      () => now,
      undefined,
      undefined,
      reader(() =>
        template({
          transactions: txs,
          transactionIds: new Set(ids),
          count: ids.length,
          weight: 4_000_000,
          medianFeeSats: 100,
        }),
      ),
    );
    expect(result.transactions).toHaveLength(PENDING_SAMPLE_LIMIT);
    expect(result.blockTemplate?.transactionCount).toBe(5_000);
    expect(result.blockTemplate?.medianFeeSats).toBe(100);
    expect(result.coverage).toContain('Compte, poids et médiane sur toutes ses transactions');
    expect(result.message).toContain('détails individuels limités');
    expect(result.blockTemplate?.selectedTransactionIds).toHaveLength(PENDING_SAMPLE_LIMIT);
    expect(new Set(result.blockTemplate?.selectedTransactionIds)).toEqual(
      new Set(txs.map((tx) => tx.id)),
    );
  });

  it('reserves bounded outside-candidate details without changing complete candidate accounting', async () => {
    const members = Array.from({ length: PENDING_SAMPLE_LIMIT }, (_, index) =>
      transaction((index + 10_000).toString(16).padStart(64, '0'), 50),
    );
    const outsiders = Array.from(
      { length: BITCOIN_OUTSIDE_TEMPLATE_SAMPLE_LIMIT + 108 },
      (_, index) => transaction((index + 20_000).toString(16).padStart(64, '0'), 100),
    );
    const memberIds = new Set(members.map((tx) => tx.id));
    const readPool = vi.fn(() => ({
      ...pool(),
      transactions: outsiders,
      count: 10_000,
      hasTransaction: () => true,
    }));
    const result = await fetchBitcoinSnapshot(
      config,
      bitcoinFetcher(),
      () => now,
      undefined,
      readPool,
      reader(() =>
        template({
          transactions: members,
          transactionIds: memberIds,
          count: 5_000,
          weight: 3_992_000,
          medianFeeSats: 100,
        }),
      ),
    );
    const outside = result.transactions.filter((tx) => !memberIds.has(tx.id));
    expect(outside).toHaveLength(BITCOIN_OUTSIDE_TEMPLATE_SAMPLE_LIMIT);
    expect(result.transactions).toHaveLength(PENDING_SAMPLE_LIMIT);
    expect(
      result.transactions
        .slice(0, PENDING_SAMPLE_LIMIT - BITCOIN_OUTSIDE_TEMPLATE_SAMPLE_LIMIT)
        .every((tx) => memberIds.has(tx.id)),
    ).toBe(true);
    expect(result.blockTemplate).toMatchObject({
      transactionCount: 5_000,
      weight: 3_992_000,
      medianFeeSats: 100,
    });
    expect(result.blockTemplate?.selectedTransactionIds).toHaveLength(
      PENDING_SAMPLE_LIMIT - BITCOIN_OUTSIDE_TEMPLATE_SAMPLE_LIMIT,
    );
    expect(result.poolObservation).toMatchObject({
      source: pool().source,
      observedAt: now,
      absentTransactionIds: [],
      queuedTransactionIds: [],
    });
    expect(result.poolObservation?.presentTransactionIds).toHaveLength(PENDING_SAMPLE_LIMIT);
    expect(readPool).toHaveBeenCalledWith(memberIds);
  });

  it('retains a valid empty earlier inventory independently of a newer nonempty candidate', async () => {
    const result = await fetchBitcoinSnapshot(
      config,
      bitcoinFetcher(),
      () => now,
      undefined,
      () => ({
        ...pool(),
        transactions: [],
        count: 0,
        observedAt: now - 1_000,
        hasTransaction: () => false,
      }),
      reader(() => template()),
    );
    expect(result.pendingCount).toBe(0);
    expect(result.sampling).toMatchObject({ pendingCount: 0, observedAt: now - 1_000 });
    expect(result.transactions).toEqual([transaction()]);
    expect(result.blockTemplate?.transactionCount).toBe(1);
    expect(result.poolObservation).toMatchObject({
      observedAt: now - 1_000,
      presentTransactionIds: [],
      absentTransactionIds: [transaction().id],
    });
  });

  it('does not invent presence observations for injected readers without complete-inventory lookup', async () => {
    const result = await fetchBitcoinSnapshot(
      config,
      bitcoinFetcher(),
      () => now,
      undefined,
      () => pool(),
      reader(() => template()),
    );
    expect(result.sampling?.method).toBe('getrawmempool');
    expect(result.poolObservation).toBeNull();
  });

  it('keeps individual inventory observations bounded with current IDs ahead of older tracked samples', async () => {
    let cohort = 0;
    const current = () =>
      Array.from({ length: PENDING_SAMPLE_LIMIT }, (_, index) =>
        transaction(
          (cohort * PENDING_SAMPLE_LIMIT + index + 50_000).toString(16).padStart(64, '0'),
        ),
      );
    const read = createBitcoinProvider(
      config,
      bitcoinFetcher(),
      () => now,
      undefined,
      () => {
        const transactions = current();
        const ids = new Set(transactions.map((tx) => tx.id));
        return { ...pool(), transactions, count: 50_000, hasTransaction: (id) => ids.has(id) };
      },
      reader(() => template({ transactions: [], transactionIds: new Set(), count: 0, weight: 0 })),
    );
    let result = await read();
    for (cohort = 1; cohort < 6; cohort += 1) result = await read();
    const observation = result.poolObservation!;
    expect(observation.presentTransactionIds).toHaveLength(PENDING_SAMPLE_LIMIT);
    expect(observation.presentTransactionIds.length + observation.absentTransactionIds.length).toBe(
      MAX_TRACKED_TRANSACTIONS,
    );
    expect(observation.queuedTransactionIds).toEqual([]);
    expect(
      new Set([...observation.presentTransactionIds, ...observation.absentTransactionIds]).size,
    ).toBe(MAX_TRACKED_TRANSACTIONS);
    expect(result.blockTemplate?.transactionCount).toBe(0);
  });

  it('withdraws a template that expires during slow inclusion checks and returns the backup', async () => {
    let time = now;
    let delayed = false;
    const core = bitcoinFetcher();
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      if (!delayed && String(input).endsWith('/txids')) {
        delayed = true;
        time += BITCOIN_TEMPLATE_MAX_AGE_MS + 1;
      }
      return core(input, init);
    });
    const projected = vi.fn(async () => [transaction(hash('d'))]);
    const result = await fetchBitcoinSnapshot(
      config,
      fetcher,
      () => time,
      projected,
      undefined,
      reader(() => template()),
    );
    expect(result.blockTemplate).toBeNull();
    expect(result.transactions[0]?.id).toBe(hash('d'));
    expect(projected).toHaveBeenCalledTimes(1);
    expect(result.observedAt).toBe(time);
  });

  it('lets exact mined-block evidence override an inconsistent candidate member', async () => {
    const included = transaction();
    const result = await fetchBitcoinSnapshot(
      config,
      bitcoinFetcher({
        '/v1/blocks': [{ ...btcBlock, tx_count: 1 }],
        [`/block/${btcBlock.id}/txids`]: [included.id],
      }),
      () => now,
      undefined,
      undefined,
      reader(() => template()),
    );
    expect(result.transactions).toEqual([
      { ...included, status: 'confirmed', blockHash: btcBlock.id },
    ]);
    expect(result.inclusions?.[0]?.transactionIds).toContain(included.id);
    expect(result.blockTemplate?.selectedTransactionIds).toContain(included.id);
  });

  it('withdraws a captured candidate when its reader invalidates it during inclusion checks', async () => {
    let active: BitcoinTemplateSample | null = template();
    const core = bitcoinFetcher();
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).endsWith('/txids')) active = null;
      return core(input, init);
    });
    const fallback = vi.fn(() => pool());
    const result = await fetchBitcoinSnapshot(
      config,
      fetcher,
      () => now,
      undefined,
      fallback,
      reader(() => active),
    );
    expect(result.blockTemplate).toBeNull();
    expect(result.sampling?.method).toBe('getrawmempool');
    expect(result.transactions[0]?.id).toBe(hash('f'));
    expect(result.observedAt).toBe(now);
  });
});
