import { describe, expect, it, vi } from 'vitest';
import {
  createEthereumProvider,
  ethereumTransactionSchema,
  nextBaseFeeWei,
} from '../../server/adapters/ethereum.js';
import type { Fetcher } from '../../server/network.js';
import { MAX_TRACKED_TRANSACTIONS, PENDING_SAMPLE_LIMIT } from '../../shared/model.js';
import { config, ethTx, now, quantity } from './fixtures.js';

const txHash = (value: number) => `0x${value.toString(16).padStart(64, '0')}`;
const blockHash = (height: number) => txHash(1_000_000 + height);
const address = (index = 1) => `0x${index.toString(16).padStart(40, '0')}`;
const transaction = (index: number, overrides: Record<string, unknown> = {}) => ({
  ...ethTx,
  hash: txHash(index),
  from: address(),
  nonce: quantity(index),
  ...overrides,
});

function poolContent(
  pending: ReturnType<typeof transaction>[],
  queued: ReturnType<typeof transaction>[] = [],
) {
  const category = (transactions: ReturnType<typeof transaction>[]) => {
    const accounts: Record<string, Record<string, unknown>> = {};
    for (const tx of transactions) {
      const account = String(tx.from);
      const nonces = accounts[account] ?? {};
      nonces[BigInt(String(tx.nonce)).toString()] = tx;
      accounts[account] = nonces;
    }
    return accounts;
  };
  return { pending: category(pending), queued: category(queued) };
}

function fixture(parentOverrides: Record<string, unknown> = {}) {
  let time = now;
  let parentGasUsed = 30_000_000n;
  let pendingBlock: unknown = null;
  let content: unknown = poolContent([]);
  let poolAvailable = false;
  const requests: string[] = [];
  const block = (height: number) => ({
    hash: blockHash(height),
    parentHash: blockHash(height - 1),
    number: quantity(height),
    timestamp: quantity(Math.floor(time / 1_000)),
    gasUsed: quantity(height === 100 ? parentGasUsed : 0n),
    gasLimit: quantity(60_000_000),
    baseFeePerGas: quantity(40_000_000_000n),
    transactions: [],
    ...(height === 100 ? parentOverrides : {}),
  });
  const fetcher = vi.fn<Fetcher>(async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params: unknown[];
    };
    requests.push(request.method);
    let result: unknown;
    if (request.method === 'eth_chainId') result = '0x1';
    else if (request.method === 'txpool_status') {
      // This separately dated count deliberately differs from the content inventory.
      result = { pending: quantity(7), queued: quantity(3) };
    } else if (request.method === 'txpool_content' && poolAvailable) result = content;
    else if (request.method === 'eth_getTransactionReceipt') result = null;
    else if (request.method === 'eth_getBlockByNumber') {
      const tag = String(request.params[0]);
      result =
        tag === 'pending' ? pendingBlock : block(tag === 'latest' ? 100 : Number(BigInt(tag)));
    } else {
      return Response.json({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32601, message: 'Optional method unavailable in fixture' },
      });
    }
    return Response.json({ jsonrpc: '2.0', id: request.id, result });
  });
  return {
    provider: createEthereumProvider(config, fetcher, () => time),
    requests,
    setParentGasUsed: (value: bigint) => {
      parentGasUsed = value;
    },
    setPending: (
      transactions: ReturnType<typeof transaction>[],
      overrides: Record<string, unknown> = {},
    ) => {
      pendingBlock = {
        ...block(101),
        hash: null,
        parentHash: blockHash(100),
        baseFeePerGas: quantity(nextBaseFeeWei(40_000_000_000n, parentGasUsed, 60_000_000n)),
        transactions,
        ...overrides,
      };
    },
    setPool: (value: unknown) => {
      content = value;
      poolAvailable = true;
    },
    advance: (milliseconds: number) => {
      time += milliseconds;
    },
  };
}

async function finishBackground() {
  for (let turn = 0; turn < 150; turn += 1) await Promise.resolve();
}

async function collectPool(f: ReturnType<typeof fixture>) {
  await f.provider();
  await finishBackground();
  f.advance(1);
  return f.provider();
}

