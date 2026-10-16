import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  PENDING_SAMPLE_LIMIT,
  snapshotSchema,
  type BitcoinBlockTemplate,
  type Snapshot,
  type Tx,
} from '../../shared/model';
import {
  formatMedianTransactionFee,
  medianTransactionFee,
  medianTransactionFeeNote,
  medianTransactionFeeScopeLabel,
} from '../../src/lib/feeDisplay';
import { assessFreshness } from '../../src/lib/freshness';
import { InfoBillboard } from '../../src/components/InfoBillboard';
import { InfoPanel } from '../../src/components/InfoPanel';

const OBSERVED_AT = Date.parse('2026-10-15T12:00:00Z');
const TEMPLATE_SOURCE = 'Nœud contrôlé · getblocktemplate';
const identifier = (index: number) => index.toString(16).padStart(64, '0');

function normalizeGrouping(text: string): string {
  return text
    .replaceAll(/&#(?:x27|39);/gi, "'")
    .replaceAll(/(?<=\d)['’ʼ](?=\d)/g, ' ')
    .replaceAll(/\s/g, ' ');
}

function transaction(index: number): Tx {
  return {
    id: identifier(index),
    chain: 'bitcoin',
    status: 'pending',
    feeRate: 100,
    size: 200,
    kind: 'transfer',
    value: 'Non mesurée',
  };
}

/** Full median metadata is independent of the limited high-fee transaction details. */
function snapshot(
  templateOverrides: Partial<BitcoinBlockTemplate> = {},
  overrides: Partial<Snapshot> = {},
  transactions = Array.from({ length: PENDING_SAMPLE_LIMIT }, (_, index) => transaction(index + 1)),
): Snapshot {
  const transactionCount = templateOverrides.transactionCount ?? 5_000;
  return snapshotSchema.parse({
    chain: 'bitcoin',
    mode: 'live',
    status: 'ok',
    source: 'Fournisseur blocs et mempool contrôlé',
    observedAt: OBSERVED_AT,
    coverage: 'Candidat complet proposé ; détails individuels limités, sans confirmation déduite.',
    pendingCount: 10_000,
    feeRate: 2,
    feeUnit: 'sat/vB',
    transactions,
    blocks: [
      {
        hash: identifier(100_000),
        height: 900_000,
        timestamp: OBSERVED_AT / 1_000,
        txCount: 4_000,
        used: 900_000,
        capacity: 1_000_000,
      },
    ],
    blockTemplate: {
      source: TEMPLATE_SOURCE,
      observedAt: OBSERVED_AT,
      height: 900_001,
      previousBlockHash: identifier(100_000),
      transactionCount,
      weight:
        transactionCount > transactions.length
          ? 3_992_000
          : transactions.reduce((sum, tx) => sum + tx.size * 4, 0),
      weightLimit: 4_000_000,
      selectedTransactionIds: transactions.map((tx) => tx.id),
      medianFeeSats: 100,
      ...templateOverrides,
    },
    ...overrides,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(OBSERVED_AT);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Complete Bitcoin candidate fee median', () => {
  it('uses all candidate fees rather than the limited individual high-fee details', () => {
    const source = snapshot();
    const median = medianTransactionFee(source);
    expect(source.transactions).toHaveLength(PENDING_SAMPLE_LIMIT);
    expect(median).toEqual({
      nativeAmount: 0.000001,
      sampleSize: 5_000,
      scope: 'template',
      medianFeeSats: 100,
    });
    expect(formatMedianTransactionFee('bitcoin', median, 'native')).toBe('0,000001 BTC');
    expect(normalizeGrouping(medianTransactionFeeScopeLabel(median))).toBe(
      'Candidat complet : 5 000 tx',
    );
    const sample = medianTransactionFee({ ...source, blockTemplate: null });
    expect(sample.scope).toBe('sample');
    expect(sample.sampleSize).toBe(PENDING_SAMPLE_LIMIT);
    expect(sample.nativeAmount).toBeCloseTo(0.0002, 12);
  });

  it('preserves a half-satoshi median for an even candidate without rounding it to zero', () => {
    const source = snapshot({ transactionCount: 2, medianFeeSats: 0.5 }, {}, [
      transaction(1),
      transaction(2),
    ]);
    const median = medianTransactionFee(source);
    expect(median).toEqual({
      nativeAmount: 0.000000005,
      sampleSize: 2,
      scope: 'template',
      medianFeeSats: 0.5,
    });
    expect(formatMedianTransactionFee('bitcoin', median, 'native')).toBe('0,000000005 BTC');
  });

  it('keeps a real zero fee distinct from a missing median', () => {
    const median = medianTransactionFee(snapshot({ medianFeeSats: 0 }));
    expect(median.nativeAmount).toBe(0);
    expect(median.scope).toBe('template');
    expect(formatMedianTransactionFee('bitcoin', median, 'native')).toBe('0 BTC');
    expect(
      formatMedianTransactionFee(
        'bitcoin',
        { ...median, nativeAmount: null, medianFeeSats: null },
        'native',
      ),
    ).toBe('— BTC');
  });

  it('formats the complete native median exactly at the upper monetary bound', () => {
    const median = medianTransactionFee(snapshot({ medianFeeSats: 2_099_999_999_999_999.5 }));
    expect(median.medianFeeSats).toBe(2_099_999_999_999_999.5);
    expect(normalizeGrouping(formatMedianTransactionFee('bitcoin', median, 'native'))).toBe(
      '20 999 999,999999995 BTC',
    );
  });

  it('reports an empty proposed candidate as unmeasured rather than fabricating a zero median', () => {
    const median = medianTransactionFee(
      snapshot({ transactionCount: 0, medianFeeSats: null }, {}, []),
    );
    expect(median).toEqual({
      nativeAmount: null,
      sampleSize: 0,
      scope: 'template',
      medianFeeSats: null,
    });
    expect(formatMedianTransactionFee('bitcoin', median, 'native')).toBe('— BTC');
    expect(medianTransactionFeeNote('bitcoin', 0, false, median.scope)).toContain(
      'Candidat complet du nœud vide, hors coinbase : médiane non mesurée',
    );
  });

  it('keeps backward-compatible templates without full fee metadata on the sample scope', () => {
    const source = snapshot({ medianFeeSats: undefined });
    const median = medianTransactionFee(source);
    expect(median.scope).toBe('sample');
    expect(median.sampleSize).toBe(PENDING_SAMPLE_LIMIT);
    expect(median.nativeAmount).toBeCloseTo(0.0002, 12);
    expect(normalizeGrouping(medianTransactionFeeScopeLabel(median))).toBe(
      'Échantillon : 1 920 tx',
    );
    const note = medianTransactionFeeNote('bitcoin', median.sampleSize, false, median.scope);
    expect(note).toContain('coûts estimés');
    expect(note).toContain('l’échantillon reçu');
    expect(note).not.toContain('candidat complet');
  });

  it('falls back to the dated received sample after real-time expiration without changing source rows', () => {
    const source = snapshot();
    const aged = assessFreshness(source, false, OBSERVED_AT + 30_001);
    const median = medianTransactionFee(aged);
    expect(median.scope).toBe('sample');
    expect(median.sampleSize).toBe(PENDING_SAMPLE_LIMIT);
    expect(median.nativeAmount).toBeCloseTo(0.0002, 12);
    expect(aged.observedAt).toBe(OBSERVED_AT);
    expect(aged.transactions).toBe(source.transactions);
    expect(aged.source).toBe(source.source);
    expect(aged.blockTemplate).toBeNull();
    expect(source.blockTemplate?.medianFeeSats).toBe(100);
    expect(aged.coverage).toContain('Ancien candidat du nœud');
  });

  it('does not apply full candidate metadata to a stale observation or a different parent', () => {
    const source = snapshot();
    const stale = medianTransactionFee({ ...source, status: 'stale' });
    expect(stale.scope).toBe('sample');
    expect(stale.nativeAmount).toBeCloseTo(0.0002, 12);
    const changedParent = medianTransactionFee({
      ...source,
      blocks: [{ ...source.blocks[0]!, hash: identifier(100_001) }],
    });
    expect(changedParent.scope).toBe('sample');
    expect(changedParent.sampleSize).toBe(PENDING_SAMPLE_LIMIT);
    expect(medianTransactionFee({ ...source, status: 'unavailable' })).toEqual({
      nativeAmount: null,
      sampleSize: 0,
      scope: 'sample',
    });
  });

  it('converts a complete native median to USD only with a usable independently dated quote', () => {
    const median = medianTransactionFee(snapshot());
    const quote = {
      usdPerCoin: 100_000,
      observedAt: OBSERVED_AT,
      source: 'Coinbase',
      status: 'ok',
    } as const;
    expect(formatMedianTransactionFee('bitcoin', median, 'usd', quote)).toBe('≈ 0,10 $ US');
    expect(formatMedianTransactionFee('bitcoin', median, 'usd')).toBe('— $ US');
    vi.setSystemTime(OBSERVED_AT + 5 * 60_000 + 1);
    expect(formatMedianTransactionFee('bitcoin', median, 'usd', quote)).toBe('— $ US');
  });

  it('labels the full scope as proposed fees rather than a mempool or confirmed-fee median', () => {
    const note = medianTransactionFeeNote('bitcoin', 5_000, false, 'template');
    expect(note).toContain('candidat complet du nœud, hors coinbase');
    expect(note).toContain('ni la médiane du mempool ni des frais confirmés');
    expect(note).toContain('ne prouve aucune inclusion');
    expect(medianTransactionFeeNote('bitcoin', 2, true)).toContain('Médiane simulée');
    expect(medianTransactionFeeScopeLabel({ nativeAmount: 1, sampleSize: 1 })).toBe(
      'Échantillon : 1 tx',
    );
  });

  it('renders full-scope network details with the node source and its unchanged observation time', () => {
    const source = snapshot();
    const html = normalizeGrouping(
      renderToStaticMarkup(
        createElement(InfoPanel, {
          snapshot: source,
          selectedTx: null,
          paused: true,
          reducedMotion: true,
          feeDisplayUnit: 'native',
        }),
      ),
    );
    expect(html).toContain('data-fee-scope="template"');
    expect(html).toContain('Candidat complet : 5 000 tx');
    expect(html).toContain('0,000001');
    expect(html).toContain('Source des frais');
    expect(html).toContain(TEMPLATE_SOURCE);
    expect(html).toContain(new Date(OBSERVED_AT).toISOString());
    expect(html).toContain('ni la médiane du mempool ni des frais confirmés');
  });

  it('marks the upper billboard scope explicitly while keeping its initial provider mempool page separate', () => {
    const html = renderToStaticMarkup(
      createElement(InfoBillboard, {
        snapshot: snapshot(),
        activity: { walking: 0, waiting: 0, returning: 0, boarded: PENDING_SAMPLE_LIMIT },
        paused: true,
        reducedMotion: true,
        selected: false,
        feeDisplayUnit: 'native',
        theme: 'neutral',
      }),
    );
    expect(html).toContain('data-fee-scope="template"');
    expect(html).toContain('data-page="Mempool"');
    expect(html).toContain('Mempool du fournisseur');
    expect(html).not.toContain('data-page="Frais"');
  });

  it('keeps Ethereum and non-template Bitcoin fees on their original estimated sample scope', () => {
    const bitcoin = snapshot({}, { blockTemplate: null });
    expect(medianTransactionFee(bitcoin).scope).toBe('sample');
    const ethereum = snapshotSchema.parse({
      ...bitcoin,
      chain: 'ethereum',
      feeUnit: 'Gwei',
      transactions: [
        {
          ...transaction(1),
          id: `0x${identifier(1)}`,
          chain: 'ethereum',
          feeRate: 2,
          size: 21_000,
        },
      ],
      blocks: [{ ...bitcoin.blocks[0]!, hash: `0x${identifier(100_000)}`, capacity: 60_000_000 }],
    });
    expect(medianTransactionFee(ethereum)).toMatchObject({ sampleSize: 1, scope: 'sample' });
    expect(medianTransactionFee(ethereum).nativeAmount).toBeCloseTo(0.000042, 12);
  });
});
