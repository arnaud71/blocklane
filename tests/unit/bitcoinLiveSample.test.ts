import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBitcoinProvider, fetchBitcoinSnapshot } from '../../server/adapters/bitcoin';
import {
  BITCOIN_TEMPLATE_MAX_AGE_MS,
  type BitcoinTemplateReader,
  type BitcoinTemplateSample,
} from '../../server/adapters/bitcoinTemplate';
import type { BitcoinPoolSample } from '../../server/adapters/bitcoinPool';
import {
  BITCOIN_LIVE_ARRIVAL_TTL_MS,
  type BitcoinArrivalSample,
} from '../../server/bitcoinLiveArrivals';
import {
  BITCOIN_ARRIVAL_SAMPLE_LIMIT,
  PENDING_SAMPLE_LIMIT,
  snapshotSchema,
  type Tx,
} from '../../shared/model';
import { bitcoinFetcher, btcBlock, config, hash, now } from './fixtures';

const id = (value: number) => value.toString(16).padStart(64, '0');
const tx = (value: number, feeRate = 20): Tx => ({
  id: id(value),
  chain: 'bitcoin',
  status: 'pending',
  feeRate,
  size: 200,
  kind: 'transfer',
  value: 'Montant non fourni',
});
const arrivalSample = (transactions: readonly Tx[], observedAt = now): BitcoinArrivalSample => ({
  source: 'Notifications Bitcoin contrôlées',
  observedAt,
  transactions,
});
const chainFetcher = () =>
  bitcoinFetcher({
    '/v1/blocks': [{ ...btcBlock, tx_count: 1 }],
    [`/block/${btcBlock.id}/txids`]: [id(1)],
  });
function template(
  transactions: readonly Tx[],
  members = transactions.map(({ id }) => id),
): BitcoinTemplateReader {
  const sample: BitcoinTemplateSample = {
    source: 'Candidat contrôlé',
    transactions,
    transactionIds: new Set(members),
    count: members.length,
    observedAt: now,
    height: btcBlock.height + 1,
    previousBlockHash: btcBlock.id,
    weight: members.length * 800,
    weightLimit: 4_000_000,
    medianFeeSats: members.length ? 4_000 : null,
  };
  return Object.assign(() => sample, {
    state: () => ({ pending: false, nextAttemptAt: now + 15_000, failure: null }),
  });
}

beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(now));
afterEach(() => vi.restoreAllMocks());