describe('Exact Ethereum next-block fee reference', () => {
  it.each([
    [40_000_000_000n, 30_000_000n, 60_000_000n, 40_000_000_000n],
    [40_000_000_000n, 60_000_000n, 60_000_000n, 45_000_000_000n],
    [40_000_000_000n, 0n, 60_000_000n, 35_000_000_000n],
    [1n, 30_000_001n, 60_000_000n, 2n],
    [1n, 0n, 60_000_000n, 1n],
    [0n, 60_000_000n, 60_000_000n, 1n],
    [101n, 11n, 21n, 102n],
  ])('computes %s wei with parent gas %s/%s as %s wei', (base, used, limit, expected) => {
    expect(nextBaseFeeWei(base, used, limit)).toBe(expected);
  });

  it('keeps the EIP-1559 divisions exact above the JavaScript safe integer range', () => {
    const base = (1n << 200n) + 123n;
    expect(nextBaseFeeWei(base, 31_000_001n, 60_000_000n)).toBe(
      base + (base * 1_000_001n) / 30_000_000n / 8n,
    );
    expect(nextBaseFeeWei(base, 28_999_999n, 60_000_000n)).toBe(
      base - (base * 1_000_001n) / 30_000_000n / 8n,
    );
  });

  it.each([
    [-1n, 0n, 60n],
    [1n, -1n, 60n],
    [1n, 61n, 60n],
    [1n, 0n, 1n],
  ])('rejects invalid parent arithmetic %s/%s/%s', (base, used, limit) => {
    expect(() => nextBaseFeeWei(base, used, limit)).toThrow();
  });

  it('prices an anchored candidate with the next reference while retaining the last observed base fee separately', async () => {
    const f = fixture();
    f.setParentGasUsed(0n);
    f.setPending([
      transaction(1, {
        maxFeePerGas: quantity(36_000_000_000n),
        maxPriorityFeePerGas: quantity(1_000_000_000n),
      }),
    ]);
    const snapshot = await f.provider();
    expect(snapshot.feeRate).toBe(40);
    expect(snapshot.ethereumProjection).toMatchObject({
      parentBlockHash: blockHash(100),
      height: 101,
      baseFeePerGasWei: '35000000000',
      source: 'pending',
      observedAt: now,
    });
    expect(snapshot.transactions).toMatchObject([
      {
        id: txHash(1),
        status: 'pending',
        feeRate: 36,
        size: 21_000,
        ethereum: {
          from: address(),
          nonce: '1',
          maxFeePerGasWei: '36000000000',
          maxPriorityFeePerGasWei: '1000000000',
        },
      },
    ]);
    expect(snapshot.inclusions?.flatMap((entry) => entry.transactionIds)).not.toContain(txHash(1));
  });

  it('does not announce a calculated projection when the confirmed parent omits its base fee', async () => {
    const f = fixture({ baseFeePerGas: undefined });
    f.setPending([transaction(1)]);
    const snapshot = await f.provider();
    expect(snapshot.status).toBe('ok');
    expect(snapshot.blocks[0]?.hash).toBe(blockHash(100));
    expect(snapshot.feeRate).toBeNull();
    expect(snapshot.ethereumProjection).toBeNull();
    expect(snapshot.transactions.filter((tx) => tx.status === 'pending')).toEqual([]);
    expect(snapshot.message).toContain('référence du prochain bloc indisponible');
    expect(snapshot.message).not.toContain('La projection utilise');
    expect(snapshot.message!.length).toBeLessThanOrEqual(700);
  });

  it.each([
    ['missing parent', { parentHash: undefined }],
    ['wrong parent', { parentHash: blockHash(99) }],
    ['unknown height', { number: null }],
    ['wrong height', { number: quantity(102) }],
    ['wrong base fee', { baseFeePerGas: quantity(39_000_000_000n) }],
  ])(
    'ignores a candidate with %s without invalidating the confirmed observation',
    async (_name, overrides) => {
      const f = fixture();
      f.setPending([transaction(2)], overrides);
      const snapshot = await f.provider();
      expect(snapshot.status).toBe('ok');
      expect(snapshot.transactions.filter((tx) => tx.status === 'pending')).toEqual([]);
      expect(snapshot.blocks[0]?.hash).toBe(blockHash(100));
      expect(snapshot.ethereumProjection).toMatchObject({
        source: 'calculated',
        baseFeePerGasWei: '40000000000',
      });
      expect(snapshot.message).toContain('Candidat pending non rattaché');
    },
  );

  it('preserves exact legacy price and a large nonce without conversion through Number', async () => {
    const f = fixture();
    const nonce = (1n << 200n) + 1n;
    f.setPending([
      transaction(3, {
        nonce: quantity(nonce),
        gasPrice: quantity(41_000_000_001n),
        maxFeePerGas: undefined,
        maxPriorityFeePerGas: undefined,
      }),
    ]);
    const snapshot = await f.provider();
    expect(snapshot.transactions[0]?.ethereum).toEqual({
      from: address(),
      nonce: nonce.toString(),
      gasPriceWei: '41000000001',
    });
    expect(ethereumTransactionSchema.safeParse(transaction(3, { nonce: '0x00' })).success).toBe(
      false,
    );
  });
});

