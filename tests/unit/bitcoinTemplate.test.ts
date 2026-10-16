import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BITCOIN_TEMPLATE_MAX_AGE_MS,
  BITCOIN_TEMPLATE_MAX_BYTES,
  BITCOIN_TEMPLATE_MAX_TRANSACTIONS,
  BITCOIN_TEMPLATE_REFRESH_MS,
  createBitcoinTemplateReader,
  type BitcoinTemplateReader,
} from '../../server/adapters/bitcoinTemplate.js';
import type { Fetcher } from '../../server/network.js';
import { PENDING_SAMPLE_LIMIT } from '../../shared/model.js';
import { config, hash, now } from './fixtures.js';

function witnessHash(data: string): string {
  return createHash('sha256')
    .update(createHash('sha256').update(Buffer.from(data, 'hex')).digest())
    .digest()
    .reverse()
    .toString('hex');
}

function transaction(id: number, fee = 100) {
  // A tiny legacy transfer; raw bytes are private to the mocked upstream.
  const data = `0200000001${id.toString(16).padStart(64, '0')}0000000000ffffffff0101000000000000000000000000`;
  return {
    txid: witnessHash(data),
    hash: witnessHash(data),
    data,
    fee,
    weight: data.length * 2,
    depends: [] as number[],
  };
}

function fixture() {
  let time = now;
  let chain: unknown = {
    chain: 'main',
    blocks: 100,
    bestblockhash: hash('a'),
    initialblockdownload: false,
  };
  let template: unknown = {
    height: 101,
    previousblockhash: hash('a'),
    weightlimit: 4_000_000,
    transactions: [transaction(1)],
  };
  let responseIdOffset = 0;
  let responseError: unknown;
  let handler: ((method: string) => unknown | Promise<unknown>) | undefined;
  const methods: string[] = [];
  const fetcher = vi.fn<Fetcher>(async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params: unknown[];
    };
    methods.push(request.method);
    if (request.method === 'getblocktemplate')
      expect(request.params).toEqual([{ rules: ['segwit'] }]);
    const result = handler
      ? await handler(request.method)
      : request.method === 'getblockchaininfo'
        ? chain
        : template;
    if (result instanceof Response) return result;
    return Response.json({
      jsonrpc: '2.0',
      id: request.id + responseIdOffset,
      ...(responseError === undefined ? { result } : { error: responseError }),
    });
  });
  const reader = createBitcoinTemplateReader(config, fetcher, () => time);
  return {
    reader,
    fetcher,
    methods,
    advance: (duration: number) => {
      time += duration;
    },
    setChain: (value: unknown) => {
      chain = value;
    },
    setTemplate: (value: unknown) => {
      template = value;
    },
    setIdOffset: (value: number) => {
      responseIdOffset = value;
    },
    setError: (value: unknown) => {
      responseError = value;
    },
    setHandler: (value: typeof handler) => {
      handler = value;
    },
    validTemplate: (transactions = [transaction(1)]) => ({
      height: 101,
      previousblockhash: hash('a'),
      weightlimit: 4_000_000,
      transactions,
    }),
    validChain: {
      chain: 'main',
      blocks: 100,
      bestblockhash: hash('a'),
      initialblockdownload: false,
    },
  };
}

async function collected(reader: BitcoinTemplateReader) {
  reader();
  await vi.waitFor(() => expect(reader.state().pending).toBe(false));
  return reader();
}

async function finishBackground(): Promise<void> {
  for (let turn = 0; turn < 100; turn += 1) await Promise.resolve();
}

afterEach(() => vi.useRealTimers());

