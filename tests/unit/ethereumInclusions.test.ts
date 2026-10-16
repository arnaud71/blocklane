import { describe, expect, it, vi } from 'vitest';
import { createEthereumProvider, nextBaseFeeWei } from '../../server/adapters/ethereum.js';
import type { Fetcher } from '../../server/network.js';
import { config, ethTx, now, quantity } from './fixtures.js';

const txHash = (id: number) => `0x${id.toString(16).padStart(64, '0')}`;
const blockHash = (height: number, branch = 0) => txHash(1_000_000 + branch * 10_000 + height);
const transaction = (id: number) => ({ ...ethTx, hash: txHash(id), nonce: quantity(id) });

function fixture() {
  let time = now;
  let head = 100;
  let branch = 0;
  let pending: number[] = [];
  const blockTransactions = new Map<number, number[]>();
  const receiptRequests: string[] = [];
  const headerRequests: number[] = [];
  let concurrentReceipts = 0;
  let maximumConcurrentReceipts = 0;
  let receiptRpcIdOffset = 0;
  let receipt: (id: string) => unknown | Promise<unknown> = () => null;
  let headerOverride: ((height: number) => unknown) | undefined;
  const block = (height: number, full: boolean) => ({
    hash: blockHash(height, branch),
    parentHash: blockHash(height - 1, branch),
    number: quantity(height),
    timestamp: quantity(Math.floor(time / 1_000)),
    gasUsed: quantity(21_000 * (blockTransactions.get(height)?.length ?? 0)),
    gasLimit: quantity(60_000_000),
    baseFeePerGas: quantity(40_000_000_000n),
    transactions: (blockTransactions.get(height) ?? []).map((id) =>
      full ? transaction(id) : txHash(id),
    ),
  });
  const fetcher = vi.fn<Fetcher>(async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params: unknown[];
    };
    let result: unknown;
    if (request.method === 'eth_chainId') result = '0x1';
    else if (request.method === 'eth_getTransactionReceipt') {
      const id = String(request.params[0]);
      receiptRequests.push(id);
      concurrentReceipts += 1;
      maximumConcurrentReceipts = Math.max(maximumConcurrentReceipts, concurrentReceipts);
      try {
        result = await receipt(id);
      } finally {
        concurrentReceipts -= 1;
      }
    } else if (request.method === 'eth_getBlockByNumber') {
      const tag = String(request.params[0]);
      if (tag === 'latest') result = block(head, true);
      else if (tag === 'pending') {
        const parent = block(head, false);
        result = {
          ...block(head + 1, true),
          hash: null,
          baseFeePerGas: quantity(
            nextBaseFeeWei(
              BigInt(parent.baseFeePerGas),
              BigInt(parent.gasUsed),
              BigInt(parent.gasLimit),
            ),
          ),
          transactions: pending.map(transaction),
        };
      } else {
        const height = Number(BigInt(tag));
        headerRequests.push(height);
        result = headerOverride?.(height) ?? block(height, false);
      }
    } else {
      return Response.json({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32601, message: 'Optional method unavailable in fixture' },
      });
    }
    return Response.json({
      jsonrpc: '2.0',
      id: request.id + (request.method === 'eth_getTransactionReceipt' ? receiptRpcIdOffset : 0),
      result,
    });
  });
  return {
    provider: createEthereumProvider(config, fetcher, () => time),
    fetcher,
    receiptRequests,
    headerRequests,
    setPending: (ids: number[]) => {
      pending = ids;
    },
    setHead: (height: number) => {
      head = height;
    },
    setBranch: (value: number) => {
      branch = value;
    },
    setBlock: (height: number, ids: number[]) => {
      blockTransactions.set(height, ids);
    },
    setReceipt: (value: typeof receipt) => {
      receipt = value;
    },
    setReceiptRpcIdOffset: (value: number) => {
      receiptRpcIdOffset = value;
    },
    setHeaderOverride: (value: typeof headerOverride) => {
      headerOverride = value;
    },
    advance: (milliseconds: number) => {
      time += milliseconds;
    },
    get maximumConcurrentReceipts() {
      return maximumConcurrentReceipts;
    },
    minedReceipt: (id: string, height: number, status = '0x1') => ({
      transactionHash: id,
      blockHash: blockHash(height, branch),
      blockNumber: quantity(height),
      status,
    }),
  };
}

async function finishBackground(): Promise<void> {
  // Response.json's bounded stream reader and the two workers finish through microtasks.
  for (let turn = 0; turn < 100; turn += 1) await Promise.resolve();
}

const proofIds = (snapshot: Awaited<ReturnType<ReturnType<typeof createEthereumProvider>>>) =>
  snapshot.inclusions?.flatMap((entry) => entry.transactionIds) ?? [];

