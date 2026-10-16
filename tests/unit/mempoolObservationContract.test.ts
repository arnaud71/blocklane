import { describe, expect, it } from 'vitest';
import { generateDemoSnapshot } from '../../server/demo.js';
import {
  MAX_TRACKED_TRANSACTIONS,
  ethereumTransactionSchema,
  poolObservationSchema,
  snapshotSchema,
  type Snapshot,
} from '../../shared/model.js';
import { assessFreshness, nextSnapshotFreshnessDeadline } from '../../src/lib/freshness';

const NOW = 1_700_000_000_000;
const id = (n: number) => n.toString(16).padStart(64, '0');
function bitcoin(): Snapshot {
  return {
    chain: 'bitcoin',
    mode: 'live',
    status: 'ok',
    source: 'REST',
    observedAt: NOW,
    coverage: 'Inventaire et candidat indépendants.',
    pendingCount: 1,
    feeRate: 1,
    feeUnit: 'sat/vB',
    transactions: [
      {
        id: id(11),
        chain: 'bitcoin',
        status: 'pending',
        feeRate: 20,
        size: 200,
        value: '',
        kind: 'transfer',
      },
    ],
    blocks: [
      {
        hash: id(100),
        height: 100,
        timestamp: NOW / 1000,
        txCount: 1,
        used: 200,
        capacity: 1_000_000,
      },
    ],
    sampling: {
      method: 'getrawmempool',
      source: 'Node',
      observedAt: NOW - 5_000,
      pendingCount: 1,
      update: 'incremental',
    },
    poolObservation: {
      method: 'getrawmempool',
      source: 'Node',
      observedAt: NOW - 5_000,
      presentTransactionIds: [id(11)],
      queuedTransactionIds: [],
      absentTransactionIds: [id(12)],
    },
  };
}
function ethereum(): Snapshot {
  const source = bitcoin();
  return {
    ...source,
    chain: 'ethereum',
    feeUnit: 'Gwei',
    sampling: null,
    poolObservation: null,
    transactions: [],
    blocks: source.blocks.map((block) => ({ ...block, hash: `0x${block.hash}` })),
    ethereumProjection: {
      parentBlockHash: `0x${id(100)}`,
      height: 101,
      baseFeePerGasWei: '35000000000',
      source: 'calculated',
      observedAt: NOW,
    },
  };
}

