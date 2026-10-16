import { describe, expect, it } from 'vitest';
import {
  ethereumDependenciesSchema,
  snapshotSchema,
  type EthereumDependencies,
  type EthereumPredecessor,
  type Snapshot,
} from '../../shared/model';
import { now } from './fixtures';

const hash = (id: number) => `0x${id.toString(16).padStart(64, '0')}`;
const address = (id = 1) => `0x${id.toString(16).padStart(40, '0')}`;
const SOURCE = 'RPC Ethereum observé';
const POOL_TIME = now - 5_000;

function dependencies(
  predecessor: EthereumPredecessor = { state: 'pending', nonce: '0', transactionId: hash(1) },
): EthereumDependencies {
  return {
    source: SOURCE,
    observedAt: POOL_TIME,
    parentBlockHash: hash(100),
    height: 101,
    entries: [{ transactionId: hash(2), from: address(), nonce: '1', predecessor }],
  };
}

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    chain: 'ethereum',
    mode: 'live',
    status: 'ok',
    source: SOURCE,
    observedAt: now,
    coverage: 'Dépendances immédiates issues du pool complet observé.',
    pendingCount: 2,
    feeRate: 40,
    feeUnit: 'Gwei',
    transactions: [
      {
        id: hash(2),
        chain: 'ethereum',
        status: 'pending',
        feeRate: 100,
        size: 21_000,
        kind: 'transfer',
        value: 'Montant non fourni',
        ethereum: { from: address(), nonce: '1', gasPriceWei: '100000000000' },
      },
    ],
    blocks: [
      {
        hash: hash(100),
        height: 100,
        timestamp: Math.floor(now / 1_000),
        txCount: 1,
        used: 21_000,
        capacity: 60_000_000,
      },
    ],
    inclusions: [],
    sampling: {
      source: SOURCE,
      method: 'txpool_content',
      observedAt: POOL_TIME,
      pendingCount: 2,
      queuedCount: 0,
    },
    poolObservation: {
      source: SOURCE,
      method: 'txpool_content',
      observedAt: POOL_TIME,
      presentTransactionIds: [hash(1), hash(2)],
      queuedTransactionIds: [],
      absentTransactionIds: [],
    },
    ethereumDependencies: dependencies(),
    ...overrides,
  };
}