describe('Ethereum recent inclusions and bounded receipt reconciliation', () => {
  it('recognizes candidates already mined in recent independently verified history', async () => {
    const f = fixture();
    f.setBlock(99, [1]);
    f.setPending([1, 2]);
    const snapshot = await f.provider();
    expect(
      snapshot.transactions.filter((tx) => tx.status === 'pending').map((tx) => tx.id),
    ).toEqual([txHash(2)]);
    expect(proofIds(snapshot)).toContain(txHash(1));
    expect(f.receiptRequests).toHaveLength(0);
  });

  it('filters a late candidate against cached block IDs before the pending ranking', async () => {
    const f = fixture();
    f.setBlock(99, [1]);
    await f.provider();
    f.setPending([1, 2]);
    f.advance(3_000);
    const snapshot = await f.provider();
    expect(
      snapshot.transactions.filter((tx) => tx.status === 'pending').map((tx) => tx.id),
    ).toEqual([txHash(2)]);
    expect(f.headerRequests.filter((height) => height === 99)).toHaveLength(1);
  });

  it('repairs an inclusion missed beyond catchup without awaiting the optional receipt', async () => {
    const f = fixture();
    f.setPending([1]);
    await f.provider();
    f.setBlock(102, [1]);
    f.setHead(120);
    f.setPending([]);
    let completeReceipt!: (value: unknown) => void;
    f.setReceipt(
      () =>
        new Promise((resolve) => {
          completeReceipt = resolve;
        }),
    );
    f.advance(240_000);
    const before = await f.provider();
    expect(proofIds(before)).not.toContain(txHash(1));
    await vi.waitFor(() => expect(f.receiptRequests).toEqual([txHash(1)]));
    completeReceipt(f.minedReceipt(txHash(1), 102));
    await finishBackground();
    f.advance(3_000);
    const repaired = await f.provider();
    expect(repaired.inclusions).toContainEqual(
      expect.objectContaining({
        block: expect.objectContaining({ height: 102, hash: blockHash(102) }),
        transactionIds: [txHash(1)],
      }),
    );
    expect(repaired.blocks[0]?.height).toBe(120);
    expect(repaired.inclusions?.length).toBeLessThanOrEqual(16);
  });

  it('also recognizes a reverted transaction as included', async () => {
    const f = fixture();
    f.setPending([1]);
    await f.provider();
    f.setPending([]);
    f.setBlock(80, [1]);
    f.setReceipt((id) => f.minedReceipt(id, 80, '0x0'));
    f.advance(3_000);
    await f.provider();
    await finishBackground();
    const repaired = await f.provider();
    expect(proofIds(repaired)).toContain(txHash(1));
  });

  it.each([
    'null',
    'error',
    'wrong-transaction',
    'wrong-hash',
    'future',
    'missing-id',
    'bad-height',
    'bad-payload',
    'wrong-rpc-id',
  ] as const)('never invents confirmation from %s', async (kind) => {
    const f = fixture();
    f.setPending([1]);
    await f.provider();
    f.setPending([]);
    f.setBlock(80, kind === 'missing-id' ? [] : [1]);
    f.setReceipt((id) => {
      if (kind === 'null') return null;
      if (kind === 'error') throw new Error('Fixture transport failure');
      if (kind === 'bad-payload') return { transactionHash: id };
      return {
        ...f.minedReceipt(id, kind === 'future' ? 101 : 80),
        ...(kind === 'wrong-transaction' ? { transactionHash: txHash(2) } : {}),
        ...(kind === 'wrong-hash' ? { blockHash: blockHash(81) } : {}),
      };
    });
    if (kind === 'bad-height')
      f.setHeaderOverride((height) => ({
        hash: blockHash(height),
        number: quantity(height + 1),
        timestamp: quantity(now / 1_000),
        gasUsed: quantity(21_000),
        gasLimit: quantity(60_000_000),
        transactions: [txHash(1)],
      }));
    if (kind === 'wrong-rpc-id') f.setReceiptRpcIdOffset(1);
    f.advance(3_000);
    await f.provider();
    await finishBackground();
    const snapshot = await f.provider();
    expect(proofIds(snapshot)).not.toContain(txHash(1));
    expect(f.receiptRequests).toHaveLength(1);
  });

  it('limits receipt work to sixteen IDs, two concurrent requests, and retries after a minute', async () => {
    const f = fixture();
    f.setPending(Array.from({ length: 20 }, (_, i) => i + 1));
    await f.provider();
    f.setPending([]);
    const completions: Array<() => void> = [];
    f.setReceipt(
      () =>
        new Promise((resolve) => {
          completions.push(() => resolve(null));
        }),
    );
    f.advance(3_000);
    await Promise.all([f.provider(), f.provider()]);
    await vi.waitFor(() => expect(f.receiptRequests).toHaveLength(2));
    expect(f.maximumConcurrentReceipts).toBe(2);
    for (let batch = 0; batch < 8; batch += 1) {
      completions.splice(0).forEach((complete) => complete());
      await finishBackground();
    }
    expect(f.receiptRequests).toHaveLength(16);
    f.advance(14_999);
    await f.provider();
    expect(f.receiptRequests).toHaveLength(16);
    f.setReceipt(() => null);
    f.advance(1);
    await f.provider();
    await finishBackground();
    expect(f.receiptRequests).toHaveLength(20);
    expect(f.receiptRequests.filter((id) => id === txHash(1))).toHaveLength(1);
    f.advance(60_000);
    await f.provider();
    await finishBackground();
    expect(f.receiptRequests.filter((id) => id === txHash(1))).toHaveLength(2);
  });

  it('checks never-attempted IDs before repeatedly unavailable older receipts', async () => {
    const f = fixture();
    f.setPending(Array.from({ length: 96 }, (_, i) => i + 1));
    await f.provider();
    f.setPending([]);
    for (let batch = 0; batch < 6; batch += 1) {
      // Even when old IDs are eligible for retry, the rest of the retained set gets a turn.
      f.advance(60_001);
      await f.provider();
      await finishBackground();
    }
    expect(f.receiptRequests).toHaveLength(96);
    expect(new Set(f.receiptRequests).size).toBe(96);
  });

  it('probes still-listed candidates only after thirty seconds', async () => {
    const f = fixture();
    f.setPending([1]);
    await f.provider();
    f.advance(29_999);
    await f.provider();
    expect(f.receiptRequests).toHaveLength(0);
    f.advance(1);
    await f.provider();
    await finishBackground();
    expect(f.receiptRequests).toEqual([txHash(1)]);
  });

  it('keeps a newly recovered old proof when sixteen newer empty heights exist', async () => {
    const f = fixture();
    f.setPending([1]);
    await f.provider();
    f.setPending([]);
    for (let height = 101; height <= 118; height += 1) {
      f.setHead(height);
      f.advance(3_000);
      await f.provider();
      await finishBackground();
    }
    f.setBlock(80, [1]);
    f.setReceipt((id) => f.minedReceipt(id, 80));
    f.advance(60_000);
    await f.provider();
    await finishBackground();
    const snapshot = await f.provider();
    expect(proofIds(snapshot)).toContain(txHash(1));
    expect(snapshot.inclusions?.length).toBeLessThanOrEqual(16);
    expect(snapshot.blocks[0]?.height).toBe(118);
  });

  it('reserves the current empty head alongside fifteen newly recovered historical blocks', async () => {
    const f = fixture();
    f.setPending(Array.from({ length: 16 }, (_, i) => i + 1));
    await f.provider();
    f.setPending([]);
    for (let id = 1; id <= 16; id += 1) f.setBlock(59 + id, [id]);
    f.setHead(120);
    f.setReceipt((id) => f.minedReceipt(id, 59 + Number(BigInt(id))));
    f.advance(240_000);
    await f.provider();
    await finishBackground();
    expect(f.receiptRequests).toHaveLength(16);
    const snapshot = await f.provider();
    expect(snapshot.inclusions).toHaveLength(16);
    expect(snapshot.inclusions).toContainEqual(
      expect.objectContaining({
        block: expect.objectContaining({ height: 120, hash: blockHash(120) }),
        transactionIds: [],
      }),
    );
    expect(snapshot.inclusions?.filter((entry) => entry.transactionIds.length > 0)).toHaveLength(
      15,
    );
    expect(snapshot.inclusions).toContainEqual(
      expect.objectContaining({
        block: expect.objectContaining({ height: 75, hash: blockHash(75) }),
        transactionIds: [txHash(16)],
      }),
    );
  });

  it('discards a receipt that completes after a branch change', async () => {
    const f = fixture();
    f.setPending([1]);
    await f.provider();
    f.setPending([]);
    f.setBlock(80, [1]);
    let finish!: (value: unknown) => void;
    f.setReceipt(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    f.advance(3_000);
    await f.provider();
    await vi.waitFor(() => expect(f.receiptRequests).toHaveLength(1));
    const oldReceipt = f.minedReceipt(txHash(1), 80);
    f.setBranch(1);
    f.advance(3_000);
    await f.provider();
    finish(oldReceipt);
    await finishBackground();
    const snapshot = await f.provider();
    expect(proofIds(snapshot)).not.toContain(txHash(1));
  });
});