describe('Observed Ethereum pool membership', () => {
  it('classifies tracked IDs from one complete inventory without making queued details or confirmations', async () => {
    const f = fixture();
    f.setPool(poolContent([transaction(1), transaction(2), transaction(3)]));
    await collectPool(f);
    f.setPool(poolContent([transaction(1), transaction(4)], [transaction(2)]));
    f.advance(30_001);
    const refresh = await f.provider();
    expect(refresh.poolObservation).toBeNull();
    await finishBackground();
    const snapshot = await f.provider();
    expect(snapshot.poolObservation).toEqual({
      source: config.ethereumSource,
      method: 'txpool_content',
      observedAt: snapshot.sampling?.observedAt,
      presentTransactionIds: [txHash(1), txHash(4)],
      queuedTransactionIds: [txHash(2)],
      absentTransactionIds: [txHash(3)],
    });
    expect(snapshot.transactions.map((tx) => tx.id)).toEqual([txHash(1), txHash(4)]);
    expect(snapshot.sampling).toMatchObject({ pendingCount: 2, queuedCount: 1 });
    expect(snapshot.pendingCount).toBe(10);
    expect(snapshot.mempool).toMatchObject({ pending: 7, queued: 3 });
    expect(snapshot.inclusions?.flatMap((entry) => entry.transactionIds)).toEqual([]);
  });

  it('filters against the next base fee in exact wei but still reports pending membership for a tracked ineligible ID', async () => {
    const f = fixture();
    const capped = transaction(5, {
      maxFeePerGas: quantity(44_000_000_000n),
      maxPriorityFeePerGas: quantity(2_000_000_000n),
    });
    f.setPool(poolContent([capped, transaction(6)]));
    await collectPool(f);
    f.setParentGasUsed(60_000_000n);
    const snapshot = await f.provider();
    expect(snapshot.ethereumProjection).toMatchObject({
      baseFeePerGasWei: '45000000000',
      source: 'calculated',
    });
    expect(snapshot.transactions.map((tx) => tx.id)).toEqual([txHash(6)]);
    expect(snapshot.poolObservation?.presentTransactionIds).toContain(txHash(5));
    expect(snapshot.poolObservation?.absentTransactionIds).not.toContain(txHash(5));
    expect(snapshot.sampling?.pendingCount).toBe(2);
    expect(snapshot.coverage).toContain('base fee calculée du prochain bloc');
  });

  it('keeps replacement identity metadata and reports only observed presence or absence', async () => {
    const f = fixture();
    const old = transaction(7, { nonce: quantity(5) });
    f.setPool(poolContent([old]));
    const first = await collectPool(f);
    f.setPool(
      poolContent([
        transaction(8, { nonce: quantity(5), maxPriorityFeePerGas: quantity(3_000_000_000n) }),
      ]),
    );
    f.advance(30_001);
    await f.provider();
    await finishBackground();
    const snapshot = await f.provider();
    expect(first.transactions[0]?.ethereum).toMatchObject({ from: address(), nonce: '5' });
    expect(snapshot.transactions[0]?.ethereum).toMatchObject({ from: address(), nonce: '5' });
    expect(snapshot.poolObservation).toMatchObject({
      presentTransactionIds: [txHash(8)],
      absentTransactionIds: [txHash(7)],
    });
    expect(snapshot.transactions[0]?.status).toBe('pending');
    expect(snapshot.inclusions?.flatMap((entry) => entry.transactionIds)).toEqual([]);
  });

  it('never emits membership claims from an invalid or unavailable full inventory', async () => {
    const f = fixture();
    f.setPending([transaction(9)]);
    f.setPool({
      pending: { [address()]: { '9': { ...transaction(9), nonce: quantity(10) } } },
      queued: {},
    });
    await collectPool(f);
    const snapshot = await f.provider();
    expect(snapshot.status).toBe('ok');
    expect(snapshot.transactions[0]?.id).toBe(txHash(9));
    expect(snapshot.sampling).toBeNull();
    expect(snapshot.poolObservation).toBeNull();
    expect(snapshot.message).toContain('txpool_content inexploitable');
  });

  it('bounds the three disjoint membership categories to the 4096 tracked IDs', async () => {
    const f = fixture();
    let latestSnapshot;
    for (let cohort = 0; cohort < 5; cohort += 1) {
      f.setPool(
        poolContent(
          Array.from({ length: PENDING_SAMPLE_LIMIT }, (_, index) =>
            transaction(cohort * PENDING_SAMPLE_LIMIT + index + 1, {
              from: address(cohort + 1),
              nonce: quantity(index),
            }),
          ),
        ),
      );
      if (cohort > 0) f.advance(30_001);
      latestSnapshot = await collectPool(f);
    }
    const inventory = latestSnapshot?.poolObservation;
    expect(inventory).not.toBeNull();
    const identifiers = [
      ...(inventory?.presentTransactionIds ?? []),
      ...(inventory?.queuedTransactionIds ?? []),
      ...(inventory?.absentTransactionIds ?? []),
    ];
    expect(identifiers).toHaveLength(MAX_TRACKED_TRANSACTIONS);
    expect(new Set(identifiers).size).toBe(MAX_TRACKED_TRANSACTIONS);
    expect(inventory?.presentTransactionIds).toHaveLength(PENDING_SAMPLE_LIMIT);
    expect(inventory?.absentTransactionIds).toHaveLength(
      MAX_TRACKED_TRANSACTIONS - PENDING_SAMPLE_LIMIT,
    );
    expect(latestSnapshot?.transactions).toHaveLength(PENDING_SAMPLE_LIMIT);
  });
});
