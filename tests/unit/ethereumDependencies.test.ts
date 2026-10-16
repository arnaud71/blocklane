import { describe, expect, it, vi } from 'vitest';
import { createEthereumProvider } from '../../server/adapters/ethereum';
import {
  createEthereumDependencyTracker,
  ethereumNonceKey,
  type EthereumPoolNonceIndex,
} from '../../server/adapters/ethereumDependencies';
import type { Fetcher } from '../../server/network';
import {
  MAX_TRACKED_TRANSACTIONS,
  PENDING_SAMPLE_LIMIT,
  snapshotSchema,
  type Snapshot,
} from '../../shared/model';
import { config, ethTx, now, quantity } from './fixtures';

const txHash = (id: number) => `0x${id.toString(16).padStart(64, '0')}`;
const address = (id = 1) => `0x${id.toString(16).padStart(40, '0')}`;
const blockHash = (height: number, branch = 0) => txHash(10_000_000 + branch * 10_000 + height);

function transaction(id: number, nonce: bigint | number, account = 1, price = 100n) {
  return {
    ...ethTx,
    hash: txHash(id),
    from: address(account),
    nonce: quantity(nonce),
    gasPrice: quantity(price * 1_000_000_000n),
    maxFeePerGas: undefined,
    maxPriorityFeePerGas: undefined,
  };
}
type RawTransaction = ReturnType<typeof transaction>;

function content(pending: readonly RawTransaction[], queued: readonly RawTransaction[] = []) {
  const category = (transactions: readonly RawTransaction[]) => {
    const accounts: Record<string, Record<string, RawTransaction>> = {};
    for (const tx of transactions) (accounts[tx.from] ??= {})[BigInt(tx.nonce).toString()] = tx;
    return accounts;
  };
  return { pending: category(pending), queued: category(queued) };
}

function fixture() {
  const state = {
    time: now,
    head: 100,
    branch: 0,
    pool: content([]),
    poolFailure: false,
    poolGate: null as Promise<void> | null,
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
    baseFeePerGas: quantity(40_000_000_000n),
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
      if (state.poolFailure)
        return Response.json({
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32601, message: 'Controlled unavailable pool' },
        });
      result = state.pool;
    } else if (request.method === 'txpool_status')
      result = { pending: quantity(10_000), queued: quantity(1_000) };
    else if (request.method === 'eth_getTransactionReceipt') result = null;
    else if (request.method === 'eth_getBlockByNumber') {
      const tag = String(request.params[0]);
      result =
        tag === 'pending'
          ? null
          : block(tag === 'latest' ? state.head : Number(BigInt(tag)), Boolean(request.params[1]));
    } else throw new Error(`Unexpected fixture method: ${request.method}`);
    return Response.json({ jsonrpc: '2.0', id: request.id, result });
  });
  const provider = createEthereumProvider(config, fetcher, () => state.time);
  async function settle() {
    for (let turn = 0; turn < 160; turn += 1) await Promise.resolve();
  }
  async function refresh(
    pending: readonly RawTransaction[],
    queued: readonly RawTransaction[] = [],
  ) {
    state.pool = content(pending, queued);
    state.time += 30_001;
    await provider();
    await settle();
    return provider();
  }
  async function start(pending: readonly RawTransaction[], queued: readonly RawTransaction[] = []) {
    state.pool = content(pending, queued);
    await provider();
    await settle();
    return provider();
  }
  return { state, mined, requests, provider, settle, refresh, start };
}

function predecessor(snapshot: Snapshot, id: number) {
  return snapshot.ethereumDependencies?.entries.find((entry) => entry.transactionId === txHash(id))
    ?.predecessor;
}
const proofs = (snapshot: Snapshot) =>
  snapshot.inclusions?.flatMap((entry) => entry.transactionIds) ?? [];