describe('Bitcoin node template background reader', () => {
  it('returns a bounded candidate sample and its complete private membership, not a mined block', async () => {
    const f = fixture();
    const tx = transaction(1, 120);
    f.setTemplate(f.validTemplate([tx]));
    expect(f.reader()).toBeNull();
    expect(f.reader.state().pending).toBe(true);
    const sample = await collected(f.reader);
    expect(sample).toMatchObject({
      height: 101,
      previousBlockHash: hash('a'),
      count: 1,
      observedAt: now,
      source: config.bitcoinPoolSource,
      weight: tx.weight,
      weightLimit: 4_000_000,
      transactions: [{ id: tx.txid, chain: 'bitcoin', status: 'pending', feeRate: 2, size: 60 }],
    });
    expect([...sample!.transactionIds]).toEqual([tx.txid]);
    expect(sample!.transactions[0]).not.toHaveProperty('blockHash');
    expect(JSON.stringify(sample)).not.toContain(tx.data);
    expect(f.methods).toEqual(['getblockchaininfo', 'getblocktemplate']);
    expect(f.reader.state()).toEqual({
      pending: false,
      nextAttemptAt: now + BITCOIN_TEMPLATE_REFRESH_MS,
      failure: null,
    });
  });

  it('ranks all candidate members by their own fee before limiting individual details and keeps zero-fee members private', async () => {
    const f = fixture();
    const count = PENDING_SAMPLE_LIMIT + 140;
    const transactions = Array.from({ length: count }, (_, index) => transaction(index + 1, index));
    f.setTemplate(f.validTemplate(transactions));
    const sample = await collected(f.reader);
    expect(sample?.count).toBe(count);
    expect(sample?.transactionIds.size).toBe(count);
    expect(sample?.transactionIds.has(transactions[0]!.txid)).toBe(true);
    expect(sample?.transactions).toHaveLength(PENDING_SAMPLE_LIMIT);
    expect(sample?.transactions[0]?.id).toBe(transactions.at(-1)!.txid);
    expect(sample?.transactions.at(-1)?.id).toBe(transactions[140]!.txid);
    expect(
      sample?.transactions.every((tx) => tx.status === 'pending' && tx.blockHash === undefined),
    ).toBe(true);
  });

  it('reports the median of all candidate fees rather than only the limited strongest details', async () => {
    const f = fixture();
    const count = PENDING_SAMPLE_LIMIT + 40;
    const transactions = Array.from({ length: count }, (_, index) => transaction(index + 1, index));
    f.setTemplate(f.validTemplate(transactions));
    const sample = await collected(f.reader);
    expect(sample?.count).toBe(count);
    expect(sample?.transactions).toHaveLength(PENDING_SAMPLE_LIMIT);
    expect(sample?.weight).toBe(transactions.reduce((total, tx) => total + tx.weight, 0));
    expect(sample?.medianFeeSats).toBe((count - 1) / 2);
    const feesById = new Map(transactions.map((tx) => [tx.txid, tx.fee]));
    const shownFees = sample!.transactions.map((tx) => feesById.get(tx.id)!).sort((a, b) => a - b);
    const shownMedian =
      (shownFees[PENDING_SAMPLE_LIMIT / 2 - 1]! + shownFees[PENDING_SAMPLE_LIMIT / 2]!) / 2;
    expect(shownMedian).toBe(40 + (PENDING_SAMPLE_LIMIT - 1) / 2);
    expect(sample?.medianFeeSats).not.toBe(shownMedian);
    expect(sample?.transactionIds.size).toBe(count);
  });

  it.each([
    { fees: [0], median: 0 },
    { fees: [0, 0], median: 0 },
    { fees: [100, 101], median: 100.5 },
    { fees: [20, 0, 10], median: 10 },
    { fees: [2_100_000_000_000_000, 2_099_999_999_999_999], median: 2_099_999_999_999_999.5 },
  ])('keeps full fee median exact for $fees', async ({ fees, median }) => {
    const f = fixture();
    f.setTemplate(
      f.validTemplate(
        fees.map((fee, index) => {
          const tx = transaction(index + 1, fee);
          if (fee < 1_000_000_000_000) return tx;
          // Keep extreme valid integer fees while staying inside the shared display-rate
          // conversion guard: enlarge the input script, not the public numeric bounds.
          const data = `${tx.data.slice(0, 82)}f0${'00'.repeat(240)}${tx.data.slice(84)}`;
          return {
            ...tx,
            data,
            txid: witnessHash(data),
            hash: witnessHash(data),
            weight: data.length * 2,
          };
        }),
      ),
    );
    expect((await collected(f.reader))?.medianFeeSats).toBe(median);
  });

  it('allows an empty node candidate without inventing transactions or pool counts', async () => {
    const f = fixture();
    f.setTemplate(f.validTemplate([]));
    const sample = await collected(f.reader);
    expect(sample).toMatchObject({ count: 0, weight: 0, medianFeeSats: null, transactions: [] });
    expect(sample?.transactionIds.size).toBe(0);
    expect(sample).not.toHaveProperty('pendingCount');
  });

  it('validates declared earlier dependencies before the display-only fee ranking', async () => {
    const f = fixture();
    const parent = transaction(1, 1);
    const child = { ...transaction(2, 100), depends: [1] };
    f.setTemplate(f.validTemplate([parent, child]));
    const sample = await collected(f.reader);
    expect(sample?.transactions.map((tx) => tx.id)).toEqual([child.txid, parent.txid]);
  });

  it('accepts repeated earlier parent indices emitted by Core for multiple inputs', async () => {
    const f = fixture();
    const parent = transaction(1, 1);
    const child = { ...transaction(2, 100), depends: [1, 1] };
    f.setTemplate(f.validTemplate([parent, child]));
    const sample = await collected(f.reader);
    expect(f.reader.state().failure).toBeNull();
    expect(sample?.transactionIds).toEqual(new Set([parent.txid, child.txid]));
    expect(sample?.transactions.map((tx) => tx.id)).toEqual([child.txid, parent.txid]);
  });

  it.each(['test', 'signet', 'regtest'])(
    'rejects the wrong chain %s without requesting a template',
    async (chain) => {
      const f = fixture();
      f.setChain({ ...f.validChain, chain });
      expect(await collected(f.reader)).toBeNull();
      expect(f.reader.state().failure).toBe('wrong-chain');
      expect(f.methods).toEqual(['getblockchaininfo']);
    },
  );

  it('rejects an unsynchronized node without requesting a template', async () => {
    const f = fixture();
    f.setChain({ ...f.validChain, initialblockdownload: true });
    expect(await collected(f.reader)).toBeNull();
    expect(f.reader.state().failure).toBe('not-ready');
    expect(f.methods).toEqual(['getblockchaininfo']);
  });

  it.each([
    ['wrong-height', { height: 102 }],
    ['wrong-parent', { previousblockhash: hash('b') }],
    ['weight-limit', { weightlimit: 4_000_001 }],
    ['malformed-parent', { previousblockhash: 'untrusted' }],
  ])('rejects template metadata %s', async (_kind, override) => {
    const f = fixture();
    f.setTemplate({ ...f.validTemplate(), ...override });
    expect(await collected(f.reader)).toBeNull();
    expect(f.reader.state().failure).toBe('invalid');
  });

  it.each([
    'duplicate-id',
    'duplicate-witness-id',
    'data-hash',
    'nonhex-data',
    'odd-data',
    'negative-fee',
    'fractional-fee',
    'zero-weight',
    'impossible-low-weight',
    'impossible-high-weight',
    'future-dependency',
    'self-dependency',
    'zero-dependency',
    'aggregate-weight',
    'too-many-transactions',
  ])('rejects the complete candidate for %s, without exposing a partial top', async (kind) => {
    const f = fixture();
    const first = transaction(1);
    const second = transaction(2);
    let transactions = [first, second];
    if (kind === 'duplicate-id') transactions[1] = { ...second, txid: first.txid.toUpperCase() };
    if (kind === 'duplicate-witness-id') transactions[1] = { ...second, hash: first.hash };
    if (kind === 'data-hash') transactions[1] = { ...second, hash: hash('f') };
    if (kind === 'nonhex-data')
      transactions[1] = { ...second, data: `${second.data.slice(0, -2)}zz` };
    if (kind === 'odd-data') transactions[1] = { ...second, data: second.data + 'a' };
    if (kind === 'negative-fee') transactions[1] = { ...second, fee: -1 };
    if (kind === 'fractional-fee') transactions[1] = { ...second, fee: 0.5 };
    if (kind === 'zero-weight') transactions[1] = { ...second, weight: 0 };
    if (kind === 'impossible-low-weight') transactions[1] = { ...second, weight: 1 };
    if (kind === 'impossible-high-weight')
      transactions[1] = { ...second, weight: second.weight + 1 };
    if (kind === 'future-dependency') transactions[0] = { ...first, depends: [2] };
    if (kind === 'self-dependency') transactions[0] = { ...first, depends: [1] };
    if (kind === 'zero-dependency') transactions[1] = { ...second, depends: [0] };
    if (kind === 'aggregate-weight') {
      f.setTemplate({ ...f.validTemplate(transactions), weightlimit: first.weight });
    } else {
      if (kind === 'too-many-transactions')
        transactions = Array(BITCOIN_TEMPLATE_MAX_TRANSACTIONS + 1).fill(first);
      f.setTemplate(f.validTemplate(transactions));
    }
    expect(await collected(f.reader)).toBeNull();
    expect(f.reader.state().failure).toBe('invalid');
  });

  it('shares one in-flight collection and refreshes only fifteen seconds after completion', async () => {
    const f = fixture();
    let complete!: (result: unknown) => void;
    f.setHandler((method) =>
      method === 'getblockchaininfo'
        ? f.validChain
        : new Promise((resolve) => {
            complete = resolve;
          }),
    );
    f.reader();
    f.reader();
    f.reader();
    await vi.waitFor(() => expect(f.methods).toEqual(['getblockchaininfo', 'getblocktemplate']));
    expect(f.reader.state().pending).toBe(true);
    f.advance(2_000);
    complete(f.validTemplate());
    await finishBackground();
    expect(f.reader.state().nextAttemptAt).toBe(now + 2_000 + BITCOIN_TEMPLATE_REFRESH_MS);
    f.advance(BITCOIN_TEMPLATE_REFRESH_MS - 1);
    expect(f.reader()).not.toBeNull();
    expect(f.methods).toHaveLength(2);
    f.advance(1);
    f.reader();
    await vi.waitFor(() => expect(f.methods).toHaveLength(4));
    expect(f.reader.state().pending).toBe(true);
    complete(f.validTemplate());
    await finishBackground();
    expect(f.reader.state().pending).toBe(false);
  });

  it('expires a previous candidate after thirty seconds and invalidates it on refresh failure', async () => {
    const f = fixture();
    expect(await collected(f.reader)).not.toBeNull();
    f.setError({ code: -32601, message: 'upstream secret must not escape' });
    f.advance(BITCOIN_TEMPLATE_MAX_AGE_MS + 1);
    expect(f.reader()).toBeNull();
    await finishBackground();
    expect(f.reader()).toBeNull();
    expect(f.reader.state().failure).toBe('rpc');
    expect(JSON.stringify(f.reader.state())).not.toContain('secret');
    const calls = f.methods.length;
    f.advance(BITCOIN_TEMPLATE_REFRESH_MS - 1);
    f.reader();
    expect(f.methods).toHaveLength(calls);
  });

  it('rejects mismatched RPC IDs and an oversized template response', async () => {
    const wrongId = fixture();
    wrongId.setIdOffset(1);
    expect(await collected(wrongId.reader)).toBeNull();
    expect(wrongId.reader.state().failure).toBe('invalid');
    const oversized = fixture();
    oversized.setHandler((method) =>
      method === 'getblockchaininfo'
        ? oversized.validChain
        : new Response('{}', {
            headers: { 'content-length': String(BITCOIN_TEMPLATE_MAX_BYTES + 1) },
          }),
    );
    expect(await collected(oversized.reader)).toBeNull();
    expect(oversized.reader.state().failure).toBe('too-large');
  });

  it('rejects oversized streamed bytes even when content-length is absent', async () => {
    const f = fixture();
    f.setHandler((method) =>
      method === 'getblockchaininfo'
        ? f.validChain
        : new Response(
            new ReadableStream({
              start(controller) {
                const bytes = new Uint8Array(1_024 * 1_024);
                for (let chunk = 0; chunk < 17; chunk += 1) controller.enqueue(bytes);
                controller.close();
              },
            }),
          ),
    );
    expect(await collected(f.reader)).toBeNull();
    expect(f.reader.state().failure).toBe('too-large');
  });

  it('uses a single eight-second budget across chain verification and template collection', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const fetcher = vi.fn<Fetcher>(async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { id: number; method: string };
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () =>
            resolve(
              Response.json({
                jsonrpc: '2.0',
                id: request.id,
                result:
                  request.method === 'getblockchaininfo'
                    ? {
                        chain: 'main',
                        blocks: 100,
                        bestblockhash: hash('a'),
                        initialblockdownload: false,
                      }
                    : {
                        height: 101,
                        previousblockhash: hash('a'),
                        weightlimit: 4_000_000,
                        transactions: [],
                      },
              }),
            ),
          request.method === 'getblockchaininfo' ? 6_000 : 3_000,
        );
        init?.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(new Error('aborted fixture'));
          },
          { once: true },
        );
      });
    });
    const reader = createBitcoinTemplateReader(config, fetcher, Date.now);
    reader();
    await finishBackground();
    await vi.advanceTimersByTimeAsync(8_001);
    expect(reader.state().pending).toBe(false);
    expect(reader.state().failure).toBe('timeout');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('disables the optional reader when no Bitcoin RPC is configured', async () => {
    const fetcher = vi.fn<Fetcher>();
    const reader = createBitcoinTemplateReader(
      { ...config, bitcoinRpcUrl: undefined },
      fetcher,
      () => now,
    );
    expect(reader()).toBeNull();
    await finishBackground();
    expect(fetcher).not.toHaveBeenCalled();
    expect(reader.state()).toEqual({ pending: false, nextAttemptAt: 0, failure: 'disabled' });
  });

  it('keeps separate reader instances and rejects a backwards clock', async () => {
    const f = fixture();
    const first = await collected(f.reader);
    const separate = createBitcoinTemplateReader(config, f.fetcher, () => now);
    expect(separate()).toBeNull();
    expect(separate.state().pending).toBe(true);
    await finishBackground();
    expect(separate()?.transactionIds).not.toBe(first?.transactionIds);
    f.advance(-1);
    expect(f.reader()).toBeNull();
  });
});
