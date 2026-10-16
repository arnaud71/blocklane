import { describe, expect, it } from 'vitest';
import {
  BITCOIN_ARRIVAL_SAMPLE_LIMIT,
  snapshotSchema,
  type Snapshot,
  type Tx,
} from '../../shared/model';
import { assessFreshness, nextSnapshotFreshnessDeadline } from '../../src/lib/freshness';
import { liveSnapshot, now } from './fixtures';

const id = (value: number) => value.toString(16).padStart(64, '0');
function source(): Snapshot {
  const transaction: Tx = {
    id: id(5000),
    chain: 'bitcoin',
    feeRate: 10,
    size: 200,
    status: 'pending',
    kind: 'transfer',
    value: 'Montant non fourni',
  };
  return {
    ...liveSnapshot('bitcoin', now),
    transactions: [transaction],
    bitcoinArrivals: {
      source: 'Flux Bitcoin indépendant',
      method: 'mempool-transactions',
      observedAt: now,
      transactionIds: [transaction.id],
    },
  };
}

describe('real Bitcoin stream arrivals public contract', () => {
  it('accepts a dated pending detail independently of a candidate and full-pool inventory', () => {
    const snapshot = source();
    const block = snapshot.blocks[0]!;
    snapshot.blockTemplate = {
      source: 'Autre nœud candidat',
      observedAt: now,
      height: block.height + 1,
      previousBlockHash: block.hash,
      transactionCount: 0,
      weight: 0,
      weightLimit: 4_000_000,
      selectedTransactionIds: [],
    };
    snapshot.pendingCount = 0;
    snapshot.sampling = {
      source: 'Inventaire RPC indépendant',
      method: 'getrawmempool',
      update: 'full',
      observedAt: now,
      pendingCount: 0,
    };
    expect(snapshotSchema.parse(snapshot).bitcoinArrivals?.transactionIds).toEqual([id(5000)]);
    expect(snapshot.blockTemplate.selectedTransactionIds).toEqual([]);
    expect(snapshotSchema.safeParse({ ...snapshot, bitcoinArrivals: undefined }).success).toBe(
      false,
    );
  });

  it.each([
    { mode: 'demo' },
    { chain: 'ethereum', feeUnit: 'Gwei', transactions: [] },
    { status: 'unavailable', transactions: [], blocks: [] },
    { transactions: [] },
    {
      transactions: [
        { ...source().transactions[0]!, status: 'confirmed', blockHeight: 10, blockHash: id(99) },
      ],
    },
    { bitcoinArrivals: { ...source().bitcoinArrivals!, observedAt: now + 1 } },
    { bitcoinArrivals: { ...source().bitcoinArrivals!, observedAt: now - 60_001 } },
    {
      bitcoinArrivals: {
        ...source().bitcoinArrivals!,
        transactionIds: [id(5000), id(5000).toUpperCase()],
      },
    },
    { bitcoinArrivals: { ...source().bitcoinArrivals!, transactionIds: ['not-a-bitcoin-hash'] } },
  ])('refuses misleading provenance or invalid pending membership %j', (override) => {
    expect(snapshotSchema.safeParse({ ...source(), ...override }).success).toBe(false);
  });

  it('bounds the independent arrival subset and canonicalizes actual hash identities', () => {
    const snapshot = source();
    snapshot.bitcoinArrivals!.transactionIds = [id(5000).toUpperCase()];
    expect(snapshotSchema.parse(snapshot).bitcoinArrivals?.transactionIds).toEqual([id(5000)]);
    snapshot.bitcoinArrivals!.transactionIds = Array.from(
      { length: BITCOIN_ARRIVAL_SAMPLE_LIMIT + 1 },
      (_, index) => id(index),
    );
    expect(snapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it('expires stream-only active presence independently without renewing block dates', () => {
    const snapshot = snapshotSchema.parse(source());
    expect(nextSnapshotFreshnessDeadline(snapshot, now)).toBe(now + 60_001);
    expect(assessFreshness(snapshot, false, now + 60_000).bitcoinArrivals).toEqual(
      snapshot.bitcoinArrivals,
    );
    const expired = assessFreshness(snapshot, false, now + 60_001);
    expect(expired.bitcoinArrivals).toBeNull();
    expect(expired.transactions).toEqual([]);
    expect(snapshot.transactions).toHaveLength(1);
    expect(expired.observedAt).toBe(now);
    expect(assessFreshness(snapshot, false, now - 1).bitcoinArrivals).toBeNull();
    expect(assessFreshness(snapshot, true, now + 120_001).bitcoinArrivals).toBeNull();
  });

  it('preserves independent fresh RPC or candidate evidence when old arrival provenance expires', () => {
    const snapshot = source();
    snapshot.bitcoinArrivals!.observedAt = now - 60_000;
    const block = snapshot.blocks[0]!;
    const candidate = {
      ...snapshot,
      blockTemplate: {
        source: 'Nœud candidat indépendant',
        observedAt: now,
        height: block.height + 1,
        previousBlockHash: block.hash,
        transactionCount: 1,
        weight: 800,
        weightLimit: 4_000_000,
        selectedTransactionIds: [id(5000)],
      },
    };
    expect(assessFreshness(snapshotSchema.parse(candidate), false, now + 1).transactions).toEqual(
      snapshot.transactions,
    );
    const pool = {
      ...snapshot,
      sampling: {
        source: 'RPC indépendant',
        method: 'getrawmempool',
        observedAt: now,
        pendingCount: 1,
        update: 'full',
      },
      pendingCount: 1,
      poolObservation: {
        source: 'RPC indépendant',
        method: 'getrawmempool',
        observedAt: now,
        presentTransactionIds: [id(5000)],
        queuedTransactionIds: [],
        absentTransactionIds: [],
      },
    };
    expect(assessFreshness(snapshotSchema.parse(pool), false, now + 1).transactions).toEqual(
      snapshot.transactions,
    );
  });
});
