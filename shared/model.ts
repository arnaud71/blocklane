import { z } from 'zod';

export const chainIdSchema = z.enum(['bitcoin', 'ethereum']);
export type ChainId = z.infer<typeof chainIdSchema>;

const finiteNonnegative = z.number().finite().nonnegative();
const safeNonnegativeInteger = z.number().int().nonnegative().safe();

export const transactionSchema = z.object({
  id: z.string().min(1).max(128),
  chain: chainIdSchema,
  feeRate: finiteNonnegative,
  size: finiteNonnegative,
  status: z.enum(['pending', 'confirmed']),
  kind: z.enum(['transfer', 'contract']),
  value: z.string().max(100),
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

export const snapshotSchema = z
  .object({
    chain: chainIdSchema,
    mode: z.enum(['demo', 'live']),
    status: z.enum(['ok', 'stale', 'unavailable']),
    source: z.string().min(1).max(100),
    /** Unix timestamp in milliseconds; stale snapshots retain their original time. */
    observedAt: safeNonnegativeInteger,
    coverage: z.string().min(1).max(700),
    pendingCount: safeNonnegativeInteger.nullable(),
    feeRate: finiteNonnegative.nullable(),
    feeUnit: z.enum(['sat/vB', 'Gwei']),
    transactions: z.array(transactionSchema).max(120),
    blocks: z.array(blockSchema).max(3),
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
    if (
      snapshot.mode === 'live' &&
      (snapshot.transactions.some((tx) => tx.id.startsWith('demo-')) ||
        snapshot.blocks.some((block) => block.hash.startsWith('demo-')))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Synthetic demo identifiers cannot be used as live data',
      });
    }
    if (
      snapshot.status === 'unavailable' &&
      (snapshot.transactions.length || snapshot.blocks.length)
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
