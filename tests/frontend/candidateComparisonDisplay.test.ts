import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { snapshotSchema, type BitcoinCandidateComparison, type Snapshot } from '../../shared/model';
import { CandidateComparisonDetails } from '../../src/components/InfoPanel';
import { InfoBillboard } from '../../src/components/InfoBillboard';
import { candidateComparisonDisplay } from '../../src/lib/candidateComparisonDisplay';

const OBSERVED_AT = Date.parse('2026-10-15T18:00:00Z');
const BLOCK_HASH = 'b'.repeat(64);
const CANDIDATE_SOURCE = 'Nœud contrôlé · candidat complet';
const BLOCK_SOURCE = 'Fournisseur contrôlé · bloc vérifié';

function observation(comparisonOverrides: Partial<BitcoinCandidateComparison> = {}): Snapshot {
  const comparison: BitcoinCandidateComparison = {
    scope: 'complete',
    blockHash: BLOCK_HASH,
    blockHeight: 900_001,
    parentBlockHash: 'a'.repeat(64),
    candidateObservedAt: OBSERVED_AT - 3_000,
    blockObservedAt: OBSERVED_AT - 1_000,
    candidateSource: CANDIDATE_SOURCE,
    blockSource: BLOCK_SOURCE,
    candidateTransactionCount: 5_000,
    blockTransactionCount: 4_000,
    commonCount: 3_500,
    candidateOnlyCount: 1_500,
    blockOnlyCount: 500,
    ...comparisonOverrides,
  };
  return snapshotSchema.parse({
    chain: 'bitcoin',
    mode: 'live',
    status: 'ok',
    source: BLOCK_SOURCE,
    observedAt: OBSERVED_AT,
    coverage: 'Bilan complet indépendant du seul détail individuel reçu.',
    pendingCount: 10_000,
    feeRate: 1,
    feeUnit: 'sat/vB',
    transactions: [
      {
        id: '1'.repeat(64),
        chain: 'bitcoin',
        status: 'pending',
        feeRate: 1,
        size: 200,
        kind: 'transfer',
        value: 'Non mesurée',
      },
    ],
    blocks: [
      {
        hash: BLOCK_HASH,
        height: comparison.blockHeight,
        timestamp: OBSERVED_AT / 1_000,
        txCount: comparison.blockTransactionCount + 1,
        used: 900_000,
        capacity: 1_000_000,
      },
    ],
    candidateComparison: comparison,
    inclusions: [],
  });
}

function renderDetails(snapshot: Snapshot | null): string {
  return renderToStaticMarkup(createElement(CandidateComparisonDetails, { snapshot }));
}

