import { describe, expect, it, vi } from 'vitest';
import { createEthereumProvider } from '../../server/adapters/ethereum';
import type { Fetcher } from '../../server/network';
import { PENDING_SAMPLE_LIMIT, snapshotSchema } from '../../shared/model';
import { config, ethTx, now, quantity } from './fixtures';

const id = (index: number) => `0x${index.toString(16).padStart(64, '0')}`;
const address = (index: number) => `0x${index.toString(16).padStart(40, '0')}`;
const blockHash = (height: number, branch: number) => id(1_000_000 + branch * 1_000 + height);
function transaction(index: number, price = 100n) {
  return {
    ...ethTx,
    hash: id(index),
    from: address(index),
    nonce: '0x0',
    gasPrice: quantity(price * 1_000_000_000n),
    maxFeePerGas: undefined,
    maxPriorityFeePerGas: undefined,
  };
}
type RawTransaction = ReturnType<typeof transaction>;
function content(pending: RawTransaction[], queued: RawTransaction[] = []) {
  const category = (transactions: RawTransaction[]) =>
    Object.fromEntries(transactions.map((tx) => [tx.from, { '0': tx }]));
  return { pending: category(pending), queued: category(queued) };
}

/** Only existing adapter RPCs are available; all responses are local controlled fixtures. */
function fixture() {
  const state = {
    time: now,
    head: 100,
    branch: 0,
    pool: content([]) as unknown,
    poolGate: null as Promise<void> | null,
    poolRpcFailure: false,
    latestFailure: false,
    baseFee: 40_000_000_000n as bigint | null,
  };
  const mined = new Map<number, RawTransaction[]>();
  const requests: { method: string; params: unknown[] }[] = [];
  const block = (height: number, full: boolean) => ({
    hash: blockHash(height, state.branch),
    parentHash: blockHash(height - 1, state.branch),
    number: quantity(height),
    timestamp: quantity(Math.floor(state.time / 1_000)),
    gasUsed: quantity((mined.get(height)?.length ?? 0) * 21_000),
    gasLimit: quantity(60_000_000),
    ...(state.baseFee === null ? {} : { baseFeePerGas: quantity(state.baseFee) }),
    transactions: (mined.get(height) ?? []).map((tx) => (full ? tx : tx.hash)),
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
    else if (request.method === 'txpool_content') {
      await state.poolGate;
      if (state.poolRpcFailure)
        return Response.json({
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32601, message: 'Controlled pool refusal' },
        });
      result = state.pool;
    } else if (request.method === 'txpool_status')
      result = { pending: quantity(10_000), queued: quantity(1_000) };
    else if (request.method === 'eth_getTransactionReceipt') result = null;
    else if (request.method === 'eth_getBlockByNumber') {
      const tag = String(request.params[0]);
      if (tag === 'latest' && state.latestFailure) return new Response(null, { status: 503 });
      result =
        tag === 'pending'
          ? null
          : block(tag === 'latest' ? state.head : Number(BigInt(tag)), Boolean(request.params[1]));
    } else throw new Error(`Unexpected RPC: ${request.method}`);
    return Response.json({ jsonrpc: '2.0', id: request.id, result });
  });
  const provider = createEthereumProvider(config, fetcher, () => state.time);
  async function settle() {
    for (let turn = 0; turn < 160; turn += 1) await Promise.resolve();
  }
  async function collectPool(pending: RawTransaction[], queued: RawTransaction[] = []) {
    state.pool = content(pending, queued);
    await provider();
    await settle();
    return provider();
  }
  async function refresh(
    pending: RawTransaction[],
    queued: RawTransaction[] = [],
    elapsed = 30_000,
  ) {
    state.time += elapsed;
    return collectPool(pending, queued);
  }
  return { state, mined, requests, provider, settle, collectPool, refresh };
}