describe('bounded Ethereum predecessor context from existing reads', () => {
  it('finds a low-fee parent outside the individual top without adding an individual or a receipt/account-state query', async () => {
    const f = fixture();
    const parent = transaction(1, 0, 1, 34n);
    const child = transaction(2, 1, 1, 200n);
    const others = Array.from({ length: PENDING_SAMPLE_LIMIT }, (_, index) =>
      transaction(index + 10, 0, index + 10),
    );
    const result = await f.start([parent, child, ...others]);
    expect(result.transactions.filter((tx) => tx.status === 'pending')).toHaveLength(
      PENDING_SAMPLE_LIMIT,
    );
    expect(result.transactions.some((tx) => tx.id === parent.hash)).toBe(false);
    expect(predecessor(result, 2)).toEqual({
      state: 'pending',
      nonce: '0',
      transactionId: parent.hash,
    });
    expect(predecessor(result, 1)).toEqual({ state: 'root' });
    expect(result.poolObservation?.presentTransactionIds).toContain(parent.hash);
    expect(result.ethereumDependencies).toMatchObject({
      source: config.ethereumSource,
      observedAt: now,
      parentBlockHash: blockHash(100),
      height: 101,
    });
    expect(
      f.requests.some(
        (request) =>
          request.method === 'eth_getTransactionReceipt' ||
          request.method === 'eth_getTransactionCount',
      ),
    ).toBe(false);
    expect(f.requests.filter((request) => request.method === 'txpool_content')).toHaveLength(1);
    expect(snapshotSchema.safeParse(result).success).toBe(true);
  });

  it('distinguishes nonce-zero roots, an unobserved first pending nonce, and a gap proven by a lower pool nonce', async () => {
    const f = fixture();
    const result = await f.start([
      transaction(1, 0, 1),
      transaction(2, 100, 2),
      transaction(3, 2, 3),
      transaction(4, 0, 3, 34n),
    ]);
    expect(predecessor(result, 1)).toEqual({ state: 'root' });
    expect(predecessor(result, 2)).toEqual({ state: 'unobserved', nonce: '99' });
    expect(predecessor(result, 3)).toEqual({ state: 'gap', nonce: '1' });
    expect(proofs(result)).not.toContain(txHash(4));
  });

  it('uses exact uint256 nonces without rounding through Number', async () => {
    const f = fixture();
    const nonce = (1n << 200n) + 5n;
    const result = await f.start([transaction(1, nonce - 1n, 1, 34n), transaction(2, nonce, 1)]);
    expect(predecessor(result, 2)).toEqual({
      state: 'pending',
      nonce: (nonce - 1n).toString(),
      transactionId: txHash(1),
    });
  });

  it('tracks a queued immediate parent but does not turn a queued child alone into a nonce gap', async () => {
    const f = fixture();
    const child = transaction(2, 1);
    const result = await f.start([child], [transaction(1, 0)]);
    expect(predecessor(result, 2)).toEqual({
      state: 'queued',
      nonce: '0',
      transactionId: txHash(1),
    });
    expect(result.poolObservation?.queuedTransactionIds).toContain(txHash(1));
    const isolated = fixture();
    await isolated.start([transaction(3, 5)]);
    const queued = await isolated.refresh([], [transaction(3, 5)]);
    expect(predecessor(queued, 3)).toEqual({ state: 'unknown', nonce: '4' });
  });

  it('replaces the immediate edge only from a newer complete pool and never confirms the old hash', async () => {
    const f = fixture();
    const child = transaction(2, 1);
    await f.start([transaction(1, 0, 1, 34n), child]);
    const result = await f.refresh([transaction(3, 0, 1, 34n), child]);
    expect(predecessor(result, 2)).toEqual({
      state: 'pending',
      nonce: '0',
      transactionId: txHash(3),
    });
    expect(result.poolObservation?.absentTransactionIds).toContain(txHash(1));
    expect(proofs(result)).not.toContain(txHash(1));
    expect(
      f.requests
        .filter((request) => request.method === 'eth_getTransactionReceipt')
        .map((request) => request.params[0]),
    ).not.toContain(txHash(1));
  });

  it('keeps a disappeared parent unknown after its hash expires, while the child remains observed', async () => {
    const f = fixture();
    const child = transaction(2, 1);
    await f.start([transaction(1, 0, 1, 34n), child]);
    let result = await f.refresh([child]);
    expect(predecessor(result, 2)).toEqual({
      state: 'unknown',
      nonce: '0',
      transactionId: txHash(1),
    });
    for (let turn = 0; turn < 60; turn += 1) result = await f.refresh([child]);
    expect(predecessor(result, 2)).toEqual({ state: 'unknown', nonce: '0' });
    expect(result.poolObservation?.absentTransactionIds).not.toContain(txHash(1));
    expect(proofs(result)).not.toContain(txHash(1));
  });

  it('withdraws the old context on a new head and resolves an exact included parent after the normal pool refresh', async () => {
    const f = fixture();
    const parent = transaction(1, 0, 1, 34n);
    const child = transaction(2, 1);
    await f.start([parent, child]);
    f.state.head = 101;
    f.state.time += 3_000;
    f.mined.set(101, [parent]);
    const intermediate = await f.provider();
    expect(intermediate.ethereumDependencies).toBeNull();
    expect(proofs(intermediate)).toContain(parent.hash);
    expect(f.requests.filter((request) => request.method === 'txpool_content')).toHaveLength(1);
    const result = await f.refresh([child]);
    expect(predecessor(result, 2)).toEqual({
      state: 'confirmed',
      nonce: '0',
      transactionId: parent.hash,
      blockHash: blockHash(101),
      blockHeight: 101,
    });
    expect(result.poolObservation?.absentTransactionIds).toContain(parent.hash);
  });

  it('resolves the actual same-nonce replacement included in a canonical block without confirming the old hash', async () => {
    const f = fixture();
    const child = transaction(2, 1);
    await f.start([transaction(1, 0, 1, 34n), child]);
    f.state.head = 101;
    f.mined.set(101, [transaction(3, 0)]);
    const result = await f.refresh([child]);
    expect(predecessor(result, 2)).toEqual({
      state: 'confirmed',
      nonce: '0',
      transactionId: txHash(3),
      blockHash: blockHash(101),
      blockHeight: 101,
    });
    expect(proofs(result)).toContain(txHash(3));
    expect(proofs(result)).not.toContain(txHash(1));
  });

  it('does not use a higher confirmed nonce as proof of the old predecessor hash', async () => {
    const f = fixture();
    const child = transaction(2, 1);
    await f.start([transaction(1, 0, 1, 34n), child]);
    f.state.head = 101;
    f.mined.set(101, [transaction(3, 2)]);
    const result = await f.refresh([child]);
    expect(predecessor(result, 2)).toEqual({
      state: 'unknown',
      nonce: '0',
      transactionId: txHash(1),
    });
    expect(proofs(result)).not.toContain(txHash(1));
  });

  it('does not infer a gap from a lower nonce known only through confirmed history', async () => {
    const f = fixture();
    const lower = transaction(1, 0);
    await f.start([lower]);
    f.state.head = 101;
    f.mined.set(101, [lower]);
    const result = await f.refresh([transaction(2, 2)]);
    expect(proofs(result)).toContain(lower.hash);
    expect(predecessor(result, 2)).toEqual({ state: 'unobserved', nonce: '1' });
  });

  it('removes old branch resolutions and waits for a refreshed compatible inventory after reorganization', async () => {
    const f = fixture();
    const parent = transaction(1, 0, 1, 34n);
    const child = transaction(2, 1);
    await f.start([parent, child]);
    f.state.head = 101;
    f.mined.set(101, [parent]);
    expect(predecessor(await f.refresh([child]), 2)?.state).toBe('confirmed');
    f.state.branch = 1;
    f.state.time += 3_000;
    f.mined.set(101, []);
    const reorganized = await f.provider();
    expect(reorganized.ethereumDependencies).toBeNull();
    expect(proofs(reorganized)).not.toContain(parent.hash);
    const result = await f.refresh([child]);
    expect(predecessor(result, 2)).toEqual({
      state: 'unknown',
      nonce: '0',
      transactionId: parent.hash,
    });
  });

  it('shares one4096-ID budget across current children, historical observations and out-of-sample parents', async () => {
    const f = fixture();
    let result!: Snapshot;
    for (let cohort = 0; cohort < 4; cohort += 1) {
      const pending: RawTransaction[] = [];
      for (let index = 0; index < PENDING_SAMPLE_LIMIT; index += 1) {
        const account = cohort * PENDING_SAMPLE_LIMIT + index + 1;
        pending.push(transaction(account, 1, account));
        pending.push(transaction(account + 100_000, 0, account, 34n));
      }
      result = cohort === 0 ? await f.start(pending) : await f.refresh(pending);
      const pool = result.poolObservation!;
      const ids = [
        ...pool.presentTransactionIds,
        ...pool.queuedTransactionIds,
        ...pool.absentTransactionIds,
      ];
      const identifierSet = new Set(ids);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length).toBeLessThanOrEqual(MAX_TRACKED_TRANSACTIONS);
      expect(result.ethereumDependencies!.entries.length).toBeLessThanOrEqual(
        MAX_TRACKED_TRANSACTIONS,
      );
      for (const entry of result.ethereumDependencies!.entries) {
        expect(identifierSet.has(entry.transactionId)).toBe(true);
        if ('transactionId' in entry.predecessor && entry.predecessor.transactionId)
          expect(identifierSet.has(entry.predecessor.transactionId)).toBe(true);
      }
      expect(snapshotSchema.safeParse(result).success).toBe(true);
    }
    expect(
      result.poolObservation!.presentTransactionIds.length +
        result.poolObservation!.absentTransactionIds.length,
    ).toBe(MAX_TRACKED_TRANSACTIONS);
  });

  it('refuses contradictory same-account/nonce categories as an invalid whole pool', async () => {
    const f = fixture();
    const result = await f.start([transaction(2, 1), transaction(1, 0)], [transaction(3, 0)]);
    expect(result.ethereumDependencies).toBeNull();
    expect(result.sampling).toBeNull();
    expect(result.message).toContain('inexploitable');
  });

  it('does not re-anchor a pool response completed after the head changed, and adds no refresh call', async () => {
    const f = fixture();
    f.state.pool = content([transaction(1, 0, 1, 34n), transaction(2, 1)]);
    let release!: () => void;
    f.state.poolGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await f.provider();
    await f.settle();
    f.state.head = 101;
    f.state.time += 3_000;
    expect((await f.provider()).ethereumDependencies).toBeNull();
    release();
    await f.settle();
    expect((await f.provider()).ethereumDependencies).toBeNull();
    expect(f.requests.filter((request) => request.method === 'txpool_content')).toHaveLength(1);
  });
});

