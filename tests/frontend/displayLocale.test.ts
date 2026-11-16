import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { snapshotSchema, type Snapshot } from '../../shared/model';
import { latestBlockValueDisplay } from '../../src/lib/blockValueDisplay';
import { candidateComparisonDisplay } from '../../src/lib/candidateComparisonDisplay';
import {
  formatFeeRate,
  formatMedianTransactionFee,
  medianTransactionFeeNote,
  medianTransactionFeeScopeLabel,
  usdQuoteNote,
} from '../../src/lib/feeDisplay';
import { providerMempool } from '../../src/lib/mempoolDisplay';
import { providerFlowDisplay } from '../../src/lib/poolFlowDisplay';

const NOW = Date.parse('2026-10-16T12:00:00Z');
const SOURCE = 'Source conservée · contrôlée';
const HASH = 'b'.repeat(64);
function source(overrides: Partial<Snapshot> = {}): Snapshot {
  return snapshotSchema.parse({
    chain: 'bitcoin',
    mode: 'live',
    status: 'ok',
    source: SOURCE,
    observedAt: NOW,
    coverage: 'Texte original de la source',
    pendingCount: 1_234,
    feeRate: 1.25,
    feeUnit: 'sat/vB',
    transactions: [],
    inclusions: [],
    blocks: [
      {
        hash: HASH,
        height: 900_001,
        timestamp: NOW / 1_000,
        txCount: 4,
        used: 500_000,
        capacity: 1_000_000,
      },
    ],
    ...overrides,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('localized displays preserve provider facts', () => {
  it('formats native precision, half-satoshi medians and USD without changing their values', () => {
    const median = {
      nativeAmount: 0.000000005,
      sampleSize: 2,
      scope: 'template' as const,
      medianFeeSats: 0.5,
    };
    expect(formatMedianTransactionFee('bitcoin', median, 'native')).toBe('0,000000005 BTC');
    expect(formatMedianTransactionFee('bitcoin', median, 'native', undefined, 'en')).toBe(
      '0.000000005 BTC',
    );
    expect(formatFeeRate('bitcoin', 1.25, 'native', undefined, 'en')).toBe('1.25 sat/vB');
    expect(formatFeeRate('bitcoin', 1.25, 'native')).toBe('1,25 sat/vB');
    const quote = {
      usdPerCoin: 100_000,
      observedAt: NOW,
      source: 'Coinbase',
      status: 'ok',
    } as const;
    expect(formatMedianTransactionFee('bitcoin', median, 'usd', quote, 'en')).toBe('≈ 0.0005 USD');
    expect(formatMedianTransactionFee('bitcoin', median, 'usd', undefined, 'en')).toBe('— USD');
    expect(usdQuoteNote(quote, false, 'en')).toContain(
      'observed rate, not the historical confirmation rate',
    );
    expect(medianTransactionFeeScopeLabel(median, 'en')).toBe('Complete candidate: 2 tx');
    expect(medianTransactionFeeNote('bitcoin', 2, false, 'template', 'en')).toContain(
      'proves no inclusion',
    );
  });

  it('retains exact block totals and their limits in English', () => {
    const snapshot = source({
      latestBlockValue: {
        blockHash: HASH,
        blockHeight: 900_001,
        transactionCount: 4,
        observedAt: NOW,
        amount: '123456789',
        unit: 'sat',
        method: 'bitcoin-output-sum',
      },
    });
    const original = JSON.stringify(snapshot);
    const french = latestBlockValueDisplay(snapshot);
    const english = latestBlockValueDisplay(snapshot, 'en');
    expect(french.value).toBe('1,2346');
    expect(english.value).toBe('1.2346');
    expect(english.label).toBe('Output value');
    expect(english.note).toContain('123456789 sat');
    expect(english.note).toContain('including change');
    expect(english.note).toContain('not net economic volume');
    expect(JSON.stringify(snapshot)).toBe(original);
  });

  it('translates the provider view without changing its source, count or timestamp', () => {
    const snapshot = source();
    const french = providerMempool(snapshot);
    const english = providerMempool(snapshot, 'en');
    expect(english).toMatchObject({
      total: french.total,
      source: SOURCE,
      observedAt: NOW,
      status: 'ok',
    });
    expect(english.note).toContain(SOURCE);
    expect(english.note).toContain('local view');
    expect(english.note).toContain('distinct from the displayed sample');
    expect(providerMempool(null, 'en').total).toBeNull();
    expect(providerMempool(null, 'en').note).toContain('not a mempool total');
  });

  it('keeps complete comparison counts and dates independent of their translated categories', () => {
    const snapshot = source({
      candidateComparison: {
        scope: 'complete',
        blockHash: HASH,
        blockHeight: 900_001,
        parentBlockHash: 'a'.repeat(64),
        candidateObservedAt: NOW - 3_000,
        blockObservedAt: NOW - 1_000,
        candidateSource: SOURCE,
        blockSource: SOURCE,
        candidateTransactionCount: 3,
        blockTransactionCount: 3,
        commonCount: 2,
        candidateOnlyCount: 1,
        blockOnlyCount: 1,
      },
    });
    const french = candidateComparisonDisplay(snapshot);
    const english = candidateComparisonDisplay(snapshot, 'en');
    expect(english.value).toBe('66.7');
    expect(french.value).toBe('66,7');
    expect(english.categories.map(({ count }) => count)).toEqual([2, 1, 1]);
    expect(english.categories[0]?.label).toBe('Proposed and included');
    expect(english.comparison).toBe(snapshot.candidateComparison);
    expect(english.note).toContain('not a prediction score');
    expect(english.note).toContain('reorganization remains possible');
  });

  it('translates event semantics and visible fallback causes while keeping their own clocks', () => {
    const snapshot = source({
      eventFlow: {
        source: SOURCE,
        method: 'mempool-transactions',
        state: 'live',
        epoch: 1,
        startedAt: NOW - 3_000,
        observedAt: NOW,
        lastMessageAt: NOW,
        history: [
          {
            fromObservedAt: NOW - 3_000,
            observedAt: NOW,
            enteredCount: 15,
            outsideSampleEnteredCount: 0,
          },
        ],
      },
      poolFlow: {
        source: SOURCE,
        method: 'getrawmempool',
        state: 'ready',
        observedAt: NOW,
        inventoryCount: 1_234,
        history: [
          {
            fromObservedAt: NOW - 30_000,
            observedAt: NOW,
            previousCount: 1_234,
            currentCount: 1_234,
            enteredCount: 30,
            disappearedCount: 30,
            outsideSampleEnteredCount: null,
          },
        ],
      },
    });
    expect(providerFlowDisplay(snapshot, NOW, 'en')).toMatchObject({
      kind: 'events',
      value: '+15',
      interval: 'over 3 s',
      average: '5 additions/s · observed avg.',
      observedAt: NOW,
    });
    const fallback = providerFlowDisplay(
      { ...snapshot, eventFlow: { ...snapshot.eventFlow!, state: 'interrupted' } },
      NOW,
      'en',
    );
    expect(fallback.kindLabel).toBe('Periodic inventory · flow interrupted');
    expect(fallback.value).toBe('+30');
    expect(fallback.note).toContain('not the net change');
    expect(fallback.note).toContain('does not prove confirmation');
  });

  it('keeps an unmeasured baseline unknown in either language', () => {
    const snapshot = source({
      poolFlow: {
        source: SOURCE,
        method: 'getrawmempool',
        state: 'warming',
        observedAt: NOW,
        inventoryCount: 0,
        history: [],
      },
    });
    const display = providerFlowDisplay(snapshot, NOW, 'en');
    expect(display.value).toBe('—');
    expect(display.note).toContain('still unknown, not zero');
    expect(display.observedAt).toBe(NOW);
    expect(providerFlowDisplay(snapshot, NOW).value).toBe('—');
  });
});
