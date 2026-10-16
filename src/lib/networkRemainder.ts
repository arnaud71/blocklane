import type { Block, ChainId, Tx } from '../../shared/model';

export interface ConfirmedBlockRemainder {
  /** Ordinary transactions; Bitcoin's coinbase has no mempool passenger. */
  transactionCount: number;
  individualCount: number;
  groupedCount: number;
}

/** Aggregate only: an unknown hash never becomes an invented transaction. */
export function confirmedBlockRemainder(
  chain: ChainId,
  block: Block | null | undefined,
  transactions: readonly Tx[],
): ConfirmedBlockRemainder | null {
  if (!block || !Number.isSafeInteger(block.txCount) || block.txCount < 0) return null;
  const transactionCount = block.txCount - (chain === 'bitcoin' ? 1 : 0);
  if (transactionCount < 0) return null;
  const blockHash = block.hash.toLowerCase();
  const individuals = new Set(
    transactions
      .filter(
        (tx) =>
          tx.chain === chain &&
          tx.status === 'confirmed' &&
          tx.blockHash?.toLowerCase() === blockHash,
      )
      .map((tx) => tx.id.toLowerCase()),
  );
  // Contradictory aggregates do not justify a made-up remainder.
  if (individuals.size > transactionCount) return null;
  return {
    transactionCount,
    individualCount: individuals.size,
    groupedCount: transactionCount - individuals.size,
  };
}