describe('Real Bitcoin arrivals in the bounded individual sample', () => {
  it('includes real arrivals without a pool and carries only actual private GBT membership', async () => {
    const base = [tx(10_000, 100)];
    const arrivals = [tx(100_001, 1), tx(100_000, 2)];
    const result = await fetchBitcoinSnapshot(
      config,
      chainFetcher(),
      () => now,
      undefined,
      undefined,
      template(base, [base[0]!.id, arrivals[1]!.id]),
      () => arrivalSample(arrivals, now - 1_000),
    );
    expect(result.transactions).toEqual([...arrivals, ...base]);
    expect(result.bitcoinArrivals).toEqual({
      source: 'Notifications Bitcoin contrôlées',
      method: 'mempool-transactions',
      observedAt: now - 1_000,
      transactionIds: arrivals.map(({ id }) => id),
    });
    expect(new Set(result.blockTemplate?.selectedTransactionIds)).toEqual(
      new Set([arrivals[1]!.id, base[0]!.id]),
    );
    expect(result.blockTemplate?.selectedTransactionIds).not.toContain(arrivals[0]!.id);
    expect(result.blockTemplate?.transactionCount).toBe(2);
    expect(result.blockTemplate?.weight).toBe(1_600);
    expect(result.sampling).toBeNull();
    expect(result.poolObservation).toBeNull();
    expect(result.coverage).toContain('Échantillon mixte');
    expect(result.message).toContain('sans top global');
    expect(snapshotSchema.safeParse(result).success).toBe(true);
  });

  it('prioritizes at most 384 recent arrivals and fills the unique 1920 limit from the existing sample', async () => {
    const base = Array.from({ length: PENDING_SAMPLE_LIMIT }, (_, index) =>
      tx(10_000 + index, 100),
    );
    const arrivals = Array.from({ length: BITCOIN_ARRIVAL_SAMPLE_LIMIT + 20 }, (_, index) =>
      tx(100_000 + index, 1),
    );
    const result = await fetchBitcoinSnapshot(
      config,
      chainFetcher(),
      () => now,
      async () => base,
      undefined,
      undefined,
      () => arrivalSample(arrivals),
    );
    expect(result.transactions).toHaveLength(PENDING_SAMPLE_LIMIT);
    expect(result.transactions.slice(0, BITCOIN_ARRIVAL_SAMPLE_LIMIT)).toEqual(
      arrivals.slice(0, BITCOIN_ARRIVAL_SAMPLE_LIMIT),
    );
    expect(result.transactions.slice(BITCOIN_ARRIVAL_SAMPLE_LIMIT)).toEqual(
      base.slice(0, PENDING_SAMPLE_LIMIT - BITCOIN_ARRIVAL_SAMPLE_LIMIT),
    );
    expect(new Set(result.transactions.map(({ id }) => id)).size).toBe(PENDING_SAMPLE_LIMIT);
    expect(result.bitcoinArrivals?.transactionIds).toHaveLength(BITCOIN_ARRIVAL_SAMPLE_LIMIT);
  });

  it('deduplicates arrivals already in the base, retaining their newest supplied metadata', async () => {
    const base = [tx(10_000, 10), tx(10_001, 20), tx(10_002, 30)];
    const arrivals = [tx(10_001, 25), tx(20_000, 1), tx(10_001, 15)];
    const result = await fetchBitcoinSnapshot(
      config,
      chainFetcher(),
      () => now,
      async () => base,
      undefined,
      undefined,
      () => arrivalSample(arrivals),
    );
    expect(result.transactions).toEqual([arrivals[0], arrivals[1], base[0], base[2]]);
    expect(result.bitcoinArrivals?.transactionIds).toEqual([id(10_001), id(20_000)]);
  });

  it('admits a new batch at the front without retaining an evicted arrival as current evidence', async () => {
    const base = [tx(10_000)];
    let arrivals = Array.from({ length: BITCOIN_ARRIVAL_SAMPLE_LIMIT }, (_, index) =>
      tx(100_000 + index),
    );
    const read = createBitcoinProvider(
      config,
      chainFetcher(),
      () => now,
      async () => base,
      undefined,
      undefined,
      () => arrivalSample(arrivals),
    );
    const initial = await read();
    const evicted = arrivals.at(-1)!.id;
    arrivals = [tx(200_000), ...arrivals.slice(0, -1)];
    const next = await read();
    expect(initial.bitcoinArrivals?.transactionIds).toContain(evicted);
    expect(next.transactions[0]?.id).toBe(id(200_000));
    expect(next.bitcoinArrivals?.transactionIds).not.toContain(evicted);
    expect(next.transactions.some(({ id }) => id === evicted)).toBe(false);
    expect(next.transactions.at(-1)).toEqual(base[0]);
  });

  it.each(['empty', 'absent', 'failed', 'expired', 'future'] as const)(
    'does not reserve slots when arrivals are %s',
    async (state) => {
      const base = Array.from({ length: PENDING_SAMPLE_LIMIT }, (_, index) => tx(10_000 + index));
      const incoming = () => {
        if (state === 'failed') throw new Error('private-event-provider-failure');
        if (state === 'absent') return null;
        return arrivalSample(
          state === 'empty' ? [] : [tx(100_000)],
          state === 'expired'
            ? now - BITCOIN_LIVE_ARRIVAL_TTL_MS - 1
            : state === 'future'
              ? now + 1
              : now,
        );
      };
      const result = await fetchBitcoinSnapshot(
        config,
        chainFetcher(),
        () => now,
        async () => base,
        undefined,
        undefined,
        incoming,
      );
      expect(result.transactions).toEqual(base);
      expect(result.bitcoinArrivals).toBeNull();
      expect(result.status).toBe('ok');
      expect(JSON.stringify(result)).not.toContain('private-event-provider-failure');
    },
  );

  it('checks newly arrived IDs against the canonical latest block before publishing them as pending', async () => {
    const arrival = tx(100_000);
    const fetcher = bitcoinFetcher({
      '/v1/blocks': [{ ...btcBlock, tx_count: 2 }],
      [`/block/${btcBlock.id}/txids`]: [id(1), arrival.id],
    });
    const read = createBitcoinProvider(
      config,
      fetcher,
      () => now,
      async () => [tx(10_000)],
      undefined,
      undefined,
      () => arrivalSample([arrival]),
    );
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await read();
      expect(result.bitcoinArrivals).toBeNull();
      expect(result.transactions.filter(({ id }) => id === arrival.id)).toEqual([
        { ...arrival, status: 'confirmed', blockHash: btcBlock.id },
      ]);
      expect(result.inclusions?.[0]?.transactionIds).toContain(arrival.id);
    }
  });

  it('tracks arrivals through a later real block and does not revive known older confirmations', async () => {
    const arrival = tx(100_000);
    let stage = 0;
    const blocks = [btcBlock.id, hash('b'), hash('c')];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const head = {
        ...btcBlock,
        id: blocks[stage]!,
        height: btcBlock.height + stage,
        tx_count: stage === 1 ? 2 : 1,
      };
      const entries = Array.from({ length: stage + 1 }, (_, index) => ({
        ...btcBlock,
        id: blocks[index]!,
        height: btcBlock.height + index,
        tx_count: index === 1 ? 2 : 1,
      })).reverse();
      const core = bitcoinFetcher({
        '/v1/blocks': entries,
        [`/block/${head.id}/txids`]: stage === 1 ? [id(1), arrival.id] : [id(1)],
      });
      return core(input, init);
    });
    const read = createBitcoinProvider(
      config,
      fetcher,
      () => now,
      async () => [tx(10_000)],
      undefined,
      undefined,
      () => arrivalSample([arrival]),
    );
    expect((await read()).bitcoinArrivals?.transactionIds).toContain(arrival.id);
    stage = 1;
    const confirmed = await read();
    expect(confirmed.bitcoinArrivals).toBeNull();
    expect(confirmed.transactions.find(({ id }) => id === arrival.id)?.status).toBe('confirmed');
    stage = 2;
    const later = await read();
    expect(later.bitcoinArrivals).toBeNull();
    expect(later.transactions.some(({ id }) => id === arrival.id)).toBe(false);
    expect(
      later.inclusions?.some(({ transactionIds }) => transactionIds.includes(arrival.id)),
    ).toBe(true);
  });

  it('retains pending evidence on inclusion failure and confirms it when the exact check recovers', async () => {
    const arrival = tx(100_000);
    let failed = true;
    const core = bitcoinFetcher({
      '/v1/blocks': [{ ...btcBlock, tx_count: 2 }],
      [`/block/${btcBlock.id}/txids`]: [id(1), arrival.id],
    });
    const fetcher = vi.fn<typeof fetch>(async (input, init) =>
      failed && String(input).endsWith('/txids')
        ? new Response('private-upstream-error', { status: 503 })
        : core(input, init),
    );
    const read = createBitcoinProvider(
      config,
      fetcher,
      () => now,
      async () => [],
      undefined,
      undefined,
      () => arrivalSample([arrival]),
    );
    const unavailableProof = await read();
    expect(unavailableProof.bitcoinArrivals?.transactionIds).toEqual([arrival.id]);
    expect(unavailableProof.transactions[0]?.status).toBe('pending');
    expect(unavailableProof.message).toContain('partiellement vérifiées');
    failed = false;
    const recovered = await read();
    expect(recovered.bitcoinArrivals).toBeNull();
    expect(recovered.transactions[0]?.status).toBe('confirmed');
  });

  it('never lets a full retained watch list hide the latest exact inclusion when an older height fails', async () => {
    const arrival = tx(1_000_000);
    let cohort = 0;
    let advanced = false;
    const head = { ...btcBlock, id: hash('d'), height: btcBlock.height + 2, tx_count: 2 };
    const missed = { ...btcBlock, id: hash('c'), height: btcBlock.height + 1, tx_count: 1 };
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      if (advanced && String(input).includes(`/block/${missed.id}/txids`))
        return new Response('', { status: 503 });
      const core = bitcoinFetcher({
        '/v1/blocks': advanced
          ? [head, missed, { ...btcBlock, tx_count: 1 }]
          : [{ ...btcBlock, tx_count: 1 }],
        [`/block/${btcBlock.id}/txids`]: [id(1)],
        [`/block/${head.id}/txids`]: [id(1), arrival.id],
      });
      return core(input, init);
    });
    const read = createBitcoinProvider(
      config,
      fetcher,
      () => now,
      async () =>
        Array.from({ length: PENDING_SAMPLE_LIMIT }, (_, index) =>
          tx(10_000 + cohort * PENDING_SAMPLE_LIMIT + index),
        ),
      undefined,
      undefined,
      () => (advanced ? arrivalSample([arrival]) : null),
    );
    for (cohort = 0; cohort < 3; cohort++) await read();
    advanced = true;
    const result = await read();
    expect(result.message).toContain('partiellement vérifiées');
    expect(result.transactions.find(({ id }) => id === arrival.id)).toMatchObject({
      status: 'confirmed',
      blockHash: head.id,
    });
    expect(result.bitcoinArrivals).toBeNull();
    expect(
      result.inclusions?.find(({ block }) => block.hash === head.id)?.transactionIds,
    ).toContain(arrival.id);
  });

  it('keeps RPC counts and presence honest for a separately observed fresh arrival', async () => {
    const arrivals = [tx(100_000), tx(100_001)];
    const pool: BitcoinPoolSample = {
      source: 'RPC distinct',
      observedAt: now - 1_000,
      transactions: [],
      count: 0,
      update: 'incremental',
      hasTransaction: () => false,
    };
    const result = await fetchBitcoinSnapshot(
      config,
      chainFetcher(),
      () => now,
      undefined,
      () => pool,
      undefined,
      () => arrivalSample(arrivals),
    );
    expect(result.transactions).toEqual(arrivals);
    expect(result.pendingCount).toBe(0);
    expect(result.sampling).toMatchObject({
      source: 'RPC distinct',
      pendingCount: 0,
      observedAt: now - 1_000,
    });
    expect(result.poolObservation).toMatchObject({
      source: 'RPC distinct',
      presentTransactionIds: [],
      absentTransactionIds: [],
    });
    expect(result.bitcoinArrivals?.transactionIds).toEqual(arrivals.map(({ id }) => id));
  });

  it('keeps positive RPC presence and passes the final mixed selection into pool-flow aggregation', async () => {
    const arrival = tx(100_000);
    const base = tx(10_000);
    const flowForSample = vi.fn(() => null);
    const pool: BitcoinPoolSample = {
      source: 'RPC distinct',
      observedAt: now,
      transactions: [base],
      count: 10,
      update: 'full',
      hasTransaction: (id) => id === arrival.id || id === base.id,
      flowForSample,
    };
    const result = await fetchBitcoinSnapshot(
      config,
      chainFetcher(),
      () => now,
      undefined,
      () => pool,
      undefined,
      () => arrivalSample([arrival]),
    );
    expect(new Set(result.poolObservation?.presentTransactionIds)).toEqual(
      new Set([arrival.id, base.id]),
    );
    expect(flowForSample).toHaveBeenCalledWith(new Set([arrival.id, base.id]));
  });

  it('withdraws arrivals that expire during a slow inclusion check and retries once without them', async () => {
    const arrival = tx(100_000);
    let time = now;
    const core = chainFetcher();
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).endsWith('/txids')) time = now + BITCOIN_LIVE_ARRIVAL_TTL_MS + 1;
      return core(input, init);
    });
    const projection = vi.fn(async () => [tx(10_000)]);
    const result = await fetchBitcoinSnapshot(
      config,
      fetcher,
      () => time,
      projection,
      undefined,
      undefined,
      () => arrivalSample([arrival]),
    );
    expect(result.bitcoinArrivals).toBeNull();
    expect(result.transactions).toEqual([tx(10_000)]);
    expect(result.observedAt).toBe(time);
    expect(projection).toHaveBeenCalledTimes(2);
  });

  it('retains fresh arrivals when an expired GBT forces the existing projection retry', async () => {
    const arrival = tx(100_000);
    let time = now;
    const core = chainFetcher();
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).endsWith('/txids')) time = now + BITCOIN_TEMPLATE_MAX_AGE_MS + 1;
      return core(input, init);
    });
    const result = await fetchBitcoinSnapshot(
      config,
      fetcher,
      () => time,
      async () => [tx(10_001)],
      undefined,
      template([tx(10_000)]),
      () => arrivalSample([arrival]),
    );
    expect(result.blockTemplate).toBeNull();
    expect(result.transactions).toEqual([arrival, tx(10_001)]);
    expect(result.bitcoinArrivals?.observedAt).toBe(now);
  });

  it.each([
    { withTemplate: true, withPool: false },
    { withTemplate: true, withPool: true },
    { withTemplate: false, withPool: true },
  ])(
    'keeps mixed-sample explanations within public bounds with maximum source labels (%j)',
    async ({ withTemplate, withPool }) => {
      const arrival = tx(100_000);
      const candidate = template([tx(10_000)]);
      const sample = candidate()!;
      const read = Object.assign(() => ({ ...sample, source: 'G'.repeat(100) }), {
        state: candidate.state,
      });
      const result = await fetchBitcoinSnapshot(
        { ...config, bitcoinSource: 'R'.repeat(100) },
        chainFetcher(),
        () => now,
        undefined,
        withPool
          ? () => ({
              source: 'P'.repeat(100),
              transactions: [],
              count: 0,
              observedAt: now,
              update: 'full',
              hasTransaction: () => false,
            })
          : undefined,
        withTemplate ? read : undefined,
        () => ({ ...arrivalSample([arrival]), source: 'W'.repeat(100) }),
      );
      expect(result.coverage.length).toBeLessThanOrEqual(700);
      expect(result.message!.length).toBeLessThanOrEqual(700);
      if (withTemplate) expect(result.coverage).toContain('compte, poids et médiane inchangés');
      if (withPool) expect(result.sampling?.source).toBe('P'.repeat(100));
      expect(snapshotSchema.safeParse(result).success).toBe(true);
    },
  );
});
