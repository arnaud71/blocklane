import { describe, expect, it, vi } from 'vitest';
import { snapshotSchema, transactionSchema, type Snapshot } from '../../shared/model.js';
import {
  tokenActivitySchema,
  tokenAmountSchema,
  tokenBlockTransfersSchema,
} from '../../shared/tokenContracts.js';
import { generateDemoSnapshot } from '../../server/demo.js';
import { SnapshotService } from '../../server/cache.js';
import { assessFreshness } from '../../src/lib/freshness.js';
import { formatTokenAmount } from '../../src/lib/tokenDisplay.js';
import { config, liveSnapshot, now } from './fixtures.js';

const intent = {
  tokenId: 'usdt',
  operation: 'transfer',
  evidence: 'call',
  amount: '1234567',
} as const;
function observation(): Snapshot {
  const source = liveSnapshot('ethereum');
  return snapshotSchema.parse({
    ...source,
    transactions: [{ ...source.transactions[12]!, kind: 'contract', tokens: [intent] }],
    tokenTransfers: [
      {
        tokenId: 'usdt',
        blockHash: source.blocks[0]!.hash,
        blockHeight: source.blocks[0]!.height,
        source: 'Controlled complete logs',
        observedAt: now - 500,
        method: 'eth_getLogs',
        transactionCount: 1,
        transferCount: 2,
        amount: '1234567890123456789012345',
      },
    ],
  });
}

describe('token amounts and evidence contract', () => {
  it.each(['-1', '01', '1.1', '', 'NaN', '1e6', 'x'.repeat(84), '9'.repeat(84)])(
    'rejects malformed base units without throwing: %s',
    (amount) => {
      expect(() => tokenAmountSchema.safeParse(amount)).not.toThrow();
      expect(tokenAmountSchema.safeParse(amount).success).toBe(false);
      expect(() => tokenActivitySchema.safeParse({ ...intent, amount })).not.toThrow();
      expect(tokenActivitySchema.safeParse({ ...intent, amount }).success).toBe(false);
    },
  );
  it('preserves exact uint256 values and multi-event sums beyond Number precision', () => {
    const maximum = (1n << 256n) - 1n;
    expect(tokenActivitySchema.safeParse({ ...intent, amount: maximum.toString() }).success).toBe(
      true,
    );
    expect(
      tokenActivitySchema.safeParse({ ...intent, amount: (maximum + 1n).toString() }).success,
    ).toBe(false);
    const logged = {
      ...intent,
      evidence: 'log',
      observedAt: now,
      transferCount: 2,
      amount: (maximum * 2n).toString(),
    };
    expect(tokenActivitySchema.safeParse(logged).success).toBe(true);
    expect(tokenActivitySchema.safeParse({ ...logged, transferCount: 1 }).success).toBe(false);
    expect(formatTokenAmount('1234567890123456789012345', 'en')).toBe(
      '1,234,567,890,123,456,789.012345',
    );
    expect(formatTokenAmount('1', 'en')).toBe('0.000001');
    expect(formatTokenAmount('0', 'en')).toBe('0');
  });
  it('requires separate call intent, approval and execution evidence', () => {
    for (const invalid of [
      { ...intent, amount: undefined },
      { ...intent, tokenId: 'fake' },
      { ...intent, transferCount: 1 },
      { ...intent, observedAt: now },
      { ...intent, operation: 'interaction' },
      { ...intent, evidence: 'log' },
      { ...intent, evidence: 'log', transferCount: 1 },
      { ...intent, evidence: 'log', transferCount: 1, observedAt: Number.MAX_SAFE_INTEGER },
    ])
      expect(tokenActivitySchema.safeParse(invalid).success).toBe(false);
    expect(tokenActivitySchema.safeParse({ ...intent, operation: 'approval' }).success).toBe(true);
    expect(
      tokenActivitySchema.safeParse({ ...intent, operation: 'interaction', amount: undefined })
        .success,
    ).toBe(true);
    const tx = observation().transactions[0]!;
    expect(transactionSchema.safeParse({ ...tx, chain: 'bitcoin' }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...tx, tokens: [intent, intent] }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...tx, kind: 'transfer' }).success).toBe(false);
    const tokens = [{ ...intent, evidence: 'log', transferCount: 1, observedAt: now }];
    expect(transactionSchema.safeParse({ ...tx, tokens }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...tx, tokens, status: 'confirmed' }).success).toBe(false);
    expect(
      transactionSchema.safeParse({
        ...tx,
        tokens,
        status: 'confirmed',
        blockHash: observation().blocks[0]!.hash,
      }).success,
    ).toBe(true);
  });
  it('distinguishes verified zero from unavailable and bounds aggregate counts', () => {
    const report = observation().tokenTransfers![0]!;
    expect(
      tokenBlockTransfersSchema.safeParse({
        ...report,
        transactionCount: 0,
        transferCount: 0,
        amount: '0',
      }).success,
    ).toBe(true);
    for (const change of [
      { transactionCount: 3 },
      { transferCount: 0 },
      { transactionCount: 0 },
      { transferCount: 4097 },
      { amount: '-1' },
      { amount: ((1n << 256n) * 3n).toString() },
    ])
      expect(tokenBlockTransfersSchema.safeParse({ ...report, ...change }).success).toBe(false);
  });
  it('binds complete totals to the latest block, source time and mode', () => {
    const source = observation();
    const report = source.tokenTransfers![0]!;
    for (const change of [
      { blockHash: `0x${'f'.repeat(64)}` },
      { blockHeight: report.blockHeight + 1 },
      { observedAt: now + 1 },
      { method: 'simulation' },
      { source: '' },
      { transactionCount: source.blocks[0]!.txCount + 1, transferCount: 4096 },
    ])
      expect(
        snapshotSchema.safeParse({ ...source, tokenTransfers: [{ ...report, ...change }] }).success,
      ).toBe(false);
    expect(snapshotSchema.safeParse({ ...source, tokenTransfers: [report, report] }).success).toBe(
      false,
    );
    expect(snapshotSchema.safeParse({ ...source, tokenTransfers: null }).success).toBe(true);
    const tx = source.transactions[0]!;
    expect(
      snapshotSchema.safeParse({
        ...source,
        transactions: [{ ...tx, tokens: [{ ...intent, evidence: 'demo' }] }],
      }).success,
    ).toBe(false);
    expect(
      snapshotSchema.safeParse({
        ...source,
        transactions: [
          {
            ...tx,
            status: 'confirmed',
            blockHash: report.blockHash,
            tokens: [{ ...intent, evidence: 'log', transferCount: 1, observedAt: now + 1 }],
          },
        ],
      }).success,
    ).toBe(false);
  });
  it('rejects complete totals contradicted by sampled executed transfers', () => {
    const source = observation();
    const report = source.tokenTransfers![0]!;
    const transaction = {
      ...source.transactions[0]!,
      status: 'confirmed',
      blockHash: report.blockHash,
      tokens: [{ ...intent, evidence: 'log', transferCount: 2, observedAt: now }],
    };
    expect(snapshotSchema.safeParse({ ...source, transactions: [transaction] }).success).toBe(true);
    for (const change of [
      { transactionCount: 0, transferCount: 0, amount: '0' },
      { transferCount: 1 },
      { amount: '1' },
    ])
      expect(
        snapshotSchema.safeParse({
          ...source,
          transactions: [transaction],
          tokenTransfers: [{ ...report, ...change }],
        }).success,
      ).toBe(false);
    expect(() =>
      snapshotSchema.safeParse({
        ...source,
        transactions: [{ ...transaction, tokens: [{ ...transaction.tokens[0], amount: 'bad' }] }],
      }),
    ).not.toThrow();
  });
});

