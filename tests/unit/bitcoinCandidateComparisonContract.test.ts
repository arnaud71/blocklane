import { describe, expect, it } from 'vitest';
import {
  bitcoinCandidateComparisonSchema,
  snapshotSchema,
  type BitcoinCandidateComparison,
  type Snapshot,
} from '../../shared/model';
import { now } from './fixtures';

const id = (number: number) => number.toString(16).padStart(64, '0');

function comparison(
  overrides: Partial<BitcoinCandidateComparison> = {},
): BitcoinCandidateComparison {
  return {
    scope: 'complete',
    blockHash: id(100_001),
    blockHeight: 101,
    parentBlockHash: id(100_000),
    candidateObservedAt: now - 3_000,
    blockObservedAt: now,
    candidateSource: 'Nœud candidat',
    blockSource: 'Fournisseur des blocs',
    candidateTransactionCount: 3,
    blockTransactionCount: 3,
    commonCount: 2,
    candidateOnlyCount: 1,
    blockOnlyCount: 1,
    ...overrides,
  };
}

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    chain: 'bitcoin',
    mode: 'live',
    status: 'ok',
    source: 'Fournisseur des blocs',
    observedAt: now,
    coverage: 'Comparaison complète indépendante des détails individuels.',
    pendingCount: 10_000,
    feeRate: 8,
    feeUnit: 'sat/vB',
    transactions: [],
    blocks: [
      {
        hash: id(100_001),
        height: 101,
        txCount: 4,
        timestamp: Math.floor((now - 10_000) / 1_000),
        used: 1_000,
        capacity: 1_000_000,
      },
    ],
    candidateComparison: comparison(),
    ...overrides,
  };
}

describe('complete Bitcoin candidate comparison public contract', () => {
  it('accepts aggregate evidence independent of a currently displayed candidate or transaction sample', () => {
    const result = snapshotSchema.parse(snapshot());
    expect(result.candidateComparison).toEqual(comparison());
    expect(result.transactions).toEqual([]);
    expect(result.blockTemplate).toBeUndefined();
    expect(result.candidateComparison?.blockObservedAt).not.toBe(
      result.blocks[0]!.timestamp * 1_000,
    );
  });

  it('accepts omitted/null legacy fields and preserves dated evidence in stale snapshots', () => {
    expect(snapshotSchema.safeParse(snapshot({ candidateComparison: undefined })).success).toBe(
      true,
    );
    expect(snapshotSchema.safeParse(snapshot({ candidateComparison: null })).success).toBe(true);
    const stale = snapshotSchema.parse(snapshot({ status: 'stale', observedAt: now + 60_000 }));
    expect(stale.candidateComparison).toEqual(comparison());
  });

  it('normalizes Bitcoin hash casing and never exposes extra private inventory fields', () => {
    const result = bitcoinCandidateComparisonSchema.parse({
      ...comparison({ blockHash: 'A'.repeat(64), parentBlockHash: 'B'.repeat(64) }),
      transactionIds: [id(1)],
    });
    expect(result.blockHash).toBe('a'.repeat(64));
    expect(result.parentBlockHash).toBe('b'.repeat(64));
    expect(result).not.toHaveProperty('transactionIds');
  });

  it.each([
    { scope: 'partial' },
    { blockHash: 'invalid' },
    { parentBlockHash: '0x' + 'a'.repeat(64) },
    { blockHeight: -1 },
    { candidateObservedAt: -1 },
    { candidateObservedAt: now + 1 },
    { candidateSource: '' },
    { blockSource: 'x'.repeat(101) },
    { candidateTransactionCount: 30_001 },
    { blockTransactionCount: 30_000 },
    { commonCount: -1 },
    { commonCount: 1.5 },
    { commonCount: Number.NaN },
    { candidateOnlyCount: 30_001 },
    { blockOnlyCount: 30_000 },
    { candidateTransactionCount: 4 },
    { blockTransactionCount: 4 },
    { commonCount: 3 },
  ])('rejects incomplete, unbounded or inconsistent public comparison values (%j)', (overrides) => {
    expect(
      bitcoinCandidateComparisonSchema.safeParse({ ...comparison(), ...overrides }).success,
    ).toBe(false);
  });

  it.each([
    { chain: 'ethereum' as const, feeUnit: 'Gwei' as const },
    { mode: 'demo' as const },
    { status: 'unavailable' as const },
    { blocks: [] },
    { candidateComparison: comparison({ blockHash: id(999) }) },
    { candidateComparison: comparison({ blockHeight: 102 }) },
    { candidateComparison: comparison({ blockObservedAt: now + 1 }) },
    { candidateComparison: comparison({ blockTransactionCount: 4, blockOnlyCount: 2 }) },
  ])(
    'rejects aggregate evidence for a different context, tip, count or future observation (%j)',
    (overrides) => {
      expect(snapshotSchema.safeParse(snapshot(overrides)).success).toBe(false);
    },
  );

  it('checks the explicit candidate parent against a displayed preceding height when available', () => {
    const current = snapshot();
    const previous = { ...current.blocks[0]!, height: 100, hash: id(100_000) };
    expect(
      snapshotSchema.safeParse({ ...current, blocks: [...current.blocks, previous] }).success,
    ).toBe(true);
    expect(
      snapshotSchema.safeParse({
        ...current,
        blocks: [...current.blocks, { ...previous, hash: id(999) }],
      }).success,
    ).toBe(false);
  });

  it('accepts fully verified zero counts, and full bounded counts beyond the individual sample', () => {
    expect(
      snapshotSchema.safeParse(
        snapshot({
          blocks: [{ ...snapshot().blocks[0]!, txCount: 1 }],
          candidateComparison: comparison({
            candidateTransactionCount: 0,
            blockTransactionCount: 0,
            commonCount: 0,
            candidateOnlyCount: 0,
            blockOnlyCount: 0,
          }),
        }),
      ).success,
    ).toBe(true);
    expect(
      snapshotSchema.safeParse(
        snapshot({
          blocks: [{ ...snapshot().blocks[0]!, txCount: 30_000 }],
          candidateComparison: comparison({
            candidateTransactionCount: 30_000,
            blockTransactionCount: 29_999,
            commonCount: 29_999,
            candidateOnlyCount: 1,
            blockOnlyCount: 0,
          }),
        }),
      ).success,
    ).toBe(true);
  });
});
