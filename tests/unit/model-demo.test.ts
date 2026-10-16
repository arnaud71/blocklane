import { describe, expect, it } from 'vitest';
import { MAX_TRANSACTIONS, PENDING_SAMPLE_LIMIT, snapshotSchema } from '../../shared/model.js';
import { generateDemoSnapshot } from '../../server/demo.js';
import { now } from './fixtures.js';

describe('shared snapshot contract and demo isolation', () => {
  it('generates reproducible bounded fictional data with explicit identifiers', () => {
    const bitcoin = generateDemoSnapshot('bitcoin', now, 42);
    expect(bitcoin).toEqual(generateDemoSnapshot('bitcoin', now, 42));
    expect(bitcoin).not.toEqual(generateDemoSnapshot('bitcoin', now, 43));
    expect(bitcoin.mode).toBe('demo');
    expect(bitcoin.source).toContain('fictives');
    expect(bitcoin.transactions.every((tx) => tx.id.startsWith('demo-btc-'))).toBe(true);
    expect(bitcoin.transactions.length).toBeLessThanOrEqual(MAX_TRANSACTIONS);
    expect(bitcoin.transactions.filter((tx) => tx.status === 'pending')).toHaveLength(
      PENDING_SAMPLE_LIMIT,
    );
    expect(bitcoin.blocks).toHaveLength(3);
    expect(snapshotSchema.safeParse(bitcoin).success).toBe(true);
  });

  it('enforces chain consistency, fee units, and honest availability', () => {
    const demo = generateDemoSnapshot('ethereum', now);
    expect(snapshotSchema.safeParse({ ...demo, feeUnit: 'sat/vB' }).success).toBe(false);
    expect(snapshotSchema.safeParse({ ...demo, chain: 'bitcoin' }).success).toBe(false);
    expect(snapshotSchema.safeParse({ ...demo, mode: 'live' }).success).toBe(false);
    expect(snapshotSchema.safeParse({ ...demo, status: 'unavailable' }).success).toBe(false);
    expect(snapshotSchema.safeParse({ ...demo, feeRate: Infinity }).success).toBe(false);
    expect(
      snapshotSchema.safeParse({ ...demo, blocks: [{ ...demo.blocks[0], used: 999_999_999 }] })
        .success,
    ).toBe(false);
  });
});
