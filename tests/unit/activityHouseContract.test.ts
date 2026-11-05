import { describe, expect, it } from 'vitest';
import { snapshotSchema, transactionSchema, type Snapshot } from '../../shared/model.js';
import {
  protocolActivitySchema,
  protocolBlockCallsSchema,
  PROTOCOL_CONTRACTS,
} from '../../shared/protocolContracts.js';
import { TOKEN_CONTRACTS } from '../../shared/tokenContracts.js';
import {
  HOUSE_IDS,
  hasHouseActivity,
  primaryHouseId,
  transactionHouseIds,
} from '../../shared/activityHouses.js';
import { generateDemoSnapshot } from '../../server/demo.js';
import { assessFreshness } from '../../src/lib/freshness.js';
import { liveSnapshot, now } from './fixtures.js';

function observed(): Snapshot {
  const original = liveSnapshot('ethereum');
  const block = original.blocks[0]!;
  return snapshotSchema.parse({
    ...original,
    transactions: [
      {
        ...original.transactions[0]!,
        kind: 'contract',
        tokens: [
          {
            tokenId: 'usdt',
            operation: 'transfer',
            evidence: 'log',
            amount: '1000000',
            transferCount: 1,
            observedAt: now,
          },
          {
            tokenId: 'usdc',
            operation: 'transfer',
            evidence: 'log',
            amount: '2000000',
            transferCount: 1,
            observedAt: now,
          },
        ],
        protocols: [{ protocolId: 'uniswap', operation: 'execute', evidence: 'call' }],
      },
    ],
    protocolCalls: [
      {
        protocolId: 'uniswap',
        blockHash: block.hash,
        blockHeight: block.height,
        source: 'Complete block fixture',
        observedAt: now,
        method: 'block-calls',
        transactionCount: 1,
      },
    ],
  });
}

