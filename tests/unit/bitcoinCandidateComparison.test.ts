import { describe, expect, it } from 'vitest';
import { createBitcoinCandidateComparisonTracker } from '../../server/adapters/bitcoinCandidateComparison';
import { type BitcoinTemplateSample } from '../../server/adapters/bitcoinTemplate';
import { TRACKED_TRANSACTION_TTL_MS } from '../../shared/model';
import { now } from './fixtures';

const id = (number: number) => number.toString(16).padStart(64, '0');
const parent = { id: id(100_000), height: 100, tx_count: 1 };
const block = {
  id: id(100_001),
  height: 101,
  tx_count: 4,
  previousblockhash: parent.id,
};
const actual = { hash: block.id, transactionIds: new Set([id(0), id(11), id(12), id(14)]) };

function candidate(overrides: Partial<BitcoinTemplateSample> = {}): BitcoinTemplateSample {
  return {
    source: 'Nœud proposant le candidat',
    observedAt: now,
    previousBlockHash: parent.id,
    height: 101,
    count: 3,
    transactionIds: new Set([id(11), id(12), id(13)]),
    transactions: [],
    weight: 2_400,
    weightLimit: 4_000_000,
    medianFeeSats: 2_000,
    ...overrides,
  };
}

function prepared(template = candidate()) {
  const tracker = createBitcoinCandidateComparisonTracker();
  tracker.observeHead(parent, now, 'Fournisseur des blocs');
  tracker.publishCandidate(template, parent, now);
  return tracker;
}