describe('Ethereum immediate dependency shared contract', () => {
  it('accepts a compact out-of-sample pending parent with independently dated pool provenance', () => {
    const result = snapshotSchema.parse(snapshot());
    expect(result.ethereumDependencies).toEqual(dependencies());
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]!.id).not.toBe(hash(1));
    expect(result.ethereumDependencies!.observedAt).toBe(POOL_TIME);
  });

  it('accepts legacy absent contexts and roots only for nonce zero', () => {
    for (const ethereumDependencies of [undefined, null])
      expect(snapshotSchema.safeParse(snapshot({ ethereumDependencies })).success).toBe(true);
    const zero = dependencies({ state: 'root' });
    zero.entries[0]!.nonce = '0';
    const source = snapshot();
    source.transactions[0]!.ethereum!.nonce = '0';
    expect(snapshotSchema.safeParse({ ...source, ethereumDependencies: zero }).success).toBe(true);
    expect(ethereumDependenciesSchema.safeParse(dependencies({ state: 'root' })).success).toBe(
      false,
    );
  });

  it.each(['unobserved', 'gap', 'unknown'] as const)(
    'keeps %s explicitly distinct from a confirmed or root parent',
    (state) => {
      expect(
        snapshotSchema.safeParse(
          snapshot({ ethereumDependencies: dependencies({ state, nonce: '0' }) }),
        ).success,
      ).toBe(true);
    },
  );

  it('accepts a queued predecessor only with the matching queued inventory category', () => {
    const source = snapshot();
    source.sampling = {
      ...source.sampling!,
      method: 'txpool_content',
      pendingCount: 1,
      queuedCount: 1,
    };
    source.poolObservation = {
      ...source.poolObservation!,
      presentTransactionIds: [hash(2)],
      queuedTransactionIds: [hash(1)],
    };
    source.ethereumDependencies = dependencies({
      state: 'queued',
      nonce: '0',
      transactionId: hash(1),
    });
    expect(snapshotSchema.safeParse(source).success).toBe(true);
    expect(
      snapshotSchema.safeParse({ ...source, ethereumDependencies: dependencies() }).success,
    ).toBe(false);
  });

  it('accepts a confirmed predecessor only with the exact canonical inclusion, even if a non-atomic pool still lists it pending', () => {
    const source = snapshot();
    source.inclusions = [{ block: source.blocks[0]!, transactionIds: [hash(1)] }];
    source.ethereumDependencies = dependencies({
      state: 'confirmed',
      nonce: '0',
      transactionId: hash(1),
      blockHash: hash(100),
      blockHeight: 100,
    });
    expect(snapshotSchema.safeParse(source).success).toBe(true);
    expect(snapshotSchema.safeParse({ ...source, inclusions: [] }).success).toBe(false);
    const absent = {
      ...source,
      poolObservation: {
        ...source.poolObservation!,
        presentTransactionIds: [hash(2)],
        absentTransactionIds: [hash(1)],
      },
    };
    expect(snapshotSchema.safeParse(absent).success).toBe(true);
  });

  it.each([
    { state: 'pending', nonce: '1', transactionId: hash(1) },
    { state: 'pending', nonce: '0' },
    { state: 'pending', nonce: '0', transactionId: hash(2) },
    { state: 'unknown', nonce: '-1' },
    { state: 'gap', nonce: '00' },
    { state: 'unobserved', nonce: '9'.repeat(79) },
    { state: 'confirmed', nonce: '0', transactionId: hash(1), blockHeight: 100 },
  ])('rejects malformed or non-immediate predecessor metadata (%j)', (predecessor) => {
    expect(
      ethereumDependenciesSchema.safeParse({
        ...dependencies(),
        entries: [{ ...dependencies().entries[0]!, predecessor }],
      }).success,
    ).toBe(false);
  });

  it.each([
    { chain: 'bitcoin', feeUnit: 'sat/vB', transactions: [] },
    { mode: 'demo' },
    { status: 'unavailable' },
    { sampling: null },
    { poolObservation: null },
    { blocks: [] },
  ])('rejects dependencies without live Ethereum head and pool context (%j)', (overrides) => {
    expect(snapshotSchema.safeParse({ ...snapshot(), ...overrides }).success).toBe(false);
  });

  it.each([
    { parentBlockHash: hash(99) },
    { height: 102 },
    { source: 'Another provider' },
    { observedAt: now + 1 },
    { observedAt: now - 60_001 },
    { observedAt: POOL_TIME + 1 },
  ])('rejects a mismatched head, source or observation time (%j)', (overrides) => {
    expect(
      snapshotSchema.safeParse(
        snapshot({ ethereumDependencies: { ...dependencies(), ...overrides } }),
      ).success,
    ).toBe(false);
  });

  it('rejects child/parent IDs outside the shared tracked inventory and unobserved non-pending children', () => {
    const source = snapshot();
    expect(
      snapshotSchema.safeParse({
        ...source,
        poolObservation: { ...source.poolObservation!, presentTransactionIds: [hash(2)] },
      }).success,
    ).toBe(false);
    expect(
      snapshotSchema.safeParse({
        ...source,
        poolObservation: { ...source.poolObservation!, presentTransactionIds: [hash(1)] },
      }).success,
    ).toBe(false);
    expect(
      snapshotSchema.safeParse({
        ...source,
        ethereumDependencies: dependencies({ state: 'unobserved', nonce: '0' }),
        poolObservation: {
          ...source.poolObservation!,
          presentTransactionIds: [hash(1)],
          absentTransactionIds: [hash(2)],
        },
      }).success,
    ).toBe(false);
  });

  it('checks accessible parent account/nonce metadata without requiring individual details outside the sample', () => {
    const source = snapshot();
    const parent = {
      ...source.transactions[0]!,
      id: hash(1),
      ethereum: { from: address(2), nonce: '0', gasPriceWei: '40000000000' },
    };
    expect(
      snapshotSchema.safeParse({ ...source, transactions: [...source.transactions, parent] })
        .success,
    ).toBe(false);
    const parentEntry = {
      transactionId: hash(1),
      from: address(2),
      nonce: '0',
      predecessor: { state: 'root' as const },
    };
    expect(
      snapshotSchema.safeParse({
        ...source,
        ethereumDependencies: {
          ...dependencies(),
          entries: [...dependencies().entries, parentEntry],
        },
      }).success,
    ).toBe(false);
    parent.ethereum.from = address();
    expect(
      snapshotSchema.safeParse({ ...source, transactions: [...source.transactions, parent] })
        .success,
    ).toBe(true);
    parent.ethereum.nonce = '3';
    expect(
      snapshotSchema.safeParse({ ...source, transactions: [...source.transactions, parent] })
        .success,
    ).toBe(false);
  });

  it('rejects an edge whose child account/nonce contradicts its individual metadata', () => {
    const context = dependencies();
    context.entries[0]!.from = address(2);
    expect(snapshotSchema.safeParse(snapshot({ ethereumDependencies: context })).success).toBe(
      false,
    );
  });

  it('keeps uint256 quantities exact and canonicalizes hash/address casing', () => {
    const nonce = (1n << 200n) + 3n;
    const context = dependencies({
      state: 'unknown',
      nonce: (nonce - 1n).toString(),
      transactionId: `0x${'A'.repeat(64)}`,
    });
    context.entries[0]!.nonce = nonce.toString();
    context.entries[0]!.from = `0x${'B'.repeat(40)}`;
    const result = ethereumDependenciesSchema.parse(context);
    expect(result.entries[0]!.nonce).toBe(nonce.toString());
    expect(result.entries[0]!.from).toBe(`0x${'b'.repeat(40)}`);
    expect(result.entries[0]!.predecessor).toMatchObject({ transactionId: `0x${'a'.repeat(64)}` });
  });

  it('shares one4096-ID bound across children and referenced parents', () => {
    const entry = dependencies().entries[0]!;
    const entries = Array.from({ length: 4_096 }, (_, index) => ({
      ...entry,
      transactionId: hash(index + 1),
      predecessor: { state: 'root' as const },
      nonce: '0',
    }));
    expect(ethereumDependenciesSchema.safeParse({ ...dependencies(), entries }).success).toBe(true);
    expect(
      ethereumDependenciesSchema.safeParse({ ...dependencies(), entries: [...entries, entries[0]] })
        .success,
    ).toBe(false);
    expect(
      ethereumDependenciesSchema.safeParse({
        ...dependencies(),
        entries: entries.map((entry, index) => ({
          ...entry,
          nonce: '1',
          predecessor: { state: 'pending', nonce: '0', transactionId: hash(index + 10_000) },
        })),
      }).success,
    ).toBe(false);
  });
});
