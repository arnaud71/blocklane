import { describe, expect, it } from 'vitest';
import {
  MAX_TRACKED_TRANSACTIONS,
  bitcoinBlockTemplateSchema,
  snapshotSchema,
  type BitcoinBlockTemplate,
  type Snapshot,
  type Tx,
} from '../../shared/model.js';
import { assessFreshness, nextSnapshotFreshnessDeadline } from '../../src/lib/freshness';

const OBSERVED_AT = 1_700_000_000_000;

function identifier(value: number): string {
  return value.toString(16).padStart(64, '0');
}

function transaction(value: number): Tx {
  return {
    id: identifier(value),
    chain: 'bitcoin',
    feeRate: 20,
    size: 200,
    status: 'pending',
    kind: 'transfer',
    value: 'Montant non fourni',
  };
}

function template(overrides: Partial<BitcoinBlockTemplate> = {}): BitcoinBlockTemplate {
  return {
    source: 'Nœud Bitcoin observé',
    observedAt: OBSERVED_AT - 5_000,
    height: 101,
    previousBlockHash: identifier(100_000),
    transactionCount: 4,
    weight: 80_000,
    weightLimit: 4_000_000,
    selectedTransactionIds: [identifier(11), identifier(12)],
    ...overrides,
  };
}

function observation(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    chain: 'bitcoin',
    mode: 'live',
    status: 'ok',
    source: 'Blocs et comptage du fournisseur',
    observedAt: OBSERVED_AT,
    coverage: 'Sélection partielle du candidat proposé par le nœud observé.',
    pendingCount: 3_000,
    feeRate: 8,
    feeUnit: 'sat/vB',
    transactions: [transaction(11), transaction(12)],
    blocks: [
      {
        hash: identifier(100_000),
        height: 100,
        timestamp: Math.floor(OBSERVED_AT / 1_000),
        txCount: 2_000,
        used: 900_000,
        capacity: 1_000_000,
      },
    ],
    inclusions: [],
    blockTemplate: template(),
    ...overrides,
  };
}