describe('complete Bitcoin candidate comparison evidence', () => {
  it('compares full inventories, excludes coinbase and exposes only aggregates', () => {
    const tracker = prepared();
    tracker.observeHead(block, now + 3_000, 'Fournisseur des blocs');
    const result = tracker.compare(block, actual, now + 3_000);
    expect(result).toEqual({
      scope: 'complete',
      blockHash: block.id,
      blockHeight: block.height,
      parentBlockHash: parent.id,
      candidateObservedAt: now,
      blockObservedAt: now + 3_000,
      candidateSource: 'Nœud proposant le candidat',
      blockSource: 'Fournisseur des blocs',
      candidateTransactionCount: 3,
      blockTransactionCount: 3,
      commonCount: 2,
      candidateOnlyCount: 1,
      blockOnlyCount: 1,
    });
    expect(JSON.stringify(result)).not.toContain('transactionIds');
  });

  it('keeps an owned candidate inventory when the background reader mutates its old set', () => {
    const transactionIds = new Set([id(11), id(12), id(13)]);
    const tracker = prepared(candidate({ transactionIds }));
    transactionIds.clear();
    transactionIds.add(id(99));
    tracker.observeHead(block, now + 3_000, 'Blocs');
    expect(tracker.compare(block, actual, now + 3_000)).toMatchObject({
      candidateTransactionCount: 3,
      commonCount: 2,
    });
  });

  it('never captures a proposal first published during or after new-head detection', () => {
    const tracker = createBitcoinCandidateComparisonTracker();
    tracker.observeHead(parent, now, 'Blocs');
    tracker.observeHead(block, now + 3_000, 'Blocs');
    tracker.publishCandidate(candidate(), parent, now + 3_000);
    tracker.publishCandidate(
      candidate({ height: 102, previousBlockHash: block.id, observedAt: now + 3_000 }),
      block,
      now + 3_000,
    );
    expect(tracker.compare(block, actual, now + 3_000)).toBeNull();
  });

  it('keeps the frozen candidate and original head detection time across a failed proof retry', () => {
    const tracker = prepared();
    tracker.observeHead(block, now + 3_000, 'Blocs');
    expect(tracker.compare(block, undefined, now + 3_000)).toBeNull();
    tracker.publishCandidate(
      candidate({
        height: 102,
        previousBlockHash: block.id,
        observedAt: now + 4_000,
        transactionIds: new Set([id(21), id(22), id(23)]),
      }),
      block,
      now + 4_000,
    );
    tracker.observeHead(block, now + 8_000, 'Blocs');
    expect(tracker.compare(block, actual, now + 8_000)).toMatchObject({
      commonCount: 2,
      candidateObservedAt: now,
      blockObservedAt: now + 3_000,
    });
  });

  it('accepts the 30-second boundary and rejects a candidate older than it', () => {
    for (const age of [30_000, 30_001]) {
      const tracker = prepared();
      tracker.observeHead(block, now + age, 'Blocs');
      expect(tracker.compare(block, actual, now + age) !== null).toBe(age === 30_000);
    }
  });

  it('expires an unverified frozen inventory after 30 minutes without a fresh recapture', () => {
    const tracker = prepared();
    tracker.observeHead(block, now + 3_000, 'Blocs');
    expect(tracker.compare(block, undefined, now + 3_000)).toBeNull();
    const afterRetryHorizon = now + 3_000 + TRACKED_TRANSACTION_TTL_MS + 1;
    tracker.observeHead(block, afterRetryHorizon, 'Blocs');
    expect(tracker.compare(block, actual, afterRetryHorizon)).toBeNull();
  });

  it('retains a successful aggregate without retaining its private frozen inventory', () => {
    const tracker = prepared();
    tracker.observeHead(block, now + 3_000, 'Blocs');
    const result = tracker.compare(block, actual, now + 3_000);
    expect(tracker.compare(block, undefined, now + 3_000 + TRACKED_TRANSACTION_TTL_MS + 1)).toBe(
      result,
    );
  });

  it('revokes comparison evidence when the service clock goes backwards before detection', () => {
    const tracker = prepared();
    tracker.observeHead(block, now + 3_000, 'Blocs');
    expect(tracker.compare(block, actual, now + 3_000)).not.toBeNull();
    tracker.observeHead(block, now + 2_000, 'Blocs');
    expect(tracker.compare(block, actual, now + 2_000)).toBeNull();
    expect(tracker.compare(block, actual, now + 4_000)).toBeNull();
  });

  it.each([
    { previousblockhash: undefined },
    { previousblockhash: id(999) },
    { height: 102 },
    { height: 100 },
  ])('rejects an absent/wrong parent, skipped height or reorganization (%j)', (overrides) => {
    const tracker = prepared();
    const changed = { ...block, ...overrides };
    tracker.observeHead(changed, now + 3_000, 'Blocs');
    expect(tracker.compare(changed, actual, now + 3_000)).toBeNull();
  });

  it('invalidates successful evidence on a same-height replacement and a rewind', () => {
    const tracker = prepared();
    tracker.observeHead(block, now + 3_000, 'Blocs');
    expect(tracker.compare(block, actual, now + 3_000)).not.toBeNull();
    const replacement = { ...block, id: id(100_002) };
    tracker.observeHead(replacement, now + 4_000, 'Blocs');
    expect(
      tracker.compare(replacement, { ...actual, hash: replacement.id }, now + 4_000),
    ).toBeNull();
    tracker.observeHead(parent, now + 5_000, 'Blocs');
    expect(
      tracker.compare(parent, { hash: parent.id, transactionIds: new Set([id(0)]) }, now + 5_000),
    ).toBeNull();
  });

  it('only reports a real zero overlap after verifying complete empty and coinbase-only inputs', () => {
    const tracker = prepared(candidate({ transactionIds: new Set(), count: 0, weight: 0 }));
    const emptyBlock = { ...block, tx_count: 1 };
    tracker.observeHead(emptyBlock, now + 3_000, 'Blocs');
    expect(
      tracker.compare(emptyBlock, { hash: block.id, transactionIds: new Set() }, now + 3_000),
    ).toBeNull();
    expect(
      tracker.compare(
        emptyBlock,
        { hash: block.id, transactionIds: new Set([id(0)]) },
        now + 3_000,
      ),
    ).toMatchObject({
      candidateTransactionCount: 0,
      blockTransactionCount: 0,
      commonCount: 0,
      candidateOnlyCount: 0,
      blockOnlyCount: 0,
    });
  });

  it('rejects a malformed non-coinbase candidate containing the received coinbase identifier', () => {
    const tracker = prepared(candidate({ transactionIds: new Set([id(0), id(11), id(12)]) }));
    tracker.observeHead(block, now + 3_000, 'Blocs');
    expect(tracker.compare(block, actual, now + 3_000)).toBeNull();
  });

  it.each([
    { count: 2 },
    { count: 30_001 },
    { transactionIds: new Set([id(11), id(12), 'invalid']) },
    { transactionIds: new Set(['a'.repeat(64), 'A'.repeat(64), id(12)]) },
    { observedAt: now + 1 },
    { previousBlockHash: id(999) },
  ])('does not publish an incomplete, unbounded or contradictory candidate (%j)', (overrides) => {
    const tracker = prepared(candidate(overrides));
    tracker.observeHead(block, now + 3_000, 'Blocs');
    expect(tracker.compare(block, actual, now + 3_000)).toBeNull();
  });

  it('accepts complete candidate inventories up to 30000 and block inventories up to 30000 including coinbase', () => {
    const ids = Array.from({ length: 30_000 }, (_, index) => id(index + 1));
    const tracker = prepared(candidate({ count: ids.length, transactionIds: new Set(ids) }));
    const fullBlock = { ...block, tx_count: 30_000 };
    tracker.observeHead(fullBlock, now + 3_000, 'Blocs');
    expect(
      tracker.compare(
        fullBlock,
        { hash: fullBlock.id, transactionIds: new Set([id(0), ...ids.slice(0, 29_999)]) },
        now + 3_000,
      ),
    ).toMatchObject({
      candidateTransactionCount: 30_000,
      blockTransactionCount: 29_999,
      commonCount: 29_999,
      candidateOnlyCount: 1,
      blockOnlyCount: 0,
    });
  });
});
