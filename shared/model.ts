import { z } from 'zod';

export const chainIdSchema = z.enum(['bitcoin', 'ethereum']);
export type ChainId = z.infer<typeof chainIdSchema>;

export const MAX_TRACKED_TRANSACTIONS = 2_048;
export const TRACKED_TRANSACTION_TTL_MS = 30 * 60 * 1_000;
export const MAX_INCLUSION_BLOCKS = 16;
export const MAX_CATCHUP_BLOCKS = 8;

const finiteNonnegative = z.number().finite().nonnegative();
const safeNonnegativeInteger = z.number().int().nonnegative().safe();

export const usdQuoteSchema = z.object({
  usdPerCoin: z.number().finite().positive().max(1_000_000_000),
  /** Receipt time in Unix milliseconds; this is not the time of a market trade. */
  observedAt: safeNonnegativeInteger,
  source: z.literal('Coinbase'),
  status: z.enum(['ok', 'stale']),
});
export type UsdQuote = z.infer<typeof usdQuoteSchema>;

/** Counts from the observed Ethereum provider's local pool, never a global total. */
export const ethereumMempoolSchema = z
  .object({
    pending: safeNonnegativeInteger,
    queued: safeNonnegativeInteger,
    /** Receipt time in Unix milliseconds, independent of the block observation. */
    observedAt: safeNonnegativeInteger,
    status: z.enum(['ok', 'stale']),
    method: z.literal('txpool_status'),
  })
  .refine((pool) => Number.isSafeInteger(pool.pending + pool.queued), {
    message: 'The local transaction pool total exceeds the safe integer limit',
  });
export type EthereumMempool = z.infer<typeof ethereumMempoolSchema>;

export const transactionSchema = z
  .object({
    id: z.string().min(1).max(128),
    chain: chainIdSchema,
    feeRate: finiteNonnegative,
    size: finiteNonnegative,
    status: z.enum(['pending', 'confirmed']),
    /** Inclusion evidence from the provider, never inferred from an animation. */
    blockHash: z.string().min(1).max(128).optional(),
    kind: z.enum(['transfer', 'contract']),
    value: z.string().max(100),
  })
  .superRefine((transaction, context) => {
    if (transaction.status === 'pending' && transaction.blockHash !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['blockHash'],
        message: 'Pending transactions cannot carry block inclusion evidence',
      });
    }
  });
export type Tx = z.infer<typeof transactionSchema>;

export const blockSchema = z
  .object({
    height: safeNonnegativeInteger,
    hash: z.string().min(1).max(128),
    /** Unix timestamp in seconds, matching the upstream chain protocols. */
    timestamp: safeNonnegativeInteger.max(32_503_680_000),
    txCount: safeNonnegativeInteger,
    /** Bitcoin: virtual bytes. Ethereum: gas. */
    used: finiteNonnegative,
    capacity: z.number().finite().positive(),
  })
  .refine((block) => block.used <= block.capacity, {
    message: 'Block utilization exceeds its declared capacity',
  });
export type Block = z.infer<typeof blockSchema>;

export const blockInclusionsSchema = z
  .object({
    block: blockSchema,
    /** Previously observed IDs whose inclusion was verified in this exact block. */
    transactionIds: z.array(z.string().min(1).max(128)).max(MAX_TRACKED_TRANSACTIONS),
  })
  .superRefine((inclusions, context) => {
    const ids = inclusions.transactionIds.map((id) => id.toLowerCase());
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        path: ['transactionIds'],
        message: 'Block inclusion identifiers must be unique',
      });
    }
  });
export type BlockInclusions = z.infer<typeof blockInclusionsSchema>;

