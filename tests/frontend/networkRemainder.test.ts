import { describe, expect, it } from 'vitest';
import type { Block, ChainId, Tx } from '../../shared/model';
import { confirmedBlockRemainder } from '../../src/lib/networkRemainder';

const block: Block = {
  hash: 'a'.repeat(64),
  height: 100,
  timestamp: 1_700_000_000,
  txCount: 4,
  used: 900_000,
  capacity: 1_000_000,
};

function transaction(id: number, chain: ChainId = 'bitcoin'): Tx {
  return {
    id: id.toString(16).padStart(64, '0'),
    chain,
    status: 'confirmed',
    blockHash: block.hash,
    feeRate: 20,
    size: 200,
    kind: 'transfer',
    value: 'Valeur non fournie',
  };
}

describe('Confirmed block remainder', () => {
  it('counts only exact same-block individuals and excludes the Bitcoin coinbase', () => {
    const included = transaction(0xabc);
    const transactions: Tx[] = [
      included,
      { ...included, id: included.id.toUpperCase(), blockHash: block.hash.toUpperCase() },
      { ...transaction(2), status: 'pending' },
      { ...transaction(3), blockHash: 'b'.repeat(64) },
      { ...transaction(4), blockHash: undefined },
      transaction(5, 'ethereum'),
    ];
    expect(confirmedBlockRemainder('bitcoin', block, transactions)).toEqual({
      transactionCount: 3,
      individualCount: 1,
      groupedCount: 2,
    });
    expect(transactions).toHaveLength(6);
  });

  it('uses all Ethereum block transactions without inferring gas usage from the sample', () => {
    const ethereumBlock = { ...block, txCount: 3, used: 100_000, capacity: 60_000_000 };
    expect(
      confirmedBlockRemainder('ethereum', ethereumBlock, [transaction(1, 'ethereum')]),
    ).toEqual({
      transactionCount: 3,
      individualCount: 1,
      groupedCount: 2,
    });
    expect(ethereumBlock.used).toBe(100_000);
  });

  it('keeps an unindividualized block as an aggregate without manufacturing identities', () => {
    expect(confirmedBlockRemainder('ethereum', block, [])).toEqual({
      transactionCount: 4,
      individualCount: 0,
      groupedCount: 4,
    });
    expect(confirmedBlockRemainder('bitcoin', { ...block, txCount: 1 }, [])).toEqual({
      transactionCount: 0,
      individualCount: 0,
      groupedCount: 0,
    });
  });

  it('leaves no remainder when every ordinary transaction has a unique individual', () => {
    expect(
      confirmedBlockRemainder(
        'bitcoin',
        block,
        [1, 2, 3].map((id) => transaction(id)),
      ),
    ).toEqual({
      transactionCount: 3,
      individualCount: 3,
      groupedCount: 0,
    });
  });

  it('refuses missing or contradictory block totals instead of clamping them into a false count', () => {
    expect(confirmedBlockRemainder('bitcoin', null, [])).toBeNull();
    expect(confirmedBlockRemainder('bitcoin', { ...block, txCount: 0 }, [])).toBeNull();
    expect(confirmedBlockRemainder('ethereum', { ...block, txCount: -1 }, [])).toBeNull();
    expect(confirmedBlockRemainder('ethereum', { ...block, txCount: 1.5 }, [])).toBeNull();
    expect(
      confirmedBlockRemainder('bitcoin', { ...block, txCount: 1 }, [transaction(1)]),
    ).toBeNull();
  });
});
