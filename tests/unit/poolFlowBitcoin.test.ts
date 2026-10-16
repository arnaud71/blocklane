import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BITCOIN_POOL_REFRESH_MS,
  createBitcoinPoolReader,
  type BitcoinPoolSample,
} from '../../server/adapters/bitcoinPool';
import {
  fetchBitcoinSnapshot,
  BITCOIN_OUTSIDE_TEMPLATE_SAMPLE_LIMIT,
} from '../../server/adapters/bitcoin';
import type {
  BitcoinTemplateReader,
  BitcoinTemplateSample,
} from '../../server/adapters/bitcoinTemplate';
import { PENDING_SAMPLE_LIMIT, type Tx } from '../../shared/model';
import { bitcoinFetcher, btcBlock, config, now } from './fixtures';

const identifier = (value: number) => value.toString(16).padStart(64, '0');
const entry = (fee: number) => ({ vsize: 100, weight: 400, fees: { base: fee / 100_000_000 } });

function controlledPool(values: number[]) {
  let time = now;
  let ids = values.map(identifier);
  let failed = false;
  let failedDetail: string | undefined;
  const fees = new Map<string, number>();
  const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
    if (failed) return new Response('indisponible', { status: 503 });
    const requests = JSON.parse(String(init?.body)) as {
      id: string;
      method: string;
      params: unknown[];
    }[];
    return Response.json(
      requests.map((request) => {
        if (request.method === 'getmempoolentry' && request.id === failedDetail)
          return {
            id: request.id,
            error: { code: -5, message: 'Transaction no longer available' },
          };
        return {
          id: request.id,
          result:
            request.method === 'getblockchaininfo'
              ? { chain: 'main', initialblockdownload: false }
              : request.method === 'getmempoolentry'
                ? entry(fees.get(request.id) ?? 100)
                : request.params[0] === true
                  ? Object.fromEntries(ids.map((id) => [id, entry(fees.get(id) ?? 100)]))
                  : { txids: ids, mempool_sequence: 2 },
        };
      }),
    );
  });
  const read = createBitcoinPoolReader(config, fetcher, () => time);
  const observed = async (): Promise<BitcoinPoolSample> => {
    read();
    await vi.waitFor(() => expect(read()?.observedAt).toBe(time));
    return read()!;
  };
  return {
    read,
    observed,
    fetcher,
    fees,
    time: () => time,
    advance: (milliseconds = BITCOIN_POOL_REFRESH_MS + 1) => {
      time += milliseconds;
    },
    inventory: (next: number[]) => {
      ids = next.map(identifier);
    },
    failure: (value: boolean) => {
      failed = value;
    },
    detailFailure: (value?: number) => {
      failedDetail = value === undefined ? undefined : identifier(value);
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('Bitcoin complete inventory flow', () => {
  it('starts with a baseline, then reports gross observed entries and disappearances separately', async () => {
    const upstream = controlledPool([1, 2]);
    const first = await upstream.observed();
    expect(first.flowForSample?.(new Set())).toMatchObject({
      method: 'getrawmempool',
      observedAt: now,
      state: 'warming',
      inventoryCount: 2,
      history: [],
    });
    upstream.inventory([2, 3, 4]);
    upstream.advance();
    const next = await upstream.observed();
    const flow = next.flowForSample!(new Set([identifier(3)]))!;
    expect(flow).toMatchObject({ state: 'ready', inventoryCount: 3, observedAt: upstream.time() });
    expect(flow.history).toEqual([
      {
        fromObservedAt: now,
        observedAt: upstream.time(),
        previousCount: 2,
        currentCount: 3,
        enteredCount: 2,
        disappearedCount: 1,
        outsideSampleEnteredCount: 1,
      },
    ]);
    expect(next.flowForSample!(new Set([identifier(3), identifier(4)]))).toEqual(flow);
    expect(first.flowForSample!(new Set())).toBeNull();
    expect(JSON.stringify(flow)).not.toContain(identifier(3));
    expect(upstream.fetcher).toHaveBeenCalledTimes(3);
  });

  it('invalidates a failed detail reconciliation instead of exposing an incomplete or zero flow', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const upstream = controlledPool([1, 2]);
    await upstream.observed();
    upstream.inventory([2, 3]);
    upstream.advance();
    const ready = await upstream.observed();
    expect(ready.flowForSample!(new Set())!.state).toBe('ready');
    upstream.inventory([2, 3, 4]);
    upstream.detailFailure(4);
    upstream.advance();
    upstream.read();
    await vi.waitFor(() => expect(ready.flowForSample!(new Set())).toBeNull());
    expect(upstream.read()).toBeNull();
    upstream.detailFailure();
    upstream.advance();
    const recovered = await upstream.observed();
    expect(recovered.flowForSample!(new Set())).toMatchObject({
      state: 'warming',
      inventoryCount: 3,
      history: [],
    });
  });

  it('invalidates transport failures and backward clocks without retaining a ready interval', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const upstream = controlledPool([1]);
    await upstream.observed();
    upstream.inventory([1, 2]);
    upstream.advance();
    const ready = await upstream.observed();
    expect(ready.flowForSample!(new Set())!.state).toBe('ready');
    upstream.failure(true);
    upstream.advance();
    upstream.read();
    await vi.waitFor(() => expect(ready.flowForSample!(new Set())).toBeNull());
    upstream.failure(false);
    upstream.advance();
    const restored = await upstream.observed();
    expect(restored.flowForSample!(new Set())!.state).toBe('warming');
    upstream.advance(-1);
    expect(upstream.read()).toBeNull();
    expect(restored.flowForSample!(new Set())).toBeNull();
  });

  it('takes a new baseline after an excessive gap instead of counting the old stock as arrivals', async () => {
    const upstream = controlledPool([1]);
    await upstream.observed();
    upstream.inventory([1, 2, 3]);
    upstream.advance(90_001);
    const next = await upstream.observed();
    expect(next.flowForSample!(new Set())).toMatchObject({
      state: 'warming',
      inventoryCount: 3,
      history: [],
    });
  });

  it('classifies outside details against the final GBT mixture, not the pool ranking alone', async () => {
    const members: Tx[] = Array.from({ length: PENDING_SAMPLE_LIMIT }, (_, index) => ({
      id: identifier(10_000 + index),
      chain: 'bitcoin',
      status: 'pending',
      feeRate: 50,
      size: 100,
      kind: 'transfer',
      value: 'Montant non fourni',
    }));
    const memberNumbers = members.map((_, index) => 10_000 + index);
    const outsiders = Array.from({ length: 500 }, (_, index) => 20_000 + index);
    const candidateNew = memberNumbers.at(-1)!;
    const selectedOutside = 30_000;
    const unselectedOutside = 30_001;
    const upstream = controlledPool([...memberNumbers.slice(0, -1), ...outsiders]);
    members.forEach(({ id }) => upstream.fees.set(id, 5_000));
    outsiders.forEach((value) => upstream.fees.set(identifier(value), 20_000));
    upstream.fees.set(identifier(selectedOutside), 1_000_000);
    upstream.fees.set(identifier(unselectedOutside), 1);
    await upstream.observed();
    upstream.inventory([...memberNumbers, ...outsiders, selectedOutside, unselectedOutside]);
    upstream.advance();
    await upstream.observed();
    const template: BitcoinTemplateSample = {
      transactions: members,
      transactionIds: new Set(members.map(({ id }) => id)),
      count: members.length,
      source: 'Candidat contrôlé',
      observedAt: upstream.time(),
      height: btcBlock.height + 1,
      previousBlockHash: btcBlock.id,
      weight: members.length * 400,
      weightLimit: 4_000_000,
      medianFeeSats: 5_000,
    };
    const readTemplate: BitcoinTemplateReader = Object.assign(() => template, {
      state: () => ({ pending: false, nextAttemptAt: upstream.time() + 15_000, failure: null }),
    });
    const result = await fetchBitcoinSnapshot(
      config,
      bitcoinFetcher(),
      upstream.time,
      undefined,
      upstream.read,
      readTemplate,
    );
    const ids = new Set(
      result.transactions.filter(({ status }) => status === 'pending').map(({ id }) => id),
    );
    expect(result.blockTemplate).not.toBeNull();
    expect(ids.size).toBe(PENDING_SAMPLE_LIMIT);
    expect(ids.has(identifier(candidateNew))).toBe(false);
    expect(ids.has(identifier(selectedOutside))).toBe(true);
    expect(ids.has(identifier(unselectedOutside))).toBe(false);
    expect(result.transactions.filter(({ id }) => !template.transactionIds.has(id))).toHaveLength(
      BITCOIN_OUTSIDE_TEMPLATE_SAMPLE_LIMIT,
    );
    expect(result.poolFlow?.history.at(-1)).toMatchObject({
      enteredCount: 3,
      disappearedCount: 0,
      outsideSampleEnteredCount: 2,
    });
  });

  it('publishes no flow without a complete pool or from a callback for a superseded inventory', async () => {
    const upstream = controlledPool([10_000]);
    const old = await upstream.observed();
    upstream.inventory([10_000, 10_001]);
    upstream.advance(BITCOIN_POOL_REFRESH_MS);
    await upstream.observed();
    const obsolete = await fetchBitcoinSnapshot(
      config,
      bitcoinFetcher(),
      upstream.time,
      undefined,
      () => old,
    );
    expect(obsolete.poolFlow).toBeNull();
    const fallback = await fetchBitcoinSnapshot(
      config,
      bitcoinFetcher(),
      upstream.time,
      undefined,
      () => null,
    );
    expect(fallback.poolFlow).toBeNull();
  });
});
