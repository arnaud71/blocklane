import { describe, expect, it, vi } from 'vitest';
import { createEthereumProvider } from '../../server/adapters/ethereum.js';
import {
  ERC20_TRANSFER_TOPIC,
  ethereumTokenCall,
  parseEthereumTokenTransfers,
} from '../../server/adapters/ethereumTokens.js';
import type { Fetcher } from '../../server/network.js';
import { CONFIRMED_SAMPLE_LIMIT } from '../../shared/model.js';
import { MAX_TOKEN_TRANSFER_EVENTS, TOKEN_CONTRACTS } from '../../shared/tokenContracts.js';
import { config, ethBlock, ethTx, now, quantity } from './fixtures.js';

const id = (index: number) => `0x${index.toString(16).padStart(64, '0')}`;
const blockHash = (height: number) => id(1_000_000 + height);
const address = (index = 1) => `0x${index.toString(16).padStart(40, '0')}`;
const word = (value: bigint | number) => BigInt(value).toString(16).padStart(64, '0');
const addressArgument = address().slice(2).padStart(64, '0');
const call = (selector = 'a9059cbb', amount = 123_456_789n) =>
  `0x${selector}${addressArgument}${selector === '23b872dd' ? addressArgument : ''}${word(amount)}`;
const transaction = (index: number, overrides: Record<string, unknown> = {}) => ({
  ...ethTx,
  hash: id(index),
  from: address(),
  nonce: quantity(index),
  ...overrides,
});
const completeBlock = {
  hash: blockHash(100),
  height: 100,
  transactionIds: [id(1), id(2)],
};
const transferLog = (overrides: Record<string, unknown> = {}) => ({
  address: TOKEN_CONTRACTS.usdt.address,
  topics: [ERC20_TRANSFER_TOPIC, `0x${addressArgument}`, `0x${addressArgument}`],
  data: `0x${word(123_456_789n)}`,
  blockHash: blockHash(100),
  blockNumber: quantity(100),
  transactionHash: id(1),
  transactionIndex: '0x0',
  logIndex: '0x0',
  removed: false,
  ...overrides,
});

function fixture() {
  let time = now;
  let height = 100;
  let headHash = blockHash(height);
  let latestTransactions = [transaction(1)];
  let pendingTransactions: ReturnType<typeof transaction>[] = [];
  let poolTransactions: ReturnType<typeof transaction>[] | null = null;
  let logResponse: (signal?: AbortSignal | null) => unknown | Promise<unknown> = () => [];
  const requests: { method: string; params: unknown[] }[] = [];
  const block = (number: number) => ({
    ...ethBlock,
    hash: number === height ? headHash : blockHash(number),
    parentHash: blockHash(number - 1),
    number: quantity(number),
    transactions: number === height ? latestTransactions : [],
  });
  const fetcher = vi.fn<Fetcher>(async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params: unknown[];
    };
    requests.push(request);
    let result: unknown;
    if (request.method === 'eth_chainId') result = '0x1';
    else if (request.method === 'eth_getBlockByNumber') {
      const tag = String(request.params[0]);
      result =
        tag === 'pending'
          ? {
              ...block(height + 1),
              hash: null,
              parentHash: headHash,
              transactions: pendingTransactions,
            }
          : block(tag === 'latest' ? height : Number(BigInt(tag)));
    } else if (request.method === 'eth_getLogs') result = await logResponse(init?.signal);
    else if (request.method === 'txpool_content' && poolTransactions !== null) {
      const nonces = Object.fromEntries(
        poolTransactions.map((tx) => [String(BigInt(tx.nonce)), tx]),
      );
      result = { pending: { [address()]: nonces }, queued: {} };
    } else if (request.method === 'eth_getTransactionReceipt') result = null;
    else
      return Response.json({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32601, message: 'Optional fixture method unavailable' },
      });
    return Response.json({ jsonrpc: '2.0', id: request.id, result });
  });
  return {
    provider: createEthereumProvider(config, fetcher, () => time),
    requests,
    setLogs: (value: unknown) => {
      logResponse = () => value;
    },
    failLogs: () => {
      logResponse = () => {
        throw new Error('Private provider failure');
      };
    },
    holdLogs: () => {
      let release!: (value: unknown) => void;
      const waiting = new Promise<unknown>((resolve) => {
        release = resolve;
      });
      logResponse = () => waiting;
      return release;
    },
    timeoutLogs: () => {
      logResponse = (signal) =>
        new Promise<unknown>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('Fixture timeout')), {
            once: true,
          });
        });
    },
    setLatest: (value: ReturnType<typeof transaction>[]) => {
      latestTransactions = value;
    },
    setPending: (value: ReturnType<typeof transaction>[]) => {
      pendingTransactions = value;
    },
    setPool: (value: ReturnType<typeof transaction>[]) => {
      poolTransactions = value;
    },
    setHead: (nextHeight: number, hash = blockHash(nextHeight)) => {
      height = nextHeight;
      headHash = hash;
    },
    advance: (milliseconds: number) => {
      time += milliseconds;
    },
  };
}