describe('Bitcoin node template public contract', () => {
  it('accepts a partial candidate sample with its own date, full count and independent provider total', () => {
    const parsed = snapshotSchema.parse(observation());
    expect(parsed.blockTemplate).toEqual(template());
    expect(parsed.blockTemplate?.selectedTransactionIds).toHaveLength(2);
    expect(parsed.blockTemplate?.transactionCount).toBe(4);
    expect(parsed.blockTemplate?.observedAt).toBe(OBSERVED_AT - 5_000);
    expect(parsed.pendingCount).toBe(3_000);
    expect(
      parsed.transactions.every((tx) => tx.status === 'pending' && tx.blockHash === undefined),
    ).toBe(true);
    expect(parsed.inclusions).toEqual([]);
    expect(parsed.sampling).toBeUndefined();
  });

  it('accepts omitted legacy medians and full-candidate half-satoshi medians independently of the sample', () => {
    expect(snapshotSchema.parse(observation()).blockTemplate?.medianFeeSats).toBeUndefined();
    for (const medianFeeSats of [0, 100, 100.5, 2_100_000_000_000_000]) {
      const source = observation({ blockTemplate: template({ medianFeeSats }) });
      expect(snapshotSchema.parse(source).blockTemplate?.medianFeeSats).toBe(medianFeeSats);
    }
  });

  it('uses null only for an explicitly empty candidate when the median field is provided', () => {
    const empty = template({
      transactionCount: 0,
      weight: 0,
      selectedTransactionIds: [],
      medianFeeSats: null,
    });
    expect(
      snapshotSchema.safeParse(observation({ transactions: [], blockTemplate: empty })).success,
    ).toBe(true);
    expect(bitcoinBlockTemplateSchema.safeParse({ ...empty, medianFeeSats: 0 }).success).toBe(
      false,
    );
    expect(bitcoinBlockTemplateSchema.safeParse(template({ medianFeeSats: null })).success).toBe(
      false,
    );
  });

  it.each([
    { transactionCount: 0, weight: 1 },
    { transactionCount: 1, weight: 0 },
  ])('rejects an inconsistent complete count/weight pair %j', ({ transactionCount, weight }) => {
    expect(
      bitcoinBlockTemplateSchema.safeParse(
        template({
          transactionCount,
          weight,
          selectedTransactionIds: [],
        }),
      ).success,
    ).toBe(false);
  });

  it('permits half-satoshi medians only when averaging an even number of integer fees', () => {
    expect(
      bitcoinBlockTemplateSchema.safeParse(
        template({
          transactionCount: 3,
          medianFeeSats: 100.5,
        }),
      ).success,
    ).toBe(false);
    expect(
      bitcoinBlockTemplateSchema.safeParse(
        template({
          transactionCount: 2,
          medianFeeSats: 100.5,
        }),
      ).success,
    ).toBe(true);
  });

  it.each([-1, 0.25, Number.NaN, Number.POSITIVE_INFINITY, 2_100_000_000_000_000.5])(
    'rejects invalid complete fee median %s',
    (medianFeeSats) => {
      expect(bitcoinBlockTemplateSchema.safeParse(template({ medianFeeSats })).success).toBe(false);
    },
  );

  it('rejects a complete candidate lighter than its current transactions, preserving legacy vsize rounding', () => {
    const source = observation({ blockTemplate: template({ weight: 1_600 }) });
    expect(snapshotSchema.safeParse(source).success).toBe(true);
    expect(
      snapshotSchema.safeParse({ ...source, blockTemplate: template({ weight: 1_593 }) }).success,
    ).toBe(false);
    // Legacy ceil(weight / 4) sizes may conservatively add up to three WU per row.
    expect(
      snapshotSchema.safeParse({ ...source, blockTemplate: template({ weight: 1_594 }) }).success,
    ).toBe(true);
    const exactQuarter = { ...transaction(11), size: 200.25 };
    expect(
      snapshotSchema.safeParse(
        observation({
          transactions: [exactQuarter],
          blockTemplate: template({ weight: 800, selectedTransactionIds: [exactQuarter.id] }),
        }),
      ).success,
    ).toBe(false);
    expect(
      snapshotSchema.safeParse(
        observation({
          transactions: [exactQuarter],
          blockTemplate: template({ weight: 801, selectedTransactionIds: [exactQuarter.id] }),
        }),
      ).success,
    ).toBe(true);
  });

  it.each([undefined, null])(
    'preserves the existing fallback contract when no template is supplied (%s)',
    (blockTemplate) => {
      expect(snapshotSchema.safeParse(observation({ blockTemplate })).success).toBe(true);
    },
  );

  it('keeps full-pool sampling separate from a node candidate observation', () => {
    const parsed = snapshotSchema.parse(
      observation({
        sampling: {
          method: 'getrawmempool',
          source: 'Inventaire du pool observé',
          observedAt: OBSERVED_AT - 9_000,
          pendingCount: 3_000,
          update: 'full',
        },
      }),
    );
    expect(parsed.blockTemplate?.source).toBe('Nœud Bitcoin observé');
    expect(parsed.sampling?.source).toBe('Inventaire du pool observé');
    expect(parsed.sampling?.observedAt).not.toBe(parsed.blockTemplate?.observedAt);
    expect(parsed.pendingCount).not.toBe(parsed.blockTemplate?.transactionCount);
  });

  it('accepts a dated template retained with coherent stale chain data', () => {
    const parsed = snapshotSchema.parse(observation({ status: 'stale' }));
    expect(parsed.status).toBe('stale');
    expect(parsed.blockTemplate?.observedAt).toBe(OBSERVED_AT - 5_000);
  });

  it('accepts an empty proposed block without inventing pending transactions', () => {
    const parsed = snapshotSchema.parse(
      observation({
        transactions: [],
        blockTemplate: template({ transactionCount: 0, weight: 0, selectedTransactionIds: [] }),
      }),
    );
    expect(parsed.blockTemplate?.transactionCount).toBe(0);
    expect(parsed.transactions).toEqual([]);
    expect(parsed.pendingCount).toBe(3_000);
  });

  it('bounds the complete transaction count and transmitted selection independently', () => {
    const maximum = template({
      source: 'N'.repeat(100),
      transactionCount: 30_000,
      weight: 4_000_000,
      selectedTransactionIds: Array.from({ length: MAX_TRACKED_TRANSACTIONS }, (_, i) =>
        identifier(i),
      ),
    });
    const parsed = snapshotSchema.parse(observation({ blockTemplate: maximum }));
    expect(parsed.blockTemplate?.selectedTransactionIds).toHaveLength(4_096);
    expect(parsed.blockTemplate?.transactionCount).toBe(30_000);
    expect(parsed.transactions).toHaveLength(2);
  });

  it('matches parent and selected identifiers independently of hexadecimal case', () => {
    const parsed = snapshotSchema.parse(
      observation({
        blockTemplate: template({
          previousBlockHash: identifier(100_000).toUpperCase(),
          selectedTransactionIds: [identifier(11).toUpperCase(), identifier(12).toUpperCase()],
        }),
      }),
    );
    expect(parsed.transactions).toHaveLength(2);
  });

  it('does not require confirmed rows to belong to the proposed next block', () => {
    const confirmed = {
      ...transaction(13),
      status: 'confirmed' as const,
      blockHash: identifier(100_000),
    };
    const parsed = snapshotSchema.parse(
      observation({
        transactions: [transaction(11), transaction(12), confirmed],
      }),
    );
    expect(parsed.transactions.at(-1)).toEqual(confirmed);
  });

  it.each([
    ['a different parent', { previousBlockHash: identifier(100_001) }],
    ['a wrong proposed height', { height: 102 }],
    ['a future observation', { observedAt: OBSERVED_AT + 1 }],
    ['an empty source', { source: '' }],
    ['an oversized source', { source: 'N'.repeat(101) }],
    ['a negative observation', { observedAt: -1 }],
    ['a fractional observation', { observedAt: OBSERVED_AT + 0.5 }],
    ['an unsafe height', { height: Number.MAX_SAFE_INTEGER + 1 }],
    ['too many complete transactions', { transactionCount: 30_001 }],
    ['a fractional complete count', { transactionCount: 4.5 }],
    ['a negative complete count', { transactionCount: -1 }],
    ['weight above the declared limit', { weight: 4_000_001 }],
    ['negative transaction weight', { weight: -1 }],
    ['fractional transaction weight', { weight: 8.5 }],
    ['a zero block weight limit', { weightLimit: 0 }],
    ['a block weight limit above Bitcoin capacity', { weightLimit: 4_000_001 }],
    ['a fractional block weight limit', { weightLimit: 4_000_000.5 }],
    ['a malformed parent hash', { previousBlockHash: '0x' + identifier(100_000) }],
    ['a malformed selected hash', { selectedTransactionIds: ['not-a-transaction'] }],
    [
      'duplicate selected hashes',
      { selectedTransactionIds: [identifier(11), identifier(11).toUpperCase()] },
    ],
    ['a selection larger than the complete count', { transactionCount: 1 }],
    ['a pending row outside the selection', { selectedTransactionIds: [identifier(11)] }],
  ] satisfies Array<[string, Partial<BitcoinBlockTemplate>]>)('rejects %s', (_, changes) => {
    expect(
      snapshotSchema.safeParse(observation({ blockTemplate: template(changes) })).success,
    ).toBe(false);
  });

  it('rejects a selected-ID list above its fixed public bound', () => {
    const tooManyIds = template({
      transactionCount: 5_000,
      selectedTransactionIds: Array.from({ length: MAX_TRACKED_TRANSACTIONS + 1 }, (_, i) =>
        identifier(i),
      ),
    });
    expect(bitcoinBlockTemplateSchema.safeParse(tooManyIds).success).toBe(false);
    expect(snapshotSchema.safeParse(observation({ blockTemplate: tooManyIds })).success).toBe(
      false,
    );
  });

  it('rejects a node candidate in demo mode', () => {
    expect(snapshotSchema.safeParse(observation({ mode: 'demo' })).success).toBe(false);
  });

  it('rejects a Bitcoin template attached to Ethereum', () => {
    const bitcoin = observation();
    expect(
      snapshotSchema.safeParse({
        ...bitcoin,
        chain: 'ethereum',
        feeUnit: 'Gwei',
        transactions: bitcoin.transactions.map((tx) => ({ ...tx, chain: 'ethereum' })),
      }).success,
    ).toBe(false);
  });

  it('rejects a template without the observed parent block', () => {
    expect(snapshotSchema.safeParse(observation({ blocks: [] })).success).toBe(false);
  });

  it('rejects candidate data on an unavailable observation even without rows or blocks', () => {
    expect(
      snapshotSchema.safeParse(
        observation({
          status: 'unavailable',
          transactions: [],
          blocks: [],
        }),
      ).success,
    ).toBe(false);
  });

  it('expires only the candidate after thirty seconds while preserving chain, pool and transaction provenance', () => {
    const source = snapshotSchema.parse(
      observation({
        sampling: {
          method: 'getrawmempool',
          source: 'Inventaire du pool observé',
          observedAt: OBSERVED_AT - 9_000,
          pendingCount: 3_000,
          update: 'full',
        },
      }),
    );
    const candidate = source.blockTemplate!;
    expect(assessFreshness(source, false, candidate.observedAt + 30_000)).toBe(source);
    const expired = assessFreshness(source, false, candidate.observedAt + 30_001);
    expect(expired.blockTemplate).toBeNull();
    expect(expired.status).toBe('ok');
    expect(expired.observedAt).toBe(source.observedAt);
    expect(expired.pendingCount).toBe(source.pendingCount);
    expect(expired.transactions).toBe(source.transactions);
    expect(expired.blocks).toBe(source.blocks);
    expect(expired.inclusions).toBe(source.inclusions);
    expect(expired.sampling).toBe(source.sampling);
    expect(expired.message).toContain('Ancien candidat du nœud');
    expect(expired.coverage).toContain('retour à l’estimation');
    expect(source.blockTemplate).toBe(candidate);
    expect(snapshotSchema.safeParse(expired).success).toBe(true);
  });

  it('keeps a failed connection stale without changing its original observation at template expiry', () => {
    const source = snapshotSchema.parse(observation());
    const expired = assessFreshness(source, true, source.blockTemplate!.observedAt + 30_001);
    expect(expired.status).toBe('stale');
    expect(expired.observedAt).toBe(OBSERVED_AT);
    expect(expired.blockTemplate).toBeNull();
    expect(expired.transactions.every((tx) => tx.status === 'pending')).toBe(true);
    expect(snapshotSchema.safeParse(expired).success).toBe(true);
  });

  it('clears candidate, pool sampling and inclusion evidence when the whole observation expires', () => {
    const source = snapshotSchema.parse(
      observation({
        sampling: {
          method: 'getrawmempool',
          source: 'Inventaire du pool observé',
          observedAt: OBSERVED_AT - 9_000,
          pendingCount: 3_000,
          update: 'full',
        },
        inclusions: [{ block: observation().blocks[0]!, transactionIds: [identifier(13)] }],
      }),
    );
    const expired = assessFreshness(source, true, OBSERVED_AT + 120_001);
    expect(expired).toMatchObject({
      status: 'unavailable',
      observedAt: OBSERVED_AT,
      blockTemplate: null,
      sampling: null,
      pendingCount: null,
      transactions: [],
      blocks: [],
      inclusions: [],
    });
    expect(snapshotSchema.safeParse(expired).success).toBe(true);
  });

  it('schedules the candidate boundary before the independent chain boundary without a polling interval', () => {
    const source = snapshotSchema.parse(observation());
    const candidateDeadline = source.blockTemplate!.observedAt + 30_001;
    const chainDeadline = source.observedAt + 120_001;
    expect(nextSnapshotFreshnessDeadline(source, OBSERVED_AT)).toBe(candidateDeadline);
    expect(nextSnapshotFreshnessDeadline(source, candidateDeadline)).toBe(chainDeadline);
    expect(nextSnapshotFreshnessDeadline(source, chainDeadline)).toBeNull();
    expect(nextSnapshotFreshnessDeadline(observation({ blockTemplate: null }), OBSERVED_AT)).toBe(
      chainDeadline,
    );
    expect(
      nextSnapshotFreshnessDeadline({ ...source, mode: 'demo', blockTemplate: null }, OBSERVED_AT),
    ).toBeNull();
  });
});