describe('complete Bitcoin candidate comparison display', () => {
  it('uses complete counts independently of the individual sample or current candidate', () => {
    const source = observation();
    const display = candidateComparisonDisplay(source);
    expect(source.transactions).toHaveLength(1);
    expect(source.blockTemplate).toBeUndefined();
    expect(display.available).toBe(true);
    expect(display.candidateShare).toBe(70);
    expect(display.value).toBe('70');
    expect(display.categories.map(({ key, count }) => ({ key, count }))).toEqual([
      { key: 'common', count: 3_500 },
      { key: 'candidate-only', count: 1_500 },
      { key: 'block-only', count: 500 },
    ]);
    expect(display.note).toContain('Bilan complet hors coinbase');
    expect(display.note).toContain('indépendant des détails individuels');
    expect(display.note).toContain('pas un score de prédiction');
    expect(display.note).toContain('ne prouve pas qu’une transaction est encore en attente');
    expect(display.note).toContain('Le mineur peut avoir construit un autre candidat');
    expect(display.note).toContain('une réorganisation reste possible');
    expect(source.transactions[0]?.status).toBe('pending');
  });

  it('uses the candidate as percentage denominator and keeps a measured zero', () => {
    const rounded = candidateComparisonDisplay(
      observation({
        candidateTransactionCount: 3,
        blockTransactionCount: 3,
        commonCount: 2,
        candidateOnlyCount: 1,
        blockOnlyCount: 1,
      }),
    );
    expect(rounded.value).toBe('66,7');
    const zero = candidateComparisonDisplay(
      observation({ commonCount: 0, candidateOnlyCount: 5_000, blockOnlyCount: 4_000 }),
    );
    expect(zero.available).toBe(true);
    expect(zero.value).toBe('0');
    expect(zero.candidateShare).toBe(0);
  });

  it('leaves the empty candidate fraction undefined while retaining known zero counts', () => {
    const source = observation({
      candidateTransactionCount: 0,
      commonCount: 0,
      candidateOnlyCount: 0,
      blockOnlyCount: 4_000,
    });
    const display = candidateComparisonDisplay(source);
    expect(display.available).toBe(true);
    expect(display.candidateShare).toBeNull();
    expect(display.value).toBe('—');
    expect(display.categories.map(({ count }) => count)).toEqual([0, 0, 4_000]);
    expect(display.note).toContain('Candidat vide');
    expect(renderDetails(source)).toContain('Part du candidat non définie : candidat vide.');
  });

  it.each([undefined, null])('does not invent counters for an absent comparison (%s)', (value) => {
    const source = { ...observation(), candidateComparison: value };
    expect(candidateComparisonDisplay(source)).toMatchObject({
      available: false,
      comparison: null,
      value: '—',
      candidateShare: null,
      categories: [],
    });
    const html = renderDetails(source);
    expect(html).toContain('En attente d’un bilan');
    expect(html).toContain('Une absence de bilan ne signifie pas zéro');
    expect(html).not.toContain('data-count=');
    expect(html).not.toContain('data-comparison-scope=');
  });

  it.each(['demo', 'ethereum', 'unavailable'] as const)(
    'never shows real comparison counts in %s',
    (condition) => {
      const source = observation();
      const changed: Snapshot = {
        ...source,
        ...(condition === 'demo' ? { mode: 'demo' as const } : {}),
        ...(condition === 'ethereum' ? { chain: 'ethereum' as const } : {}),
        ...(condition === 'unavailable' ? { status: 'unavailable' as const } : {}),
      };
      expect(candidateComparisonDisplay(changed).available).toBe(false);
      expect(renderDetails(changed)).not.toContain('data-count=');
      if (condition === 'demo') {
        expect(renderDetails(changed)).toContain('Démonstration : aucun bilan réel n’est calculé.');
      }
      if (condition === 'ethereum') expect(renderDetails(changed)).toBe('');
    },
  );

  it('preserves original dates and sources on a stale snapshot without redating it', () => {
    const source = observation();
    const stale = { ...source, status: 'stale' as const };
    const display = candidateComparisonDisplay(stale);
    expect(display.available).toBe(true);
    expect(display.stale).toBe(true);
    expect(display.comparison).toBe(source.candidateComparison);
    expect(display.note).toContain('Ancien bilan conservé, avec ses dates d’origine.');
    const html = renderDetails(stale);
    expect(html).toContain('Ancien bilan conservé');
    expect(html).toContain(new Date(OBSERVED_AT - 3_000).toISOString());
    expect(html).toContain(new Date(OBSERVED_AT - 1_000).toISOString());
    expect(stale.observedAt).toBe(OBSERVED_AT);
  });

  it.each([
    { blockHash: 'c'.repeat(64) },
    { parentBlockHash: 'bad' },
    { blockHeight: 900_002 },
    { blockTransactionCount: 3_999 },
    { commonCount: 3_501 },
    { candidateOnlyCount: -1 },
    { candidateTransactionCount: 30_001 },
    { commonCount: Number.NaN },
    { blockObservedAt: OBSERVED_AT + 1 },
    { candidateObservedAt: OBSERVED_AT },
    { candidateObservedAt: -1 },
    { blockObservedAt: Number.POSITIVE_INFINITY },
  ] satisfies Partial<BitcoinCandidateComparison>[])(
    'refuses inconsistent unvalidated comparison metadata %o',
    (invalid) => {
      const source = observation();
      const malformed: Snapshot = {
        ...source,
        candidateComparison: { ...source.candidateComparison!, ...invalid },
      };
      const display = candidateComparisonDisplay(malformed);
      expect(display.available).toBe(false);
      expect(display.value).toBe('—');
      expect(display.categories).toEqual([]);
    },
  );

  it('renders three complete categories, both dated sources and a fixed block explorer link', () => {
    const source = observation();
    const html = renderDetails(source);
    expect(html).toContain('data-testid="candidate-comparison-details"');
    expect(html).toContain('data-comparison-available="true"');
    expect(html).toContain('data-comparison-scope="complete"');
    expect(html).toContain('Comparaison candidat / bloc');
    expect(html).toContain('data-comparison-category="common" data-count="3500"');
    expect(html).toContain('data-comparison-category="candidate-only" data-count="1500"');
    expect(html).toContain('data-comparison-category="block-only" data-count="500"');
    for (const label of [
      'Prévues et incluses',
      'Prévues non incluses dans ce bloc',
      'Incluses hors candidat',
      'Total du candidat',
      'Total du bloc hors coinbase',
      'Source du candidat',
      'Source du bloc',
      'Relevé du candidat',
      'Première détection du bloc',
      CANDIDATE_SOURCE,
      BLOCK_SOURCE,
    ])
      expect(html).toContain(label);
    expect(html).toContain(`<time dateTime="${new Date(OBSERVED_AT - 3_000).toISOString()}">`);
    expect(html).toContain(`<time dateTime="${new Date(OBSERVED_AT - 1_000).toISOString()}">`);
    expect(html).toContain(`href="https://mempool.space/block/${BLOCK_HASH}"`);
    expect(html).not.toContain(source.transactions[0]!.id);
  });

  it('preserves existing navigation positions and appends the provider flow page', () => {
    const source = observation();
    function render(snapshot: Snapshot): string {
      return renderToStaticMarkup(
        createElement(InfoBillboard, {
          snapshot,
          activity: { walking: 0, waiting: 1, returning: 0, boarded: 0 },
          paused: true,
          reducedMotion: true,
          selected: false,
          feeDisplayUnit: 'native',
          theme: 'neutral',
        }),
      );
    }
    const bitcoin = render(source);
    const labels = [...bitcoin.matchAll(/aria-label="Afficher ([^"]+) · Bitcoin"/g)].map(
      (match) => match[1],
    );
    expect(labels).toEqual([
      'mempool',
      'frais',
      'bloc',
      'valeur',
      'voyageurs',
      'comparaison',
      'flux',
    ]);
    expect(bitcoin).toContain('data-page="Mempool"');
    expect(bitcoin).toContain('data-auto-rotating="false"');
    const ethereum = render({ ...source, chain: 'ethereum', candidateComparison: null });
    expect(ethereum).not.toContain('Afficher comparaison');
    expect([...ethereum.matchAll(/aria-label="Afficher ([^"]+) · Ethereum"/g)]).toHaveLength(6);
  });
});