async function finishBackground() {
  for (let turn = 0; turn < 180; turn += 1) await Promise.resolve();
}

async function collectLogs(f: ReturnType<typeof fixture>) {
  await f.provider();
  await finishBackground();
  return f.provider();
}

const tokenCall = (input: string, to: string | null = TOKEN_CONTRACTS.usdt.address) =>
  ethereumTokenCall({ to, input });

describe('Reviewed USDT call identification', () => {
  it.each([
    ['a9059cbb', 'transfer'],
    ['23b872dd', 'transfer'],
    ['095ea7b3', 'approval'],
  ])('decodes validated %s calldata as requested %s base units', (selector, operation) => {
    expect(tokenCall(call(selector))).toEqual([
      { tokenId: 'usdt', operation, evidence: 'call', amount: '123456789' },
    ]);
    expect(tokenCall(call(selector, (1n << 256n) - 1n))?.[0]?.amount).toBe(
      ((1n << 256n) - 1n).toString(),
    );
  });

  it('uses the exact reviewed contract address, including case-insensitive hex', () => {
    expect(
      tokenCall(call(), TOKEN_CONTRACTS.usdt.address.toUpperCase().replace('0X', '0x')),
    ).toEqual(tokenCall(call()));
    for (const to of [null, address(), '0x0000000000000000000000000000000000000000'])
      expect(tokenCall(call(), to)).toBeUndefined();
    expect(tokenCall(`0x${'f'.repeat(8)}`)).toEqual([
      { tokenId: 'usdt', operation: 'interaction', evidence: 'call' },
    ]);
  });

  it.each([
    '0x',
    '0xa9059cbb',
    `${call()}00`,
    call().slice(0, -2),
    `0xa9059cbb${'1'.repeat(24)}${address().slice(2)}${word(1)}`,
    `0x23b872dd${addressArgument}${'1'.repeat(64)}${word(1)}`,
    `0x095ea7b3${addressArgument}${'z'.repeat(64)}`,
  ])('retains malformed direct calls as interaction without inventing a transfer: %s', (input) => {
    expect(tokenCall(input)).toEqual([
      { tokenId: 'usdt', operation: 'interaction', evidence: 'call' },
    ]);
  });

  it('preserves classification through private txpool input compaction and pending fallback', async () => {
    const f = fixture();
    const pending = [transaction(2, { to: TOKEN_CONTRACTS.usdt.address, input: call('095ea7b3') })];
    f.setPending(pending);
    f.setPool(pending);
    const first = await f.provider();
    expect(first.transactions.find((tx) => tx.id === id(2))?.tokens).toEqual([
      { tokenId: 'usdt', operation: 'approval', evidence: 'call', amount: '123456789' },
    ]);
    await finishBackground();
    const pooled = await f.provider();
    expect(pooled.sampling?.method).toBe('txpool_content');
    expect(pooled.transactions.find((tx) => tx.id === id(2))?.tokens).toEqual(
      first.transactions.find((tx) => tx.id === id(2))?.tokens,
    );
    expect(JSON.stringify(pooled)).not.toContain(call());
    expect(JSON.stringify(pooled)).not.toContain(call('095ea7b3'));
  });

  it('does not trust provider-supplied token metadata for an unrelated address', async () => {
    const f = fixture();
    const fakeToken = {
      tokenId: 'usdt',
      operation: 'transfer',
      evidence: 'call',
      amount: '999999999',
    };
    f.setLatest([transaction(1, { tokens: [fakeToken] })]);
    f.setPending([transaction(2, { tokens: [fakeToken] })]);
    f.setPool([transaction(2, { tokens: [fakeToken] })]);
    const snapshot = await collectLogs(f);
    expect(snapshot.transactions).toHaveLength(2);
    expect(snapshot.transactions.every((tx) => tx.tokens === undefined)).toBe(true);
  });

  it('identifies an empty direct contract call as an interaction, without an amount', async () => {
    const f = fixture();
    f.setLatest([transaction(1, { to: TOKEN_CONTRACTS.usdt.address })]);
    expect((await f.provider()).transactions[0]).toMatchObject({
      kind: 'contract',
      tokens: [{ tokenId: 'usdt', operation: 'interaction', evidence: 'call' }],
    });
  });
});