describe('mempool presence and Ethereum projection contract', () => {
  it('accepts dated presence and absence without making an absence an inclusion', () => {
    const parsed = snapshotSchema.parse(bitcoin());
    expect(parsed.poolObservation?.absentTransactionIds).toEqual([id(12)]);
    expect(parsed.inclusions).toBeUndefined();
    expect(parsed.transactions[0]?.status).toBe('pending');
  });
  it('requires a complete inventory with matching provenance and date', () => {
    for (const patch of [
      { source: 'Other' },
      { observedAt: NOW + 1 },
      { observedAt: NOW - 6_000 },
      { method: 'txpool_content' },
    ]) {
      expect(
        snapshotSchema.safeParse({
          ...bitcoin(),
          poolObservation: { ...bitcoin().poolObservation, ...patch },
        }).success,
      ).toBe(false);
    }
    expect(snapshotSchema.safeParse({ ...bitcoin(), sampling: null }).success).toBe(false);
  });
  it('bounds all presence states together and rejects duplicate identities across states', () => {
    const pool = bitcoin().poolObservation!;
    expect(
      poolObservationSchema.safeParse({ ...pool, absentTransactionIds: [id(11).toUpperCase()] })
        .success,
    ).toBe(false);
    expect(
      poolObservationSchema.safeParse({ ...pool, queuedTransactionIds: [id(13)] }).success,
    ).toBe(false);
    expect(
      poolObservationSchema.safeParse({
        ...pool,
        presentTransactionIds: Array.from({ length: MAX_TRACKED_TRANSACTIONS }, (_, n) =>
          id(n + 20),
        ),
      }).success,
    ).toBe(false);
    expect(
      snapshotSchema.safeParse({
        ...bitcoin(),
        poolObservation: { ...pool, absentTransactionIds: ['not-an-id'] },
      }).success,
    ).toBe(false);
  });
  it('normalizes hexadecimal identities and rejects repeated transactions in different case', () => {
    const source = bitcoin();
    const tx = { ...source.transactions[0]!, id: 'a'.repeat(64).toUpperCase() };
    expect(snapshotSchema.parse({ ...source, transactions: [tx] }).transactions[0]?.id).toBe(
      'a'.repeat(64),
    );
    expect(
      snapshotSchema.safeParse({
        ...source,
        transactions: [tx, { ...tx, id: tx.id.toLowerCase() }],
      }).success,
    ).toBe(false);
  });
  it('allows observed nonmembers next to a candidate without charging their weight to it', () => {
    const source = bitcoin();
    const candidate = {
      source: 'Node',
      observedAt: NOW,
      height: 101,
      previousBlockHash: id(100),
      transactionCount: 1,
      weight: 800,
      weightLimit: 4_000_000,
      selectedTransactionIds: [id(11)],
    };
    const outsider = { ...source.transactions[0]!, id: id(13), size: 50_000 };
    expect(
      snapshotSchema.safeParse({
        ...source,
        pendingCount: 0,
        sampling: { ...source.sampling, pendingCount: 0 },
        poolObservation: {
          ...source.poolObservation,
          presentTransactionIds: [],
          absentTransactionIds: [id(11), id(12)],
        },
        blockTemplate: candidate,
      }).success,
    ).toBe(true);
    expect(
      snapshotSchema.safeParse({
        ...source,
        transactions: [...source.transactions, outsider],
        blockTemplate: candidate,
      }).success,
    ).toBe(true);
    expect(
      snapshotSchema.safeParse({
        ...source,
        sampling: null,
        poolObservation: null,
        transactions: [outsider],
        blockTemplate: candidate,
      }).success,
    ).toBe(false);
  });
  it('anchors exact Ethereum projection quantities to the observed live parent', () => {
    expect(snapshotSchema.safeParse(ethereum()).success).toBe(true);
    for (const patch of [
      { parentBlockHash: `0x${id(101)}` },
      { height: 102 },
      { observedAt: NOW + 1 },
      { baseFeePerGasWei: '3.5' },
      { baseFeePerGasWei: (1n << 256n).toString() },
    ]) {
      expect(
        snapshotSchema.safeParse({
          ...ethereum(),
          ethereumProjection: { ...ethereum().ethereumProjection, ...patch },
        }).success,
      ).toBe(false);
    }
    expect(
      snapshotSchema.safeParse({ ...bitcoin(), ethereumProjection: ethereum().ethereumProjection })
        .success,
    ).toBe(false);
    expect(snapshotSchema.safeParse({ ...ethereum(), mode: 'demo' }).success).toBe(false);
  });
  it('preserves exact nonces and caps, rejecting malformed or inconsistent quantities safely', () => {
    const tx = {
      from: `0x${'A'.repeat(40)}`,
      nonce: '9007199254740993',
      maxFeePerGasWei: '40000000000',
      maxPriorityFeePerGasWei: '2000000000',
    };
    expect(ethereumTransactionSchema.parse(tx)).toEqual({ ...tx, from: tx.from.toLowerCase() });
    for (const patch of [
      { nonce: '-1' },
      { nonce: '1.5' },
      { nonce: 'bad' },
      { maxFeePerGasWei: 'bad' },
      { maxPriorityFeePerGasWei: undefined },
      { maxPriorityFeePerGasWei: '50000000000' },
    ]) {
      expect(ethereumTransactionSchema.safeParse({ ...tx, ...patch }).success).toBe(false);
    }
    expect(
      ethereumTransactionSchema.safeParse({ from: tx.from, nonce: '0', gasPriceWei: '0' }).success,
    ).toBe(true);
  });
  it('expires pool evidence and projections independently during a stalled request', () => {
    const source = ethereum();
    expect(nextSnapshotFreshnessDeadline(source, NOW)).toBe(NOW + 30_001);
    const expired = assessFreshness(source, false, NOW + 30_001);
    expect(expired.ethereumProjection).toBeNull();
    expect(expired.blocks).toBe(source.blocks);
    expect(expired.observedAt).toBe(NOW);
    const poolSource = bitcoin();
    expect(nextSnapshotFreshnessDeadline(poolSource, NOW)).toBe(NOW + 55_001);
    expect(assessFreshness(poolSource, false, NOW + 55_001).poolObservation).toBeNull();
    expect(assessFreshness(source, false, NOW + 120_001)).toMatchObject({
      ethereumProjection: null,
      poolObservation: null,
      status: 'unavailable',
    });
  });
  it('keeps demonstrations independent from real inventory evidence', () => {
    const demo = generateDemoSnapshot('bitcoin', NOW);
    expect(
      snapshotSchema.safeParse({
        ...demo,
        poolObservation: bitcoin().poolObservation,
        sampling: bitcoin().sampling,
      }).success,
    ).toBe(false);
  });
});