export const snapshotSchema = z
  .object({
    chain: chainIdSchema,
    mode: z.enum(['demo', 'live']),
    status: z.enum(['ok', 'stale', 'unavailable']),
    source: z.string().min(1).max(100),
    /** Unix timestamp in milliseconds; stale snapshots retain their original time. */
    observedAt: safeNonnegativeInteger,
    coverage: z.string().min(1).max(700),
    /** Observed provider's local pool total; null when no total is available. */
    pendingCount: safeNonnegativeInteger.nullable(),
    /** Optional Ethereum local pool breakdown with its own observation time. */
    mempool: ethereumMempoolSchema.nullable().optional(),
    feeRate: finiteNonnegative.nullable(),
    feeUnit: z.enum(['sat/vB', 'Gwei']),
    /** Optional market conversion; its availability is independent of chain data. */
    usdQuote: usdQuoteSchema.nullable().optional(),
    transactions: z.array(transactionSchema).max(120),
    blocks: z.array(blockSchema).max(3),
    /** Bounded replay journal; its historical blocks need not appear in blocks. */
    inclusions: z.array(blockInclusionsSchema).max(MAX_INCLUSION_BLOCKS).optional(),
    message: z.string().max(700).optional(),
  })
  .superRefine((snapshot, context) => {
    if (snapshot.transactions.some((tx) => tx.chain !== snapshot.chain)) {
      context.addIssue({
        code: 'custom',
        message: 'Transactions must belong to the snapshot chain',
      });
    }
    if ((snapshot.chain === 'bitcoin') !== (snapshot.feeUnit === 'sat/vB')) {
      context.addIssue({ code: 'custom', message: 'Fee unit does not match the chain' });
    }
    if (snapshot.mode === 'demo' && snapshot.status !== 'ok') {
      context.addIssue({
        code: 'custom',
        message: 'A demo cannot represent upstream availability',
      });
    }
    if (snapshot.mode === 'demo' && snapshot.usdQuote != null) {
      context.addIssue({
        code: 'custom',
        path: ['usdQuote'],
        message: 'Demonstration snapshots cannot carry a live market quote',
      });
    }
    if (snapshot.mempool != null) {
      if (snapshot.chain !== 'ethereum' || snapshot.mode !== 'live') {
        context.addIssue({
          code: 'custom',
          path: ['mempool'],
          message: 'A txpool_status observation must belong to live Ethereum data',
        });
      }
      if (snapshot.pendingCount !== snapshot.mempool.pending + snapshot.mempool.queued) {
        context.addIssue({
          code: 'custom',
          path: ['pendingCount'],
          message: 'The local pool total must match its pending and queued counts',
        });
      }
    }
    if (
      snapshot.mode === 'live' &&
      (snapshot.transactions.some(
        (tx) => tx.id.startsWith('demo-') || tx.blockHash?.startsWith('demo-'),
      ) ||
        snapshot.blocks.some((block) => block.hash.startsWith('demo-')) ||
        snapshot.inclusions?.some(
          (inclusion) =>
            inclusion.block.hash.startsWith('demo-') ||
            inclusion.transactionIds.some((id) => id.startsWith('demo-')),
        ))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Synthetic demo identifiers cannot be used as live data',
      });
    }
    const inclusions = snapshot.inclusions ?? [];
    if (
      inclusions.reduce((count, inclusion) => count + inclusion.transactionIds.length, 0) >
      MAX_TRACKED_TRANSACTIONS
    ) {
      context.addIssue({
        code: 'custom',
        path: ['inclusions'],
        message: 'The inclusion journal exceeds its tracked identifier limit',
      });
    }
    const hashes = inclusions.map((inclusion) => inclusion.block.hash.toLowerCase());
    if (new Set(hashes).size !== hashes.length) {
      context.addIssue({
        code: 'custom',
        path: ['inclusions'],
        message: 'The inclusion journal must contain unique block hashes',
      });
    }
    const heights = inclusions.map((inclusion) => inclusion.block.height);
    if (new Set(heights).size !== heights.length) {
      context.addIssue({
        code: 'custom',
        path: ['inclusions'],
        message: 'The inclusion journal must contain unique block heights',
      });
    }
    inclusions.forEach((inclusion, index) => {
      const displayedBlock = snapshot.blocks.find(
        (block) => block.height === inclusion.block.height,
      );
      if (
        displayedBlock &&
        displayedBlock.hash.toLowerCase() !== inclusion.block.hash.toLowerCase()
      ) {
        context.addIssue({
          code: 'custom',
          path: ['inclusions', index, 'block', 'hash'],
          message: 'Inclusion journal and displayed block disagree at the same height',
        });
      }
    });
    if (snapshot.mode === 'live') {
      const identifierPattern =
        snapshot.chain === 'bitcoin' ? /^[a-fA-F0-9]{64}$/ : /^0x[a-fA-F0-9]{64}$/;
      inclusions.forEach((inclusion, index) => {
        if (!identifierPattern.test(inclusion.block.hash)) {
          context.addIssue({
            code: 'custom',
            path: ['inclusions', index, 'block', 'hash'],
            message: 'Inclusion block hash does not match the chain format',
          });
        }
        inclusion.transactionIds.forEach((id, transactionIndex) => {
          if (!identifierPattern.test(id)) {
            context.addIssue({
              code: 'custom',
              path: ['inclusions', index, 'transactionIds', transactionIndex],
              message: 'Inclusion transaction identifier does not match the chain format',
            });
          }
        });
      });
    }
    if (
      snapshot.status === 'unavailable' &&
      (snapshot.transactions.length ||
        snapshot.blocks.length ||
        inclusions.length ||
        snapshot.mempool != null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Unavailable snapshots cannot display fabricated live data',
      });
    }
  });
export type Snapshot = z.infer<typeof snapshotSchema>;

export const MAX_TRANSACTIONS = 120;
export const MAX_BLOCKS = 3;