describe('token demo isolation and freshness', () => {
  it('adds repeatable explicitly fictional token data only to requested Ethereum demos', async () => {
    const demo = generateDemoSnapshot('ethereum', now, 42, { includeTokens: true });
    expect(demo).toEqual(generateDemoSnapshot('ethereum', now, 42, { includeTokens: true }));
    expect(demo.transactions.some((tx) => tx.tokens?.[0]?.evidence === 'demo')).toBe(true);
    expect(demo.tokenTransfers![0]).toMatchObject({
      method: 'simulation',
      transferCount: 1,
      transactionCount: 1,
      amount: '9876536',
    });
    expect(generateDemoSnapshot('ethereum', now).tokenTransfers).toBeUndefined();
    expect(
      generateDemoSnapshot('bitcoin', now, 42, { includeTokens: true }).transactions.some(
        (tx) => tx.tokens,
      ),
    ).toBe(false);
    const provider = vi.fn(async () => liveSnapshot('ethereum'));
    const service = new SnapshotService({
      config,
      now: () => now,
      providers: { bitcoin: provider, ethereum: provider },
    });
    expect((await service.get('ethereum', 'demo')).tokenTransfers![0]!.method).toBe('simulation');
    expect(provider).not.toHaveBeenCalled();
    const live = await service.get('ethereum', 'live');
    expect(live.tokenTransfers).toBeUndefined();
    expect(live.transactions.some((tx) => tx.tokens)).toBe(false);
    service.dispose();
  });
  it('retains exact-head log time on fresh headers, marks failures stale and clears expired/future proof', () => {
    const source = observation();
    const older = {
      ...source,
      tokenTransfers: source.tokenTransfers!.map((report) => ({
        ...report,
        observedAt: now - 180_000,
      })),
    };
    expect(assessFreshness(older, false, now)).toBe(older);
    const stale = assessFreshness(source, true, now + 3000);
    expect(stale.status).toBe('stale');
    expect(stale.tokenTransfers).toBe(source.tokenTransfers);
    const expired = assessFreshness(source, false, now + 120_001);
    expect(expired.status).toBe('unavailable');
    expect(expired.tokenTransfers).toBeNull();
    expect(snapshotSchema.safeParse(expired).success).toBe(true);
    expect(assessFreshness(source, false, now - 501).tokenTransfers).toBeNull();
  });
});