describe('Ethereum observed pool flow from existing complete inventories', () => {
  it('warms once from the pending/queued union and keeps its own date across repeated chain polls', async () => {
    const f = fixture();
    const first = await f.collectPool([transaction(1), transaction(2)], [transaction(3)]);
    expect(first.poolFlow).toEqual({
      source: config.ethereumSource,
      method: 'txpool_content',
      observedAt: now,
      inventoryCount: 3,
      state: 'warming',
      history: [],
    });
    f.state.time += 3_000;
    const repeated = await f.provider();
    expect(repeated.observedAt).toBe(now + 3_000);
    expect(repeated.poolFlow).toEqual(first.poolFlow);
    expect(f.requests.filter(({ method }) => method === 'txpool_content')).toHaveLength(1);
    expect(JSON.stringify(first.poolFlow)).not.toContain(transaction(1).hash);
    expect(snapshotSchema.safeParse(repeated).success).toBe(true);
  });

  it('does not call a pending/queued category change an inventory entry or disappearance', async () => {
    const f = fixture();
    await f.collectPool([transaction(1)], [transaction(2)]);
    const moved = await f.refresh([transaction(2)], [transaction(1)]);
    expect(moved.poolFlow?.history).toEqual([
      {
        fromObservedAt: now,
        observedAt: now + 30_000,
        previousCount: 2,
        currentCount: 2,
        enteredCount: 0,
        disappearedCount: 0,
        outsideSampleEnteredCount: 0,
      },
    ]);
  });

  it('counts exact changes and freezes the out-of-sample split while a normal new head changes the sample', async () => {
    const f = fixture();
    await f.collectPool([transaction(1)], [transaction(2)]);
    const result = await f.refresh([transaction(1), transaction(3)], [transaction(4)]);
    expect(result.poolFlow).toMatchObject({ state: 'ready', inventoryCount: 3 });
    expect(result.poolFlow?.history.at(-1)).toMatchObject({
      previousCount: 2,
      currentCount: 3,
      enteredCount: 2,
      disappearedCount: 1,
      outsideSampleEnteredCount: 1,
    });
    f.state.head = 101;
    f.mined.set(101, [transaction(3)]);
    f.state.time += 3_000;
    const nextHead = await f.provider();
    expect(nextHead.transactions.some((tx) => tx.id === id(3) && tx.status === 'pending')).toBe(
      false,
    );
    expect(nextHead.poolFlow).toEqual(result.poolFlow);
    expect(f.requests.filter(({ method }) => method === 'txpool_content')).toHaveLength(2);
  });

  it('publishes a valid full inventory even when the pending selection has no base-fee reference', async () => {
    const f = fixture();
    f.state.baseFee = null;
    const first = await f.collectPool([transaction(1)]);
    expect(first.sampling).toBeNull();
    expect(first.poolFlow).toMatchObject({ state: 'warming', inventoryCount: 1 });
    const second = await f.refresh([transaction(1), transaction(2)]);
    expect(second.sampling).toBeNull();
    expect(second.poolFlow?.history.at(-1)).toMatchObject({
      enteredCount: 1,
      outsideSampleEnteredCount: 1,
    });
  });

  it('preserves its baseline while the existing asynchronous inventory refresh is in flight', async () => {
    const f = fixture();
    await f.collectPool([transaction(1)]);
    let release!: () => void;
    f.state.poolGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.state.pool = content([transaction(1), transaction(2)]);
    f.state.time += 30_000;
    expect((await f.provider()).poolFlow).toBeNull();
    release();
    await f.settle();
    const completed = await f.provider();
    expect(completed.poolFlow).toMatchObject({ state: 'ready', inventoryCount: 2 });
    expect(completed.poolFlow?.history.at(-1)?.enteredCount).toBe(1);
    expect(f.requests.filter(({ method }) => method === 'txpool_content')).toHaveLength(2);
  });

  it('invalidates a failed whole inventory instead of bridging its normal retry interval', async () => {
    const f = fixture();
    await f.collectPool([transaction(1)]);
    f.state.time += 30_000;
    f.state.pool = { pending: {}, queued: [] };
    await f.provider();
    await f.settle();
    expect((await f.provider()).poolFlow).toBeNull();
    // Exactly 90 seconds from the baseline would otherwise still allow a delta.
    const recovered = await f.refresh([transaction(1), transaction(2)], [], 60_000);
    expect(recovered.poolFlow).toMatchObject({ state: 'warming', history: [], inventoryCount: 2 });
  });

  it('withdraws flow after a required chain request fails, even if the old pool is still fresh', async () => {
    const f = fixture();
    await f.collectPool([transaction(1)]);
    f.state.time += 3_000;
    f.state.latestFailure = true;
    await expect(f.provider()).rejects.toMatchObject({ kind: 'http' });
    f.state.latestFailure = false;
    expect((await f.provider()).poolFlow).toBeNull();
    const fresh = await f.refresh([transaction(1), transaction(2)], [], 27_000);
    expect(fresh.poolFlow).toMatchObject({ state: 'warming', history: [] });
  });

  it.each(['required-failure', 'reorganization', 'backward-clock'] as const)(
    'rejects an old in-flight completion after %s',
    async (interruption) => {
      const f = fixture();
      await f.collectPool([transaction(1)]);
      let release!: () => void;
      f.state.poolGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      f.state.time += 30_000;
      f.state.pool = content([transaction(1), transaction(2)]);
      await f.provider();
      if (interruption === 'required-failure') {
        f.state.latestFailure = true;
        await expect(f.provider()).rejects.toMatchObject({ kind: 'http' });
        f.state.latestFailure = false;
      } else {
        if (interruption === 'reorganization') f.state.branch = 1;
        else f.state.time -= 5_000;
        await f.provider();
      }
      release();
      await f.settle();
      expect((await f.provider()).poolFlow).toBeNull();
      const recovered = await f.refresh([transaction(1), transaction(2), transaction(3)]);
      expect(recovered.poolFlow).toMatchObject({
        state: 'warming',
        history: [],
        inventoryCount: 3,
      });
    },
  );

  it('restarts in warming state after an observation gap exceeds ninety seconds', async () => {
    const f = fixture();
    await f.collectPool([transaction(1)]);
    const delayed = await f.refresh([transaction(1), transaction(2)], [], 90_001);
    expect(delayed.poolFlow).toMatchObject({ state: 'warming', inventoryCount: 2, history: [] });
  });

  it('uses the final limited sample rather than all fee-ineligible or queued inventory members', async () => {
    const f = fixture();
    const original = Array.from({ length: PENDING_SAMPLE_LIMIT + 5 }, (_, index) =>
      transaction(index + 10),
    );
    await f.collectPool(original);
    const highest = transaction(10_000, 200n);
    const belowBase = transaction(10_001, 1n);
    const deferred = transaction(10_002);
    const next = await f.refresh([...original, highest, belowBase], [deferred]);
    expect(next.transactions.filter((tx) => tx.status === 'pending')).toHaveLength(
      PENDING_SAMPLE_LIMIT,
    );
    expect(next.transactions.some((tx) => tx.id === highest.hash)).toBe(true);
    expect(next.poolFlow?.history.at(-1)).toMatchObject({
      enteredCount: 3,
      outsideSampleEnteredCount: 2,
    });
    expect(f.requests.filter(({ method }) => method === 'txpool_content')).toHaveLength(2);
    expect(f.requests.some(({ method }) => method === 'eth_getTransactionCount')).toBe(false);
  });
});