describe('Complete bounded USDT Transfer validation', () => {
  it('counts distinct outer transactions separately from events and sums exact base units', () => {
    const parsed = parseEthereumTokenTransfers(
      [
        transferLog({ data: `0x${word((1n << 256n) - 1n)}` }),
        transferLog({ logIndex: '0x1', data: `0x${word((1n << 256n) - 1n)}` }),
        transferLog({ transactionHash: id(2), transactionIndex: '0x1', logIndex: '0x2' }),
      ],
      completeBlock,
      config.ethereumSource,
      now,
    );
    expect(parsed.report).toMatchObject({
      transactionCount: 2,
      transferCount: 3,
      amount: (((1n << 256n) - 1n) * 2n + 123_456_789n).toString(),
      observedAt: now,
      method: 'eth_getLogs',
    });
    expect(parsed.byTransaction.get(id(1))).toEqual({
      tokenId: 'usdt',
      operation: 'transfer',
      evidence: 'log',
      amount: (((1n << 256n) - 1n) * 2n).toString(),
      transferCount: 2,
      observedAt: now,
    });
  });

  it.each([
    { address: address() },
    { topics: [] },
    { topics: [id(1), `0x${addressArgument}`, `0x${addressArgument}`] },
    { topics: [ERC20_TRANSFER_TOPIC, `0x${'1'.repeat(64)}`, `0x${addressArgument}`] },
    { topics: [ERC20_TRANSFER_TOPIC, `0x${addressArgument}`, `0x${'1'.repeat(64)}`] },
    { topics: [ERC20_TRANSFER_TOPIC, `0x${addressArgument}`, `0x${addressArgument}`, id(2)] },
    { data: '0x1' },
    { data: `0x${'f'.repeat(65)}` },
    { removed: true },
    { removed: undefined },
    { blockHash: blockHash(99) },
    { blockNumber: quantity(99) },
    { transactionHash: id(3) },
    { transactionIndex: '0x1' },
    { transactionIndex: quantity(1n << 255n) },
    { logIndex: '0x00' },
  ])('rejects the entire response when a later log is invalid: %j', (overrides) => {
    expect(() =>
      parseEthereumTokenTransfers(
        [transferLog(), transferLog({ logIndex: '0x1', ...overrides })],
        completeBlock,
        config.ethereumSource,
        now,
      ),
    ).toThrow();
  });

  it('rejects duplicate log indexes, partial/non-array payloads and oversized responses', () => {
    for (const logs of [
      [transferLog(), transferLog()],
      null,
      { logs: [transferLog()] },
      Array.from({ length: MAX_TOKEN_TRANSFER_EVENTS + 1 }, () => transferLog()),
    ])
      expect(() =>
        parseEthereumTokenTransfers(logs, completeBlock, config.ethereumSource, now),
      ).toThrow();
  });

  it('accepts the full event bound, zero-amount events, and a fully validated empty response', () => {
    const parsed = parseEthereumTokenTransfers(
      Array.from({ length: MAX_TOKEN_TRANSFER_EVENTS }, (_, index) =>
        transferLog({ logIndex: quantity(index), data: `0x${word(0)}` }),
      ),
      completeBlock,
      config.ethereumSource,
      now,
    );
    expect(parsed.report).toMatchObject({ transactionCount: 1, transferCount: 4096, amount: '0' });
    expect(
      parseEthereumTokenTransfers([], completeBlock, config.ethereumSource, now).report,
    ).toMatchObject({ transactionCount: 0, transferCount: 0, amount: '0' });
  });
});