describe('reviewed activity categories', () => {
  it('recognizes multiple memberships without creating duplicate identities or unstable origins', () => {
    const snapshot = observed();
    expect(snapshot.transactions).toHaveLength(1);
    const tx = snapshot.transactions[0]!;
    expect(transactionHouseIds(tx)).toEqual(['usdt', 'usdc', 'uniswap']);
    expect(primaryHouseId(tx)).toBe('uniswap');
    expect(hasHouseActivity(tx, 'aave')).toBe(false);
    expect(primaryHouseId({ tokens: tx.tokens })).toBe('usdt');
    expect(primaryHouseId({})).toBeUndefined();
    expect(HOUSE_IDS).toHaveLength(4);
    const addresses = [
      ...Object.values(TOKEN_CONTRACTS).map((token) => token.address),
      ...Object.values(PROTOCOL_CONTRACTS).flatMap((protocol) => [...protocol.addresses]),
    ];
    expect(addresses.every((address) => /^0x[0-9a-f]{40}$/.test(address))).toBe(true);
    expect(new Set(addresses).size).toBe(addresses.length);
  });
  it('requires Ethereum contract metadata and unique categories', () => {
    const tx = observed().transactions[0]!;
    for (const change of [
      { chain: 'bitcoin' },
      { kind: 'transfer' },
      { protocols: [...tx.protocols!, ...tx.protocols!] },
      { tokens: [...tx.tokens!, tx.tokens![1]!] },
    ])
      expect(transactionSchema.safeParse({ ...tx, ...change }).success).toBe(false);
    for (const invalid of [
      { protocolId: 'fake', operation: 'interaction', evidence: 'call' },
      { protocolId: 'uniswap', operation: 'supply', evidence: 'call' },
      { protocolId: 'aave', operation: 'execute', evidence: 'call' },
      { protocolId: 'uniswap', operation: 'execute', evidence: 'log' },
      { protocolId: 'aave', operation: 'supply', evidence: 'success' },
    ])
      expect(protocolActivitySchema.safeParse(invalid).success).toBe(false);
  });
  it('keeps included-call reports separate from successful execution and exact token totals', () => {
    const snapshot = observed();
    const report = snapshot.protocolCalls![0]!;
    expect(protocolBlockCallsSchema.safeParse({ ...report, transactionCount: 0 }).success).toBe(
      true,
    );
    for (const change of [
      { transactionCount: -1 },
      { transactionCount: 50001 },
      { source: '' },
      { observedAt: Number.MAX_SAFE_INTEGER },
      { method: 'eth_getLogs' },
    ])
      expect(protocolBlockCallsSchema.safeParse({ ...report, ...change }).success).toBe(false);
    expect(protocolBlockCallsSchema.parse({ ...report, success: true })).not.toHaveProperty(
      'success',
    );
    expect(snapshotSchema.safeParse({ ...snapshot, protocolCalls: null }).success).toBe(true);
  });
  it('ties reports to the exact current head, observed time and complete block count', () => {
    const source = observed();
    const report = source.protocolCalls![0]!;
    for (const change of [
      { blockHash: source.blocks[1]!.hash },
      { blockHeight: report.blockHeight + 1 },
      { observedAt: now + 1 },
      { method: 'simulation' },
      { transactionCount: 0 },
      { transactionCount: source.blocks[0]!.txCount + 1 },
    ])
      expect(
        snapshotSchema.safeParse({ ...source, protocolCalls: [{ ...report, ...change }] }).success,
      ).toBe(false);
    expect(snapshotSchema.safeParse({ ...source, protocolCalls: [report, report] }).success).toBe(
      false,
    );
    expect(
      snapshotSchema.safeParse({
        ...source,
        transactions: [],
        blocks: [],
        status: 'unavailable',
        pendingCount: null,
        feeRate: null,
      }).success,
    ).toBe(false);
  });
  it('rejects mutually incompatible direct destinations and combined full-block overcounts', () => {
    const source = observed();
    const tx = source.transactions[0]!;
    expect(
      transactionSchema.safeParse({
        ...tx,
        protocols: [
          ...tx.protocols!,
          { protocolId: 'aave', operation: 'supply', evidence: 'call' },
        ],
      }).success,
    ).toBe(false);
    const report = source.protocolCalls![0]!;
    const singleTransactionBlock = { ...source.blocks[0]!, txCount: 1 };
    const reports = [report, { ...report, protocolId: 'aave' }];
    expect(
      snapshotSchema.safeParse({
        ...source,
        blocks: [singleTransactionBlock],
        protocolCalls: reports,
      }).success,
    ).toBe(false);
    expect(
      snapshotSchema.safeParse({
        ...source,
        blocks: [singleTransactionBlock],
        protocolCalls: [report, { ...report, protocolId: 'aave', transactionCount: 0 }],
      }).success,
    ).toBe(true);
  });
  it('separates fictional categories from live evidence without polluting generic fixtures', () => {
    const source = observed();
    const tx = source.transactions[0]!;
    expect(
      snapshotSchema.safeParse({
        ...source,
        transactions: [
          {
            ...tx,
            protocols: tx.protocols!.map((activity) => ({ ...activity, evidence: 'demo' })),
          },
        ],
      }).success,
    ).toBe(false);
    const demo = generateDemoSnapshot('ethereum', now, 42, { includeTokens: true });
    for (const id of HOUSE_IDS)
      expect(demo.transactions.some((transaction) => hasHouseActivity(transaction, id))).toBe(true);
    expect(
      demo.transactions.every(
        (transaction) =>
          transaction.protocols?.every((activity) => activity.evidence === 'demo') ?? true,
      ),
    ).toBe(true);
    expect(demo.tokenTransfers?.map((report) => report.tokenId)).toEqual(['usdt', 'usdc']);
    expect(demo.protocolCalls?.map((report) => report.protocolId)).toEqual(['uniswap', 'aave']);
    expect(generateDemoSnapshot('ethereum', now).protocolCalls).toBeUndefined();
    expect(
      generateDemoSnapshot('bitcoin', now, 42, { includeTokens: true }).transactions.every(
        (transaction) => !transaction.protocols && !transaction.tokens,
      ),
    ).toBe(true);
  });
  it('retains original protocol evidence on stale data and clears unavailable or future reports', () => {
    const source = observed();
    const aged = assessFreshness(source, true, now + 3000);
    expect(aged.status).toBe('stale');
    expect(aged.protocolCalls).toBe(source.protocolCalls);
    const expired = assessFreshness(source, false, now + 120001);
    expect(expired.protocolCalls).toBeNull();
    expect(expired.tokenTransfers).toBeNull();
    expect(snapshotSchema.safeParse(expired).success).toBe(true);
    expect(assessFreshness(source, false, now - 1).protocolCalls).toBeNull();
  });
});