describe('Ethereum dependency history guards', () => {
  function setup() {
    const tracker = createEthereumDependencyTracker();
    const tracked = new Map([1, 2, 3, 4].map((id) => [txHash(id), now]));
    for (const id of [1, 3, 4])
      tracker.remember({ transactionId: txHash(id), from: address(), nonce: '0' }, now);
    tracker.remember({ transactionId: txHash(2), from: address(), nonce: '1' }, now);
    function pool(parent: number, observedAt: number): EthereumPoolNonceIndex {
      return {
        byNonce: new Map([
          [
            ethereumNonceKey(address(), '0'),
            { transactionId: txHash(parent), from: address(), nonce: '0', state: 'pending' },
          ],
        ]),
        pendingIds: new Set([txHash(parent), txHash(2)]),
        queuedIds: new Set(),
        minimumNonce: new Map([[address(), 0n]]),
        observedAt,
      };
    }
    return { tracker, tracked, pool };
  }

  it('requires a strictly newer inventory before replacing a known parent ID', () => {
    const f = setup();
    const build = (parent: number, observedAt: number) =>
      f.tracker
        .build(
          f.tracked,
          f.pool(parent, observedAt),
          [],
          config.ethereumSource,
          blockHash(100),
          101,
          now,
        )
        .entries.find((entry) => entry.transactionId === txHash(2))!.predecessor;
    expect(build(1, now)).toEqual({ state: 'pending', nonce: '0', transactionId: txHash(1) });
    expect(build(3, now - 1)).toMatchObject({ state: 'unknown', transactionId: txHash(1) });
    expect(build(3, now)).toMatchObject({ state: 'unknown', transactionId: txHash(1) });
    expect(build(3, now + 1)).toEqual({ state: 'pending', nonce: '0', transactionId: txHash(3) });
  });

  it('keeps contradictory same-account/nonce inclusion evidence ambiguous through three entries', () => {
    const f = setup();
    const inclusions = [1, 3, 4].map((id, index) => ({
      block: {
        hash: blockHash(98 + index),
        height: 98 + index,
        timestamp: Math.floor(now / 1_000),
        txCount: 1,
        used: 21_000,
        capacity: 60_000_000,
      },
      transactionIds: [txHash(id)],
    }));
    const context = f.tracker.build(
      f.tracked,
      f.pool(1, now),
      inclusions,
      config.ethereumSource,
      blockHash(100),
      101,
      now,
    );
    expect(
      context.entries.find((entry) => entry.transactionId === txHash(2))!.predecessor.state,
    ).toBe('unknown');
  });
});