describe('Optional per-head USDT log collection', () => {
  it('queries a fixed blockHash/address/topic once, preserving the original observation date', async () => {
    const f = fixture();
    f.setLatest([transaction(1, { to: TOKEN_CONTRACTS.usdt.address, input: call('095ea7b3') })]);
    f.setLogs([transferLog()]);
    const snapshot = await collectLogs(f);
    expect(snapshot.tokenTransfers).toEqual([
      {
        tokenId: 'usdt',
        blockHash: blockHash(100),
        blockHeight: 100,
        source: config.ethereumSource,
        observedAt: now,
        method: 'eth_getLogs',
        transactionCount: 1,
        transferCount: 1,
        amount: '123456789',
      },
    ]);
    expect(snapshot.transactions[0]?.tokens).toEqual([
      {
        tokenId: 'usdt',
        operation: 'transfer',
        evidence: 'log',
        amount: '123456789',
        transferCount: 1,
        observedAt: now,
      },
    ]);
    f.advance(90_000);
    const again = await f.provider();
    expect(again.tokenTransfers).toEqual(snapshot.tokenTransfers);
    expect(f.requests.filter((request) => request.method === 'eth_getLogs')).toEqual([
      {
        jsonrpc: '2.0',
        method: 'eth_getLogs',
        params: [
          {
            blockHash: blockHash(100),
            address: TOKEN_CONTRACTS.usdt.address,
            topics: [ERC20_TRANSFER_TOPIC],
          },
        ],
        id: expect.any(Number),
      },
    ]);
  });

  it('reports all validated events beyond the passenger sample without creating extra transactions', async () => {
    const f = fixture();
    f.setLatest(
      Array.from({ length: CONFIRMED_SAMPLE_LIMIT + 2 }, (_, index) => transaction(index + 1)),
    );
    f.setLogs([
      transferLog({ transactionHash: id(26), transactionIndex: quantity(25) }),
      transferLog({ transactionHash: id(26), transactionIndex: quantity(25), logIndex: '0x1' }),
    ]);
    const snapshot = await collectLogs(f);
    expect(snapshot.transactions).toHaveLength(CONFIRMED_SAMPLE_LIMIT);
    expect(snapshot.transactions.some((tx) => tx.id === id(26))).toBe(false);
    expect(snapshot.transactions.every((tx) => tx.tokens === undefined)).toBe(true);
    expect(snapshot.tokenTransfers?.[0]).toMatchObject({
      transactionCount: 1,
      transferCount: 2,
      amount: '246913578',
    });
  });

  it('keeps failed or invalid logs unavailable and retries only after the cooldown', async () => {
    const f = fixture();
    f.failLogs();
    expect((await collectLogs(f)).tokenTransfers).toBeNull();
    f.setLogs([transferLog({ removed: true })]);
    f.advance(29_999);
    expect((await f.provider()).tokenTransfers).toBeNull();
    expect(f.requests.filter((request) => request.method === 'eth_getLogs')).toHaveLength(1);
    f.advance(1);
    expect((await collectLogs(f)).tokenTransfers).toBeNull();
    expect(f.requests.filter((request) => request.method === 'eth_getLogs')).toHaveLength(2);
    f.setLogs([]);
    f.advance(30_000);
    const recovered = await collectLogs(f);
    expect(recovered.status).toBe('ok');
    expect(recovered.tokenTransfers?.[0]).toMatchObject({ transferCount: 0, amount: '0' });
  });

  it('keeps timeout and oversized transport failures independent of core chain data', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      f.timeoutLogs();
      expect((await f.provider()).status).toBe('ok');
      await vi.advanceTimersByTimeAsync(8_000);
      expect((await f.provider()).tokenTransfers).toBeNull();
      expect(f.requests.filter((request) => request.method === 'eth_getLogs')).toHaveLength(1);
      f.setLogs('x'.repeat(2 * 1024 * 1024));
      f.advance(30_000);
      expect((await collectLogs(f)).tokenTransfers).toBeNull();
      f.setLogs([]);
      f.advance(30_000);
      expect((await collectLogs(f)).tokenTransfers?.[0]).toMatchObject({ transferCount: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not delay core chain data and ignores an in-flight result after a head change', async () => {
    const f = fixture();
    const release = f.holdLogs();
    const first = await f.provider();
    expect(first.status).toBe('ok');
    expect(first.tokenTransfers).toBeNull();
    f.setHead(101);
    f.advance(1);
    expect((await f.provider()).tokenTransfers).toBeNull();
    expect(f.requests.filter((request) => request.method === 'eth_getLogs')).toHaveLength(1);
    release([transferLog()]);
    await finishBackground();
    f.setLogs([]);
    const second = await collectLogs(f);
    expect(second.tokenTransfers?.[0]).toMatchObject({
      blockHash: blockHash(101),
      blockHeight: 101,
      transferCount: 0,
    });
    expect(f.requests.filter((request) => request.method === 'eth_getLogs')).toHaveLength(2);
  });

  it('clears completed evidence on a same-height reorganization and on clock rollback', async () => {
    const f = fixture();
    f.setLogs([transferLog()]);
    expect((await collectLogs(f)).tokenTransfers?.[0]?.transferCount).toBe(1);
    f.setHead(100, id(900));
    f.setLogs([]);
    expect((await f.provider()).tokenTransfers).toBeNull();
    await finishBackground();
    expect((await f.provider()).tokenTransfers?.[0]).toMatchObject({
      blockHash: id(900),
      amount: '0',
    });
    f.advance(-1_000);
    expect((await f.provider()).tokenTransfers).toBeNull();
    await finishBackground();
    expect((await f.provider()).tokenTransfers?.[0]?.observedAt).toBe(now - 1_000);
    expect(f.requests.filter((request) => request.method === 'eth_getLogs')).toHaveLength(3);
  });

  it('ignores an in-flight observation whose clock moved backwards', async () => {
    const f = fixture();
    const release = f.holdLogs();
    await f.provider();
    f.advance(-1_000);
    release([transferLog()]);
    await finishBackground();
    f.setLogs([]);
    expect((await f.provider()).tokenTransfers).toBeNull();
    await finishBackground();
    const retried = await f.provider();
    expect(retried.tokenTransfers?.[0]).toMatchObject({
      amount: '0',
      observedAt: now - 1_000,
    });
    expect(f.requests.filter((request) => request.method === 'eth_getLogs')).toHaveLength(2);
  });
});
